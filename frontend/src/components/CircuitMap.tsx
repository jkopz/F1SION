import React, { useMemo, useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { TrackLayout, Driver, DriverLap, DriverTrajectory } from '../types/f1';
import { Play, Pause, RotateCcw, FastForward, Compass, Pin, AlertTriangle } from 'lucide-react';
import { cleanHeadshotUrl, formatDriverName, formatTimeMMSS, sectorTiming, SectorTiming } from '../utils/driver';

interface CircuitMapProps {
  layout: TrackLayout | null;
  selectedDriver: Driver | null;
  driverLap: DriverLap | null;
  trajectory?: DriverTrajectory | null;
  circuitName?: string;
  countryName?: string;
  error?: string | null;
}

// SVG coordinate transformation
const SVG_WIDTH = 1000;
const SVG_HEIGHT = 650;
const PADDING = 28;

// Computes the shared viewport transform so raw telemetry coordinates map
// identically for the track polyline and the trajectory playback
const computeViewport = (bounds: { min_x: number; max_y: number; width: number; height: number }) => {
  const safeWidth = bounds.width > 0 ? bounds.width : 1000;
  const safeHeight = bounds.height > 0 ? bounds.height : 1000;
  const aspect = safeWidth / safeHeight;

  const availableWidth = SVG_WIDTH - PADDING * 2;
  const availableHeight = SVG_HEIGHT - PADDING * 2;

  let drawWidth = availableWidth;
  let drawHeight = availableWidth / aspect;

  if (drawHeight > availableHeight) {
    drawHeight = availableHeight;
    drawWidth = availableHeight * aspect;
  }

  return {
    offsetX: PADDING + (availableWidth - drawWidth) / 2,
    offsetY: PADDING + (availableHeight - drawHeight) / 2,
    drawWidth,
    drawHeight,
    safeWidth,
    safeHeight,
  };
};

// React re-renders for text/badge UI at ~10Hz; per-frame painting happens
// outside React (see progressRef / applyPosition). 10 frames per second is
// plenty for time readouts and sector badges.
const UI_UPDATE_MS = 100;

interface PathPoint {
  x: number;
  y: number;
}

interface TimedPathPoint extends PathPoint {
  t: number;
}

type LapPosition = { x: number; y: number } | null;

// Computes the car position for a lap-time fraction. Uses the driver's real
// timestamped trajectory when available (fast on straights, slow in corners)
// and falls back to the chronological reference-lap point sequence.
const computeCarPosition = (
  progress: number,
  totalLapDuration: number,
  trajectoryPts: TimedPathPoint[],
  mappedPoints: PathPoint[],
): LapPosition => {
  if (trajectoryPts.length >= 2 && totalLapDuration > 0) {
    const lapTime = Math.min(Math.max(progress, 0), 1) * totalLapDuration;

    // Clamp outside the recorded window to the nearest sample
    if (lapTime <= trajectoryPts[0].t) {
      return { x: trajectoryPts[0].x, y: trajectoryPts[0].y };
    }
    const last = trajectoryPts[trajectoryPts.length - 1];
    if (lapTime >= last.t) {
      return { x: last.x, y: last.y };
    }

    // Binary search for the sample pair bracketing the current lap time
    let lo = 0;
    let hi = trajectoryPts.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >>> 1;
      if (trajectoryPts[mid].t <= lapTime) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    const span = trajectoryPts[hi].t - trajectoryPts[lo].t;
    const t = span > 0 ? (lapTime - trajectoryPts[lo].t) / span : 0;
    const p1 = trajectoryPts[lo];
    const p2 = trajectoryPts[hi];
    return {
      x: p1.x + (p2.x - p1.x) * t,
      y: p1.y + (p2.y - p1.y) * t,
    };
  }

  if (mappedPoints.length >= 2) {
    const exactIndex = Math.min(Math.max(progress, 0), 1) * (mappedPoints.length - 1);
    const idx = Math.max(0, Math.min(Math.floor(exactIndex), mappedPoints.length - 2));
    const remainder = exactIndex - idx;

    const p1 = mappedPoints[idx];
    const p2 = mappedPoints[idx + 1];
    if (p1 && p2) {
      return {
        x: p1.x + (p2.x - p1.x) * remainder,
        y: p1.y + (p2.y - p1.y) * remainder,
      };
    }
    return mappedPoints[0] || null;
  }

  return null;
};

export const CircuitMap: React.FC<CircuitMapProps> = ({
  layout,
  selectedDriver,
  driverLap,
  trajectory,
  circuitName,
  countryName,
  error,
}) => {
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [progress, setProgress] = useState<number>(0); // 0.0 to 1.0
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isHoveringCar, setIsHoveringCar] = useState<boolean>(false);
  const [isPinned, setIsPinned] = useState<boolean>(false);
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  // Track completed sector times (don't reset when sector changes)
  const [sectorTimes, setSectorTimes] = useState<{s1?: number, s2?: number, s3?: number}>({});

  // Exact playback progress lives in a ref: the rAF loop advances and paints
  // it directly to the DOM every frame. React state above is only a ~10Hz
  // mirror for text/badge UI, keeping 60fps playback off the render cycle.
  const progressRef = useRef(0);
  const sectorTimesRef = useRef<{s1?: number, s2?: number, s3?: number}>({});
  const carGroupRef = useRef<SVGGElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const playheadFillRef = useRef<HTMLDivElement | null>(null);
  const playheadThumbRef = useRef<HTMLDivElement | null>(null);
  const trailRef = useRef<SVGPathElement | null>(null);
  // Cached measurements: stage pixel size (ResizeObserver) and card size
  // (measured once per mount) — avoids per-frame layout reads
  const stageSizeRef = useRef({ w: 0, h: 0 });
  const cardSizeRef = useRef({ w: 0, h: 0 });

  // Safe lap duration
  const rawDuration = driverLap?.lap_duration || layout?.lap_duration;
  const totalLapDuration = (typeof rawDuration === 'number' && rawDuration > 10) ? rawDuration : 80.0;

  // Sector split durations
  const s1Time = driverLap?.duration_sector_1 || layout?.sectors?.sector_1 || (totalLapDuration * 0.33);
  const s2Time = driverLap?.duration_sector_2 || layout?.sectors?.sector_2 || (totalLapDuration * 0.33);
  const s3Time = driverLap?.duration_sector_3 || layout?.sectors?.sector_3 || Math.max(1, totalLapDuration - s1Time - s2Time);

  // Sector fractions in [0.0, 1.0]
  const s1Fraction = Math.max(0.05, Math.min(0.9, s1Time / totalLapDuration));
  const s2Fraction = Math.max(s1Fraction + 0.05, Math.min(0.95, (s1Time + s2Time) / totalLapDuration));

  // Safe normalized progress
  const safeProgress = Number.isFinite(progress) ? Math.max(0, Math.min(progress, 0.9999)) : 0;

  // Active sector calculation
  const currentSector = safeProgress <= s1Fraction ? 1 : safeProgress <= s2Fraction ? 2 : 3;
  const currentLapTime = safeProgress * totalLapDuration;

  // Reset lap whenever selected driver changes
  useEffect(() => {
    progressRef.current = 0;
    sectorTimesRef.current = {};
    setProgress(0);
    setIsPlaying(true);
    setIsPinned(false);
    setSectorTimes({});
  }, [selectedDriver?.driver_number]);

  // Marks sector splits as completed once playback passes their thresholds
  const trackSectorTimes = useCallback((p: number) => {
    const st = sectorTimesRef.current;
    if (!st.s1 && p > s1Fraction) {
      st.s1 = s1Time;
      setSectorTimes({ ...st });
    }
    if (!st.s2 && p > s2Fraction) {
      st.s2 = s2Time;
      setSectorTimes({ ...st });
    }
    if (!st.s3 && p >= 0.999) {
      st.s3 = s3Time;
      setSectorTimes({ ...st });
    }
  }, [s1Fraction, s2Fraction, s1Time, s2Time, s3Time]);

  const {
    mappedPoints,
    sector1Path,
    sector2Path,
    sector3Path,
    startMarker,
    b12Marker,
    b23Marker,
  } = useMemo(() => {
    if (!layout || !layout.points || layout.points.length < 2 || !layout.bounds) {
      return {
        mappedPoints: [],
        sector1Path: '',
        sector2Path: '',
        sector3Path: '',
        startMarker: null,
        b12Marker: null,
        b23Marker: null,
      };
    }

    const { min_x, max_y } = layout.bounds;
    const { offsetX, offsetY, drawWidth, drawHeight, safeWidth, safeHeight } =
      computeViewport(layout.bounds);

    // Map each point safely into SVG viewport coordinates
    const pts = layout.points
      .filter((p) => typeof p.raw_x === 'number' && typeof p.raw_y === 'number')
      .map((p) => {
        const xRatio = (p.raw_x - min_x) / safeWidth;
        const yRatio = (max_y - p.raw_y) / safeHeight;
        return {
          x: offsetX + xRatio * drawWidth,
          y: offsetY + yRatio * drawHeight,
          sector: p.sector || 1,
        };
      });

    if (pts.length < 2) {
      return {
        mappedPoints: [],
        sector1Path: '',
        sector2Path: '',
        sector3Path: '',
        startMarker: null,
        b12Marker: null,
        b23Marker: null,
      };
    }

    const buildPath = (pointsList: { x: number; y: number }[]) => {
      if (!pointsList || pointsList.length === 0) return '';
      return pointsList.reduce((acc, curr, idx) => {
        return idx === 0
          ? `M ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`
          : `${acc} L ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
      }, '');
    };


    // Cumulative arc length along the lap, used to trim the sector ends
    const cum: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    }
    const totalLen = cum[cum.length - 1];

    // Each sector is drawn as its own line with a small gap at the sector
    // boundaries — round caps on both sides, no hard edges. Sector 3 wraps
    // back to the start/finish line, so it also gets trimmed there.
    //
    // GAP_TRIM is the VISIBLE clear gap you see between the sector lines.
    // Because a round cap extends half the stroke width (13 units) past the
    // line's last point, the actual point trimming is GAP_TRIM/2 + 13.
    const GAP_TRIM = 3; // visible clear gap in SVG units
    const CAP_RADIUS = 13; // half of the 26-unit asphalt stroke
    const TRIM = GAP_TRIM / 2 + CAP_RADIUS;
    const buildSectorPath = (sector: number, wraps: boolean) => {
      const idxs: number[] = [];
      pts.forEach((p, i) => {
        if (p.sector === sector) idxs.push(i);
      });
      if (idxs.length === 0) return '';
      const startLen = cum[idxs[0]];
      const endLen = wraps ? totalLen : cum[idxs[idxs.length - 1]];
      const kept = idxs.filter((i) => cum[i] > startLen + TRIM && cum[i] < endLen - TRIM);
      const list = kept.length >= 2 ? kept.map((i) => pts[i]) : idxs.map((i) => pts[i]);
      return buildPath(list);
    };

    // Marker geometry: a boundary marker sits exactly in the middle of the
    // gap between two sectors (by arc length) and its label is offset along
    // the normal pointing away from the track's centroid — so it never sticks
    // to the line and is always readable.
    const s1Idxs: number[] = [];
    const s2Idxs: number[] = [];
    const s3Idxs: number[] = [];
    pts.forEach((p, i) => {
      if (p.sector === 1) s1Idxs.push(i);
      else if (p.sector === 2) s2Idxs.push(i);
      else s3Idxs.push(i);
    });

    let centroidX = 0;
    let centroidY = 0;
    for (const p of pts) {
      centroidX += p.x;
      centroidY += p.y;
    }
    centroidX /= pts.length;
    centroidY /= pts.length;

    interface GapMarker {
      x: number;
      y: number;
      lx: number;
      ly: number;
    }

    const LABEL_OFFSET = 44; // pill floats clear of the dot and the asphalt ribbon

    const gapMarker = (prevIdx: number, nextIdx: number): GapMarker | null => {
      if (prevIdx < 0 || nextIdx < 0) return null;
      const a = pts[prevIdx];
      const b = pts[nextIdx];
      // Mid-gap by arc length between the two adjacent samples
      const ca = cum[prevIdx];
      const cb = cum[nextIdx];
      const t = cb > ca ? ((ca + cb) / 2 - ca) / (cb - ca) : 0.5;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      // Unit direction along the lap, then its normal
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      // Flip the normal so the label faces away from the track centre
      const flip = (x - centroidX) * nx + (y - centroidY) * ny < 0 ? -1 : 1;
      return {
        x,
        y,
        lx: x + flip * nx * LABEL_OFFSET,
        ly: y + flip * ny * LABEL_OFFSET,
      };
    };

    const lastIdxOf = (idxs: number[]) => (idxs.length ? idxs[idxs.length - 1] : -1);
    const firstIdxOf = (idxs: number[]) => (idxs.length ? idxs[0] : -1);

    return {
      mappedPoints: pts,
      sector1Path: buildSectorPath(1, false),
      sector2Path: buildSectorPath(2, false),
      sector3Path: buildSectorPath(3, true),
      // Start/finish closes the lap: gap between the last S3 point and point 0
      startMarker: gapMarker(lastIdxOf(s3Idxs), 0),
      b12Marker: gapMarker(lastIdxOf(s1Idxs), firstIdxOf(s2Idxs)),
      b23Marker: gapMarker(lastIdxOf(s2Idxs), firstIdxOf(s3Idxs)),
    };
  }, [layout]);

  // Real timestamped trajectory of the selected driver's fastest lap, mapped
  // into the same SVG viewport as the track. Point spacing in time reflects
  // real speed: dense samples in corners, wide gaps on straights.
  const trajectoryPts = useMemo(() => {
    if (!layout?.bounds || !trajectory?.points || trajectory.points.length < 2) {
      return [];
    }
    const { min_x, max_y } = layout.bounds;
    const { offsetX, offsetY, drawWidth, drawHeight, safeWidth, safeHeight } =
      computeViewport(layout.bounds);

    return trajectory.points
      .filter(
        (p) =>
          typeof p.x === 'number' &&
          typeof p.y === 'number' &&
          typeof p.t === 'number'
      )
      .map((p) => ({
        x: offsetX + ((p.x - min_x) / safeWidth) * drawWidth,
        y: offsetY + ((max_y - p.y) / safeHeight) * drawHeight,
        t: p.t,
      }))
      .sort((a, b) => a.t - b.t);
  }, [layout, trajectory]);

  // The lap trail: the path the car has driven so far, painted in its team
  // colour. Built from the same timed points as the car, with cumulative
  // lengths so a lap time maps to a drawn length via stroke-dasharray.
  const trail = useMemo(() => {
    const timed: TimedPathPoint[] =
      trajectoryPts.length >= 2
        ? trajectoryPts
        : mappedPoints.map((p, i) => ({
            x: p.x,
            y: p.y,
            t: (i / Math.max(1, mappedPoints.length - 1)) * totalLapDuration,
          }));
    if (timed.length < 2) return null;
    const cum = [0];
    let d = `M ${timed[0].x.toFixed(1)} ${timed[0].y.toFixed(1)}`;
    for (let i = 1; i < timed.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(timed[i].x - timed[i - 1].x, timed[i].y - timed[i - 1].y));
      d += ` L ${timed[i].x.toFixed(1)} ${timed[i].y.toFixed(1)}`;
    }
    return { d, cum, ts: timed.map((p) => p.t), total: cum[cum.length - 1] };
  }, [trajectoryPts, mappedPoints, totalLapDuration]);

  // Paints the current playback position straight to the DOM: car marker,
  // hover card position, and playhead. Called from the rAF loop and on scrub,
  // never through React state, so 60fps playback triggers zero reconciliations.
  const applyPosition = useCallback(
    (p: number) => {
      const pos = computeCarPosition(p, totalLapDuration, trajectoryPts, mappedPoints);
      if (!pos) return;

      carGroupRef.current?.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);

      // Card placement in stage pixels: ahead of the SVG's letterboxing (the
      // svg scales uniformly inside its container). Prefer the right side of
      // the car, flip to the left near the right edge, then clamp inside the
      // stage — so it never covers the marker and never leaves the screen.
      if (cardRef.current && stageSizeRef.current.w > 0 && stageSizeRef.current.h > 0) {
        const w = cardSizeRef.current.w || 240;
        const h = cardSizeRef.current.h || 170;
        const stageW = stageSizeRef.current.w;
        const stageH = stageSizeRef.current.h;

        const scale = Math.min(stageW / SVG_WIDTH, stageH / SVG_HEIGHT);
        const originX = (stageW - SVG_WIDTH * scale) / 2;
        const originY = (stageH - SVG_HEIGHT * scale) / 2;
        const carX = originX + pos.x * scale;
        const carY = originY + pos.y * scale;

        const CLEAR = 26;  // pulse ring radius ~22px
        const GAP = 16;    // breathing room between marker and card edge
        const MARGIN = 8;  // stage edge padding

        let left = carX + CLEAR + GAP;
        if (left + w > stageW - MARGIN) {
          left = carX - CLEAR - GAP - w;
        }
        left = Math.min(Math.max(left, MARGIN), Math.max(MARGIN, stageW - w - MARGIN));

        const top = Math.min(
          Math.max(carY, h / 2 + MARGIN),
          stageH - h / 2 - MARGIN
        );

        cardRef.current.style.left = `${Math.round(left)}px`;
        cardRef.current.style.top = `${Math.round(top)}px`;
      }

      if (trailRef.current && trail) {
        const lapTime = Math.min(Math.max(p, 0), 1) * totalLapDuration;
        const { ts, cum, total } = trail;
        let drawn = 0;
        if (lapTime >= ts[ts.length - 1]) {
          drawn = total;
        } else if (lapTime > ts[0]) {
          let lo = 0;
          let hi = ts.length - 1;
          while (lo < hi - 1) {
            const mid = (lo + hi) >>> 1;
            if (ts[mid] <= lapTime) lo = mid;
            else hi = mid;
          }
          const span = ts[hi] - ts[lo];
          const f = span > 0 ? (lapTime - ts[lo]) / span : 0;
          drawn = cum[lo] + (cum[hi] - cum[lo]) * f;
        }
        trailRef.current.style.strokeDasharray = `${drawn.toFixed(1)} ${(total + 10).toFixed(1)}`;
      }

      const pct = `${(p * 100).toFixed(2)}%`;
      if (playheadFillRef.current) playheadFillRef.current.style.width = pct;
      if (playheadThumbRef.current) playheadThumbRef.current.style.left = pct;
    },
    [totalLapDuration, trajectoryPts, mappedPoints, trail]
  );

  // Stage measurement via callback ref: a plain mount-effect would run while
  // the loading state is shown (stage not yet in the DOM) and never fire
  // again — leaving the stage size at zero and the card unpositioned.
  // A callback ref fires exactly when the node enters/leaves the DOM.
  const measureStage = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node) return;
      const measure = () => {
        stageSizeRef.current = { w: node.clientWidth, h: node.clientHeight };
        // Re-place the card against the new stage bounds on resize
        applyPosition(progressRef.current);
      };
      stageSizeRef.current = { w: node.clientWidth, h: node.clientHeight };
      observerRef.current = new ResizeObserver(measure);
      observerRef.current.observe(node);
    },
    [applyPosition]
  );

  // Keep car/card/playhead positioned before paint whenever data changes
  // (mount, driver switch, lap duration change) or the card mounts mid-pause
  useLayoutEffect(() => {
    // Measure the freshly mounted card so placement knows its real size
    if (cardRef.current) {
      cardSizeRef.current = {
        w: cardRef.current.offsetWidth,
        h: cardRef.current.offsetHeight,
      };
    }
    applyPosition(progressRef.current);
  }, [applyPosition, isHoveringCar, isPinned]);

  // Real-time animation loop using requestAnimationFrame.
  // Advances the exact progress in a ref and paints via applyPosition every
  // frame; React state is synced at ~10Hz purely for text/badge UI.
  useEffect(() => {
    if (!isPlaying || isScrubbing || (trajectoryPts.length < 2 && mappedPoints.length < 2)) return;

    let animId: number;
    let lastUpdateTime = performance.now();
    let lastUiUpdate = 0;

    const tick = (time: number) => {
      // Elapsed time since last tick, capped so tab throttling / hiccups
      // don't teleport the car forward
      const elapsedMs = Math.min(time - lastUpdateTime, 200);
      lastUpdateTime = time;

      const progressStep = ((elapsedMs / 1000) * playbackSpeed) / totalLapDuration;
      let next = (Number.isFinite(progressRef.current) ? progressRef.current : 0) + progressStep;
      if (next >= 1) next %= 1;
      progressRef.current = next;

      trackSectorTimes(next);
      applyPosition(next);

      // Throttled UI sync: time readouts, sector badges, scrub state mirror
      if (time - lastUiUpdate >= UI_UPDATE_MS) {
        lastUiUpdate = time;
        setProgress(next);
      }

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, isScrubbing, playbackSpeed, totalLapDuration, trackSectorTimes, applyPosition]);

  // Car marker position + playhead rendering
  const uiCarPos = useMemo(
    () => computeCarPosition(safeProgress, totalLapDuration, trajectoryPts, mappedPoints),
    [safeProgress, totalLapDuration, trajectoryPts, mappedPoints]
  );

  // Timing-screen colours for completed sector splits, compared against the
  // pole lap's sector splits (not the session-best per sector).
  const bench = layout?.sectors;
  const timing: [SectorTiming, SectorTiming, SectorTiming] = [
    sectorTiming(driverLap?.duration_sector_1, bench?.sector_1),
    sectorTiming(driverLap?.duration_sector_2, bench?.sector_2),
    sectorTiming(driverLap?.duration_sector_3, bench?.sector_3),
  ];
  const timingColor = (t: SectorTiming): string =>
    t === 'purple' ? '#b06dff' : t === 'yellow' ? '#e6c34a' : '#ffffff';

  // Static track artwork memoised as a single React element: when React
  // re-renders during playback it sees an identical element reference and
  // skips this whole subtree
  const sectorLines = [sector1Path, sector2Path, sector3Path];
  const trackVisuals = useMemo(
    () => (
      <>
        {/* Monochrome asphalt, split into three sector lines with small gaps
            of raw background between them (round caps, no hard edges) */}
        {sectorLines.map((d, i) =>
          d ? (
            <React.Fragment key={`sector-${i}`}>
              {/* Outer shadow */}
              <path
                d={d}
                fill="none"
                stroke="rgba(0,0,0,0.85)"
                strokeWidth="34"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Asphalt ribbon */}
              <path
                d={d}
                fill="none"
                stroke="#1c202c"
                strokeWidth="26"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Inner guide */}
              <path
                d={d}
                fill="none"
                stroke="#3a4258"
                strokeWidth="10"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </React.Fragment>
          ) : null
        )}

        {/* Sector Boundary Markers: dot centred in the gap, label pill
            offset perpendicular away from the track */}
        {[
          { m: b12Marker, label: 'S1 / S2' },
          { m: b23Marker, label: 'S2 / S3' },
        ].map(({ m, label }) =>
          m ? (
            <g key={label}>
              <circle cx={m.x} cy={m.y} r="3" fill="#8b8b90" opacity="0.9" />
              <g transform={`translate(${m.lx}, ${m.ly})`}>
                <rect
                  x={-(label.length * 3.4 + 8)}
                  y="-9"
                  width={label.length * 6.8 + 16}
                  height="18"
                  rx="9"
                  fill="rgba(7,8,11,0.85)"
                  stroke="rgba(139,139,144,0.35)"
                  strokeWidth="1"
                />
                <text
                  y="3.5"
                  textAnchor="middle"
                  fill="#a1a1a6"
                  fontSize="10"
                  fontFamily="monospace"
                >
                  {label}
                </text>
              </g>
            </g>
          ) : null
        )}

        {/* Start / Finish: marker centred in the gap, label pill offset */}
        {startMarker && (
          <g>
            <circle cx={startMarker.x} cy={startMarker.y} r="4" fill="#ffffff" stroke="#e10600" strokeWidth="2" />
            <g transform={`translate(${startMarker.lx}, ${startMarker.ly})`}>
              <rect
                x="-22"
                y="-9"
                width="44"
                height="18"
                rx="9"
                fill="rgba(7,8,11,0.85)"
                stroke="rgba(255,255,255,0.3)"
                strokeWidth="1"
              />
              <text
                y="3.5"
                textAnchor="middle"
                fill="#ffffff"
                fontSize="10"
                fontFamily="monospace"
              >
                Start
              </text>
            </g>
          </g>
        )}
      </>
    ),
    [sector1Path, sector2Path, sector3Path, startMarker, b12Marker, b23Marker]
  );



  const driverColor = selectedDriver?.team_colour || '#E10600';

  if (error) {
    return (
      <div className="flex h-full min-h-[500px] w-full items-center justify-center rounded-2xl border border-white/[0.08] bg-black/40 backdrop-blur-xl">
        <div className="flex flex-col items-center gap-3">
          <div className="relative flex items-center justify-center">
            <AlertTriangle className="h-8 w-8 text-yellow-500" />
          </div>
          <span className="text-xs font-mono tracking-widest text-zinc-400 uppercase text-center max-w-[300px]">
            {error}
          </span>
        </div>
      </div>
    );
  }

  if (!layout) {
    return (
      <div className="flex h-full min-h-[500px] w-full items-center justify-center rounded-2xl border border-white/[0.08] bg-black/40 backdrop-blur-xl">
        <div className="flex flex-col items-center gap-3">
          <div className="relative flex items-center justify-center">
            <div className="h-8 w-8 rounded-full border-2 border-red-500 border-t-transparent animate-spin" />
          </div>
          <span className="text-xs font-mono tracking-widest text-zinc-400 uppercase">
            LOADING CIRCUIT TELEMETRY...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-full w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-black/60 shadow-[0_16px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl">
      {/* Circuit Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.06] px-6 py-3.5 bg-white/[0.02]">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-600/20 text-red-500 border border-red-500/30">
            <Compass size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-extrabold tracking-wide text-white uppercase">
                {circuitName}
              </h2>
              <span className="text-xs font-mono text-zinc-400">
                {countryName ? `• ${countryName}` : ''}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-mono text-zinc-400">
              <span>LAP BENCHMARK: <strong className="text-zinc-200">{formatTimeMMSS(totalLapDuration)}</strong></span>
              <span>•</span>
              <span className="flex items-center gap-1.5">
                ACTIVE SECTOR:
                <span className="font-bold px-1.5 py-px rounded text-[10px] border border-white/[0.25] bg-white/[0.06] text-white">
                  SECTOR {currentSector}
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* Live Sector Split Badges */}
        <div className="flex items-center gap-2">
          {/* Sector 1 split */}
          <div className={`flex flex-col px-3 py-1 rounded-lg border transition-all ${
            currentSector === 1
              ? 'bg-white/[0.08] border-white/[0.25]'
              : safeProgress > s1Fraction
              ? 'bg-white/[0.04] border-white/[0.08]'
              : 'bg-black/30 border-white/[0.04] opacity-50'
          }`}>
            <span className="text-[9px] font-mono font-bold text-zinc-400">SECTOR 1</span>
            <span
              className="text-xs font-mono font-bold"
              style={{ color: safeProgress > s1Fraction ? timingColor(timing[0]) : '#ffffff' }}
            >
              {safeProgress > s1Fraction ? formatTimeMMSS(s1Time) : currentSector === 1 ? formatTimeMMSS(currentLapTime) : '--.---'}
            </span>
          </div>

          {/* Sector 2 split */}
          <div className={`flex flex-col px-3 py-1 rounded-lg border transition-all ${
            currentSector === 2
              ? 'bg-white/[0.08] border-white/[0.25]'
              : safeProgress > s2Fraction
              ? 'bg-white/[0.04] border-white/[0.08]'
              : 'bg-black/30 border-white/[0.04] opacity-50'
          }`}>
            <span className="text-[9px] font-mono font-bold text-zinc-400">SECTOR 2</span>
            <span
              className="text-xs font-mono font-bold"
              style={{ color: safeProgress > s2Fraction ? timingColor(timing[1]) : '#ffffff' }}
            >
              {safeProgress > s2Fraction ? formatTimeMMSS(s2Time) : currentSector === 2 ? formatTimeMMSS(currentLapTime - s1Time) : '--.---'}
            </span>
          </div>

          {/* Sector 3 split */}
          <div className={`flex flex-col px-3 py-1 rounded-lg border transition-all ${
            currentSector === 3
              ? 'bg-white/[0.08] border-white/[0.25]'
              : safeProgress >= 0.99
              ? 'bg-white/[0.04] border-white/[0.08]'
              : 'bg-black/30 border-white/[0.04] opacity-50'
          }`}>
            <span className="text-[9px] font-mono font-bold text-zinc-400">SECTOR 3</span>
            <span
              className="text-xs font-mono font-bold"
              style={{ color: safeProgress >= 0.99 ? timingColor(timing[2]) : '#ffffff' }}
            >
              {safeProgress >= 0.99 ? formatTimeMMSS(s3Time) : currentSector === 3 ? formatTimeMMSS(currentLapTime - s1Time - s2Time) : '--.---'}
            </span>
          </div>
        </div>
      </div>

      {/* Main SVG Track Canvas */}
      <div
        ref={measureStage}
        className="circuit-stage relative flex-1 flex items-center justify-center p-2 overflow-hidden"
      >
        <div className="circuit-grid pointer-events-none absolute inset-0" />
        <svg
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          className="relative z-[1] h-full w-full select-none"
        >
          {trackVisuals}

          {/* The lap so far, painted in the team colour */}
          {trail && (
            <path
              ref={trailRef}
              d={trail.d}
              fill="none"
              stroke={driverColor}
              strokeWidth="10"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ strokeDasharray: `0 ${trail.total + 10}` }}
            />
          )}

          {/* Car Marker (Pure Hardware-Accelerated SVG - 100% Gecko/Firefox Safe) */}
          {uiCarPos && (
            <g
              ref={carGroupRef}
              style={{ willChange: 'transform' }}
              className="cursor-pointer"
              onMouseEnter={() => setIsHoveringCar(true)}
              onMouseLeave={() => setIsHoveringCar(false)}
              onClick={(event) => {
                event.stopPropagation();
                setIsPinned((pinned) => !pinned);
              }}
            >
              {/* Native SMIL SVG Pulse (Never crashes WebRender) */}
              <circle r="12" fill={driverColor} opacity="0.4">
                <animate
                  attributeName="r"
                  values="10;22;10"
                  dur="2s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0.4;0.05;0.4"
                  dur="2s"
                  repeatCount="indefinite"
                />
              </circle>

              {/* Outer Core Ring */}
              <circle
                r="8"
                fill={driverColor}
                stroke="#ffffff"
                strokeWidth="1.8"
              />
              {/* Inner White Apex Dot */}
              <circle r="3" fill="#ffffff" />

              {/* Floating Driver Acronym Pill */}
              <g transform="translate(12, -9)">
                <rect
                  x="0"
                  y="0"
                  width="38"
                  height="18"
                  rx="9"
                  fill="rgba(11,13,19,0.92)"
                  stroke={driverColor}
                  strokeWidth="1.2"
                />
                <text
                  x="19"
                  y="13"
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="10"
                  fontFamily="Formula1-Display-Bold, Formula1-Bold, sans-serif"
                >
                  {selectedDriver?.name_acronym || 'P1'}
                </text>
              </g>
            </g>
          )}
        </svg>

        {/* Hover Popover: Apple Liquid Glass Driver Card */}
        {uiCarPos && (isHoveringCar || isPinned) && (
          <div
            ref={cardRef}
            className="absolute z-30 pointer-events-none"
            style={{ transform: 'translateY(-50%)' }}
          >
            {/* Liquid Glass card — layered frosted glass with coloured tint */}
            <div
              className="relative flex items-center gap-3 p-3 rounded-2xl min-w-[220px] overflow-hidden"
              style={{
                background: `linear-gradient(135deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.06) 100%)`,
                backdropFilter: 'blur(20px) saturate(180%)',
                WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                border: `1px solid rgba(255,255,255,0.22)`,
                boxShadow: `0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.18), 0 0 0 1px rgba(0,0,0,0.12)`,
              }}
            >
              {/* Subtle colour tint from team livery */}
              <div
                className="pointer-events-none absolute inset-0 rounded-2xl"
                style={{
                  background: `radial-gradient(ellipse at 20% 50%, ${driverColor}22 0%, transparent 65%)`,
                }}
              />
              {/* Specular highlight streak */}
              <div
                className="pointer-events-none absolute top-0 left-3 right-3 h-px"
                style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)' }}
              />

              {/* Driver headshot */}
              <div
                className="relative h-12 w-12 rounded-xl overflow-hidden shrink-0"
                style={{
                  border: `1.5px solid rgba(255,255,255,0.25)`,
                  boxShadow: `0 0 0 1px ${driverColor}50`,
                }}
              >
                {cleanHeadshotUrl(selectedDriver?.headshot_url) ? (
                  <img
                    src={cleanHeadshotUrl(selectedDriver?.headshot_url)}
                    alt={selectedDriver?.broadcast_name}
                    className="h-full w-full object-cover object-top scale-[1.3] origin-top"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <div
                    className="h-full w-full flex items-center justify-center text-[11px] text-white"
                    style={{ background: `${driverColor}30`, fontFamily: 'Formula1-Display-Bold, Formula1-Bold, sans-serif' }}
                  >
                    {selectedDriver?.name_acronym}
                  </div>
                )}
              </div>

              {/* Driver info */}
              <div className="relative space-y-0.5 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-white tracking-wide" style={{ fontFamily: 'Formula1-Display-Bold, Formula1-Bold, sans-serif' }}>
                    {selectedDriver?.name_acronym}
                  </span>
                  <span
                    className="text-[10px] font-mono font-bold px-1.5 py-px rounded-md"
                    style={{ backgroundColor: `${driverColor}30`, color: driverColor, border: `1px solid ${driverColor}50` }}
                  >
                    #{selectedDriver?.driver_number}
                  </span>
                </div>
                <p className="text-[11px] font-semibold text-white/80 leading-tight">
                  {formatDriverName(selectedDriver?.full_name, selectedDriver?.broadcast_name)}
                </p>
                <p className="text-[9px] text-white/50 truncate max-w-[130px]">
                  {selectedDriver?.team_name}
                </p>
                {/* Overall lap time (running) */}
                <div className="text-[11px] font-mono font-bold text-white pt-0.5">
                  {formatTimeMMSS(currentLapTime)}
                </div>
                {/* Dynamic sector times display - keep completed times, show running time for current sector */}
                <div className="flex items-center gap-2 pt-1">
                  {/* Sector 1 */}
                  <div className={`flex flex-col px-2 py-1 rounded-lg border transition-all ${
                    currentSector === 1
                      ? 'bg-white/[0.08] border-white/[0.2]'
                      : 'bg-black/30 border-white/[0.08]'
                  }`}>
                    <span className="text-[8px] font-mono font-bold text-zinc-400">SECTOR 1</span>
                    <span
                      className="text-[10px] font-mono font-bold"
                      style={{ color: currentSector === 1 ? '#ffffff' : timingColor(timing[0]) }}
                    >
                      {currentSector === 1 ? formatTimeMMSS(currentLapTime) : (sectorTimes.s1 ? formatTimeMMSS(sectorTimes.s1) : '--.---')}
                    </span>
                  </div>
                  {/* Sector 2 */}
                  <div className={`flex flex-col px-2 py-1 rounded-lg border transition-all ${
                    currentSector === 2
                      ? 'bg-white/[0.08] border-white/[0.2]'
                      : 'bg-black/30 border-white/[0.08]'
                  }`}>
                    <span className="text-[8px] font-mono font-bold text-zinc-400">SECTOR 2</span>
                    <span
                      className="text-[10px] font-mono font-bold"
                      style={{ color: currentSector === 2 ? '#ffffff' : timingColor(timing[1]) }}
                    >
                      {currentSector === 2 ? formatTimeMMSS(currentLapTime - s1Time) : (sectorTimes.s2 ? formatTimeMMSS(sectorTimes.s2) : '--.---')}
                    </span>
                  </div>
                  {/* Sector 3 */}
                  <div className={`flex flex-col px-2 py-1 rounded-lg border transition-all ${
                    currentSector === 3
                      ? 'bg-white/[0.08] border-white/[0.2]'
                      : 'bg-black/30 border-white/[0.08]'
                  }`}>
                    <span className="text-[8px] font-mono font-bold text-zinc-400">SECTOR 3</span>
                    <span
                      className="text-[10px] font-mono font-bold"
                      style={{ color: currentSector === 3 ? '#ffffff' : timingColor(timing[2]) }}
                    >
                      {currentSector === 3 ? formatTimeMMSS(currentLapTime - s1Time - s2Time) : (sectorTimes.s3 ? formatTimeMMSS(sectorTimes.s3) : '--.---')}
                    </span>
                  </div>
                </div>
                {/* Pin indicator icon - top right */}
                {isPinned && <Pin size={14} className="absolute top-2 right-2 text-white shrink-0" />}
              </div>
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute bottom-3 left-4 z-[2] rounded-full border border-white/10 bg-black/50 px-2.5 py-1 text-[10px] font-mono text-zinc-400 backdrop-blur-md">
          {isPinned ? 'Card pinned · click the car to release' : 'Hover the car · click to pin'}
        </div>
      </div>

      {/* Scrubbable Interactive Timeline & Playback Controller */}
      <div className="border-t border-white/[0.06] bg-black/50 p-4 backdrop-blur-md space-y-3">
        {/* Sector Labels */}
        <div className="flex justify-between text-[10px] font-mono text-zinc-400">
          <span className={`flex items-center gap-1 font-bold ${currentSector === 1 ? 'text-white' : 'text-zinc-400'}`}>
            SECTOR 1 (0:00.000 - {formatTimeMMSS(s1Time)})
          </span>
          <span className={`flex items-center gap-1 font-bold ${currentSector === 2 ? 'text-white' : 'text-zinc-400'}`}>
            SECTOR 2 ({formatTimeMMSS(s1Time)} - {formatTimeMMSS(s1Time + s2Time)})
          </span>
          <span className={`flex items-center gap-1 font-bold ${currentSector === 3 ? 'text-white' : 'text-zinc-400'}`}>
            SECTOR 3 ({formatTimeMMSS(s1Time + s2Time)} - {formatTimeMMSS(totalLapDuration)})
          </span>
        </div>

        {/* Robust Scrubbing Slider (Native HTML5 Range Input - Never hangs!) */}
        <div className="relative flex items-center w-full">
          {/* Sector Visual Track Background */}
          <div className="absolute inset-x-0 h-2.5 rounded-full bg-white/[0.05] overflow-hidden border border-white/[0.08] pointer-events-none">
            {/* Sector 1 Divider */}
            <div
              className="absolute top-0 bottom-0 border-r border-white/20 z-10"
              style={{ left: `${(s1Fraction * 100).toFixed(1)}%` }}
            />
            {/* Sector 2 Divider */}
            <div
              className="absolute top-0 bottom-0 border-r border-white/20 z-10"
              style={{ left: `${(s2Fraction * 100).toFixed(1)}%` }}
            />
            {/* Progress Fill — painted in the team colour, like the lap itself */}
            <div
              ref={playheadFillRef}
              className="h-full"
              style={{
                width: `${(safeProgress * 100).toFixed(2)}%`,
                backgroundColor: driverColor,
              }}
            />
          </div>

          {/* Actual Drag Input on top */}
          <input
            type="range"
            min="0"
            max="1"
            step="0.001"
            value={safeProgress}
            onMouseDown={() => setIsScrubbing(true)}
            onTouchStart={() => setIsScrubbing(true)}
            onMouseUp={() => setIsScrubbing(false)}
            onTouchEnd={() => setIsScrubbing(false)}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (Number.isFinite(val)) {
                progressRef.current = val;
                trackSectorTimes(val);
                setProgress(val);
                applyPosition(val);
              }
            }}
            className="w-full h-4 opacity-0 cursor-ew-resize z-20"
            title="Scrub lap timeline"
          />

          {/* Custom Glowing Thumb Marker */}
          <div
            ref={playheadThumbRef}
            className="absolute h-4 w-4 rounded-full bg-white border-2 pointer-events-none -translate-x-1/2"
            style={{ left: `${(safeProgress * 100).toFixed(2)}%`, borderColor: driverColor }}
          />
        </div>

        {/* Playback & Telemetry Controller */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
          {/* Controls: Play, Reset, Speed */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold text-xs transition-colors active:scale-95"
            >
              {isPlaying ? <Pause size={14} /> : <Play size={14} />}
              <span>{isPlaying ? 'PAUSE' : 'PLAY'}</span>
            </button>

            <button
              onClick={() => {
                progressRef.current = 0;
                sectorTimesRef.current = {};
                setSectorTimes({});
                setProgress(0);
                applyPosition(0);
                setIsPlaying(true);
              }}
              className="p-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] text-zinc-300 hover:text-white hover:bg-white/[0.08] transition-all"
              title="Reset Lap to Start Line"
            >
              <RotateCcw size={14} />
            </button>

            {/* Speed Multipliers */}
            <div className="flex items-center gap-1 bg-white/[0.04] p-1 rounded-lg border border-white/[0.08] text-xs font-mono ml-2">
              <FastForward size={12} className="text-zinc-400 mx-1" />
              {[0.5, 1, 2, 4].map((spd) => (
                <button
                  key={spd}
                  onClick={() => setPlaybackSpeed(spd)}
                  className={`px-2 py-0.5 rounded text-[11px] font-bold transition-colors ${
                    playbackSpeed === spd
                      ? 'bg-white/[0.12] text-white'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {spd}x
                </button>
              ))}
            </div>
          </div>

          {/* Time & Telemetry Readouts */}
          <div className="flex items-center gap-4 font-mono text-xs">
            <div className="text-zinc-400">
              TIME: <span className="text-white font-bold">{formatTimeMMSS(currentLapTime)}</span> / {formatTimeMMSS(totalLapDuration)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
