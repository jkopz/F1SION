import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { RacePrediction, DriverPrediction, Session } from '../types/f1';
import { fetchRacePrediction, fetchSessions } from '../services/api';
import { cleanHeadshotUrl, formatDriverName, formatGap } from '../utils/driver';
import {
  TrendingUp,
  Trophy,
  CloudRain,
  Sun,
  Thermometer,
  X,
  Cpu,
  Gauge,
  History,
  Flag,
  AlertTriangle,
  MousePointerClick,
  type LucideIcon,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                  */
/* ------------------------------------------------------------------ */

function pct(value: number, digits?: number): string {
  if (value === 0) {
    return `${(value * 100).toFixed(digits ?? 1)}%`;
  }
  // Tiny but non-zero probabilities must never display as a misleading 0.0%
  if (value < 0.0005) {
    return '<0.1%';
  }
  if (value < 0.1) {
    return `${(value * 100).toFixed(digits ?? 1)}%`;
  }
  return `${Math.round(value * 100)}%`;
}

function deltaSeconds(value?: number): string {
  return value === undefined ? '—' : formatGap(value);
}

/* ------------------------------------------------------------------ */
/* Hover knowledge base — what each metric means and how it is built   */
/* ------------------------------------------------------------------ */

interface Hint {
  title: string;
  body: string;
}

const HINTS: Record<string, Hint> = {
  predictedPosition: {
    title: 'Expected finish',
    body: 'The big P number is this driver’s rank among all 20 model predictions. Behind it sits a continuous pace score that blends qualifying pace (40%), practice pace (20%), long-run pace (15%), track history (15%) and recent form (10%) — a raw score of 7.8 means “expected around P7–P8”. The score is shown underneath the rank. In a wet race the weights shift towards recent form, because driver skill beats car performance in the rain.',
  },
  winChance: {
    title: 'Win probability',
    body: 'Share of 4,000 Monte-Carlo race simulations this driver wins. Each run resamples every driver’s finish around the expected order (σ ≈ 1.4 positions in the dry, σ ≈ 2.2 in the wet), then multiplies the noise with a per-race chaos factor between 0.4 (processional) and 2.4 (safety cars, first-lap incidents, strategy luck) — so a strong midfield car can absolutely win a chaotic race. Per-driver DNF risk from this season’s reliability is rolled on top.',
  },
  podiumChance: {
    title: 'Podium probability',
    body: 'Share of 4,000 Monte-Carlo simulations in which this driver finishes on the top-3 step. Sensitive to pace AND to retirements ahead — a reliable car on P5 pace beats a fragile car on P3 pace.',
  },
  pointsChance: {
    title: 'Points probability',
    body: 'Share of 4,000 Monte-Carlo simulations in which this driver finishes inside the top 10 and scores. Mostly a sanity metric: only a genuinely bad weekend pushes this below ~90%.',
  },
  expectedPoints: {
    title: 'Expected points (Ø)',
    body: 'Average championship points collected across all simulation runs, scored on the official table (25-18-15-12-10-8-6-4-2-1). This is what a bet on this result would pay on average.',
  },
  grid: {
    title: 'Grid position',
    body: 'Official qualifying classification. When no classification exists, it falls back to the fastest-lap ranking of the qualifying session. Worth up to ~40% of the pace index — starting order matters.',
  },
  qualiDelta: {
    title: 'Qualifying delta',
    body: 'Gap in seconds to the fastest qualifying lap of the weekend. Pure single-lap pace at this exact track: lights-out performance with no fuel saving, no traffic.',
  },
  fpDelta: {
    title: 'Practice delta (FP1–FP3)',
    body: 'Best clean lap across all three free practice sessions, measured against the fastest of those sessions. Captures pace set outside qualifying pressure — including set-up work by the engineers.',
  },
  longRunDelta: {
    title: 'Long-run pace (FP2)',
    body: 'Median lap time of race-simulation running in practice: only laps from lap 3 onward, outliers beyond 110% of the driver’s own best lap removed. The closest available proxy for true race pace — tyre wear included.',
  },
  trackHistory: {
    title: 'Track history',
    body: 'Average finishing position at this exact circuit over the last up-to-three seasons. Captures track-specific traits: car concept, driver feel, even local knowledge. Weight 15%.',
  },
  recentForm: {
    title: 'Recent form',
    body: 'Average finishing position over the last three Grands Prix of this season. Momentum and upgrades live here. Weight 10% in the dry — but 35% in wet conditions, where driver skill dominates.',
  },
  dnfRisk: {
    title: 'DNF risk',
    body: 'Probability this driver retires before the flag. Base rate: this season’s own DNF share shrunk towards the 8% fleet average (a single retirement over three races must not mean 33%). Capped at 35%',
  },
  weather: {
    title: 'Weekend conditions',
    body: 'Aggregated from OpenF1 weather telemetry across FP1–FP3, qualifying and the race. A rain flag modifies the model: weights shift towards recent form and every simulation gets noisier (σ 1.4 → 2.2).',
  },
  engine: {
    title: 'Prediction engine',
    body: 'With a trained XGBoost artifact, the model predicts expected positions and is blended 70/30 with the transparent baseline. Without an artifact (or with brand-new cars) the baseline carries the full prediction. Monte-Carlo always runs 4,000 laps of the dice.',
  },
};

/**
 * Liquid-glass knowledge chip: hovering reveals a floating blurred info
 * card (no native tooltips) explaining what the value is, where it comes
 * from and how it feeds the model.
 *
 * The card renders through a portal into document.body and is positioned
 * with fixed coordinates, clamped to the viewport — the same approach the
 * CircuitMap driver card uses — so it can never be clipped by a scroll
 * container or hang off-screen.
 */
function GlassInfo({
  hintKey,
  extra,
  block = false,
  children,
}: {
  hintKey: keyof typeof HINTS;
  /** Optional exact value line (e.g. the unrounded average) shown on hover */
  extra?: string;
  /** Render as a full-width block instead of an inline span — REQUIRED for
   *  stacked tiles: inline spans flow side-by-side like words and wrap */
  block?: boolean;
  children: React.ReactNode;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const card = cardRef.current;
    if (!anchor || !card) return;
    const rect = anchor.getBoundingClientRect();
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Horizontally centred on the trigger, clamped to the viewport
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.min(Math.max(left, 12), Math.max(12, vw - width - 12));

    // Prefer below the trigger; flip above when the space runs out
    let top = rect.bottom + 10;
    if (top + height > vh - 12) {
      top = rect.top - height - 10;
    }
    if (top < 12) top = 12;

    setStyle({ position: 'fixed', left: Math.round(left), top: Math.round(top) });
  }, []);

  useEffect(() => {
    if (!open) return;
    // Measure once mounted, then keep clamped against resize/scroll
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  const hint = HINTS[hintKey];
  return (
    <span
      ref={anchorRef}
      className={block ? 'relative block w-full' : 'relative inline-flex'}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {children}
      {open &&
        createPortal(
          <div ref={cardRef} className="pointer-events-none z-[100]" style={style}>
            <div
              className="relative w-80 rounded-2xl overflow-hidden p-4"
              style={{
                background:
                  'linear-gradient(135deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.05) 100%)',
                backdropFilter: 'blur(20px) saturate(180%)',
                WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                border: '1px solid rgba(255,255,255,0.22)',
                boxShadow:
                  '0 8px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.18), 0 0 0 1px rgba(0,0,0,0.12)',
              }}
            >
              {/* Specular highlight streak */}
              <div
                className="pointer-events-none absolute top-0 left-3 right-3 h-px"
                style={{
                  background:
                    'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)',
                }}
              />
              <div className="text-xs font-extrabold tracking-wider text-white uppercase">
                {hint.title}
              </div>
              <div className="mt-1.5 text-xs leading-relaxed text-zinc-200">{hint.body}</div>
              {extra && (
                <div className="mt-2 pt-2 border-t border-white/[0.12] text-[11px] font-mono text-white/90">
                  {extra}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Probability bar (larger variant for the detail panel)               */
/* ------------------------------------------------------------------ */

function ProbBar({
  label,
  value,
  color,
  hintKey,
  large = false,
}: {
  label: string;
  value: number;
  color: string;
  hintKey?: keyof typeof HINTS;
  large?: boolean;
}) {
  const bar = (
    <div className="flex items-center gap-3 min-w-0 w-full">
      <span
        className={`shrink-0 font-mono text-zinc-400 uppercase tracking-wider ${
          large ? 'w-24 text-xs' : 'w-12 text-[9px]'
        }`}
      >
        {label}
      </span>
      {/* Value sits directly after the label — never drifts to the far
          right where it could visually merge with the next row's label */}
      <span
        className={`shrink-0 font-mono font-bold text-white ${large ? 'w-16 text-base' : 'w-10 text-[10px]'}`}
      >
        {pct(value, large ? 1 : undefined)}
      </span>
      <div
        className={`flex-1 rounded-full bg-white/[0.06] overflow-hidden ${
          large ? 'h-3' : 'h-1.5'
        }`}
      >
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.max(value * 100, value > 0 ? 1.5 : 0)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
  return hintKey ? (
    <GlassInfo hintKey={hintKey} block={large}>
      {bar}
    </GlassInfo>
  ) : (
    bar
  );
}

/* ------------------------------------------------------------------ */
/* Team logo monogram + headshot                                        */
/* ------------------------------------------------------------------ */

function DriverAvatar({
  driver,
  size = 'md',
}: {
  driver: DriverPrediction;
  size?: 'sm' | 'md' | 'lg';
}) {
  const headshotUrl = cleanHeadshotUrl(driver.headshot_url);
  const dims = size === 'lg' ? 'h-14 w-14' : size === 'md' ? 'h-10 w-10' : 'h-8 w-8';
  return (
    <div
      className={`relative ${dims} shrink-0 rounded-full overflow-hidden border border-white/[0.12]`}
      style={{ backgroundColor: `${driver.team_colour}26` }}
    >
      {headshotUrl ? (
        <img
          src={headshotUrl}
          alt={driver.name_acronym}
          className="h-full w-full object-cover object-top bg-black/30 scale-[1.3] origin-top"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : null}
      {!headshotUrl && (
        <div className="absolute inset-0 flex items-center justify-center font-bold text-white">
          {driver.name_acronym}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Podium: P2 left, P1 raised in the middle, P3 right                  */
/* ------------------------------------------------------------------ */

const PodiumStep: React.FC<{
  driver: DriverPrediction;
  place: number;
  height: string;
  onSelect(): void;
  featured?: boolean;
}> = memo(function PodiumStep({ driver, place, height, onSelect, featured }) {
  const color = driver.team_colour;
  const rankColor =
    place === 1 ? 'text-yellow-400' : place === 2 ? 'text-zinc-300' : 'text-amber-600';
  // Small, crisp headshot: far below its native resolution, so it can
  // never look pixelated. Rest of the card distributes the content.
  const photoWrap = featured ? 'h-[6.5rem] w-24' : 'h-[5.5rem] w-20';

  return (
    <button
      onClick={onSelect}
      className="group relative flex flex-col items-stretch w-full rounded-2xl border overflow-hidden transition-all duration-200 hover:scale-[1.02] focus:outline-none"
      style={{
        height,
        borderColor: featured ? `${color}aa` : 'rgba(255,255,255,0.1)',
        background: `linear-gradient(180deg, ${color}26 0%, ${color}10 45%, rgba(0,0,0,0.45) 100%)`,
        boxShadow: featured ? `0 0 34px ${color}38` : undefined,
      }}
    >
      {/* Photo + name section: content distributed over the full card width */}
      <div className="relative flex-1 min-h-0 flex flex-col items-center justify-center gap-2 pt-3 px-2">
        {/* Soft team-colour halo behind the headshot */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-full"
          style={{ background: `radial-gradient(ellipse at 50% 15%, ${color}30 0%, transparent 60%)` }}
        />
        <div
          className={`relative shrink-0 overflow-hidden rounded-xl border border-white/[0.14] ${photoWrap}`}
          style={{ boxShadow: `0 0 0 1px ${color}40, 0 4px 14px rgba(0,0,0,0.45)` }}
        >
          {cleanHeadshotUrl(driver.headshot_url) ? (
            <img
              src={cleanHeadshotUrl(driver.headshot_url)}
              alt={driver.name_acronym}
              className="absolute inset-0 h-full w-full object-cover object-top bg-black/30 scale-[1.3] origin-top"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : null}
          {!cleanHeadshotUrl(driver.headshot_url) && (
            <div className="absolute inset-0 flex items-center justify-center text-lg font-bold text-white/90">
              {driver.name_acronym}
            </div>
          )}
        </div>
        {/* Name plate under the photo */}
        <div className="relative text-center max-w-full">
          <div
            className={`tracking-wide text-white leading-tight ${featured ? 'text-base' : 'text-sm'}`}
            style={{ fontFamily: 'Formula1-Display-Bold, Formula1-Bold, sans-serif' }}
          >
            {driver.name_acronym}
          </div>
          <div className="text-[10px] font-medium text-zinc-400 truncate leading-tight">
            {driver.team_name}
          </div>
        </div>
      </div>

      {/* Plinth: place number clearly separated from the win probability */}
      <div
        className="flex items-center justify-between gap-2 px-3.5 py-2 border-t shrink-0"
        style={{ borderColor: `${color}55`, backgroundColor: `${color}16` }}
      >
        <span className={`font-mono font-black ${featured ? 'text-2xl' : 'text-lg'} ${rankColor} leading-none`}>
          {place}
        </span>
        <GlassInfo hintKey="winChance">
          <span className="flex flex-col items-end cursor-help leading-none">
            <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-wider">Win</span>
            <span
              className={`font-mono font-black ${featured ? 'text-sm' : 'text-xs'}`}
              style={{ color }}
            >
              {pct(driver.p_win)}
            </span>
          </span>
        </GlassInfo>
      </div>
    </button>
  );
});

/* ------------------------------------------------------------------ */
/* Full-height driver detail panel                                     */
/* ------------------------------------------------------------------ */

function FeatureRow({
  icon: Icon,
  label,
  value,
  hintKey,
  extra,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hintKey: keyof typeof HINTS;
  extra?: string;
}) {
  return (
    <GlassInfo hintKey={hintKey} extra={extra} block>
      <div className="flex w-full cursor-help items-center gap-4 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3 transition-colors hover:border-white/[0.18] hover:bg-white/[0.06]">
        <Icon size={18} className="shrink-0 text-zinc-400" />
        <span className="w-32 shrink-0 text-[11px] font-mono text-zinc-300 uppercase tracking-wider">
          {label}
        </span>
        <span className="ml-auto font-mono text-base font-bold text-white">{value}</span>
      </div>
    </GlassInfo>
  );
}

const DriverDetail: React.FC<{ driver: DriverPrediction; rank: number; onClose: () => void }> = memo(
  function DriverDetail({ driver, rank, onClose }) {
    const color = driver.team_colour;
    const fullName = formatDriverName(driver.full_name, driver.name_acronym);

    return (
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden rounded-2xl border border-white/[0.1] bg-gradient-to-b from-white/[0.04] to-black/60 shadow-[0_16px_40px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
        {/* Header with team-colour wash */}
        <div
          className="relative shrink-0 px-4 pt-4 pb-3 border-b border-white/[0.08]"
          style={{ background: `linear-gradient(135deg, ${color}26 0%, transparent 70%)` }}
        >
          <button
            onClick={onClose}
            className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-white"
            aria-label="Close driver detail"
          >
            <X size={15} />
          </button>

          <div className="flex items-center gap-3 pr-8">
            <DriverAvatar driver={driver} size="lg" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className="text-2xl tracking-wide text-white leading-none"
                  style={{ fontFamily: 'Formula1-Display-Bold, Formula1-Bold, sans-serif' }}
                >
                  {driver.name_acronym}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-zinc-200 truncate">{fullName}</div>
              <div className="text-[11px] font-mono text-zinc-500 truncate">{driver.team_name}</div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-5">
          {/* Hero numbers: the driver's PREDICTED RANK (matches the leaderboard)
              + the raw continuous model score as context */}
          <div className="flex items-end justify-between gap-3">
            <GlassInfo hintKey="predictedPosition">
              <div className="cursor-help">
                <div className="text-5xl font-black leading-none text-white">P{rank}</div>
                <div className="mt-1 text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                  Expected finish · raw score {driver.predicted_position.toFixed(1)}
                </div>
              </div>
            </GlassInfo>
            <GlassInfo hintKey="winChance">
              <div className="cursor-help text-right">
                <div className="text-3xl font-black leading-none" style={{ color }}>
                  {pct(driver.p_win)}
                </div>
                <div className="mt-1 text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                  Win chance
                </div>
              </div>
            </GlassInfo>
          </div>

          {/* Probabilities */}
          <div className="space-y-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
            <ProbBar label="WIN" value={driver.p_win} color={color} hintKey="winChance" large />
            <ProbBar label="PODIUM" value={driver.p_podium} color="#f59e0b" hintKey="podiumChance" large />
            <ProbBar label="POINTS" value={driver.p_points} color="#10b981" hintKey="pointsChance" large />
          </div>

          {/* Feature breakdown — one roomy tile per feature, top to bottom */}
          <div className="space-y-2">
            <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
              <MousePointerClick size={12} />
              Feature breakdown — hover for details
            </div>
            <FeatureRow icon={Flag} label="Grid" hintKey="grid"
              value={driver.grid_position ? `P${driver.grid_position}` : '—'} />
            <FeatureRow icon={Cpu} label="Quali Δ" hintKey="qualiDelta"
              value={deltaSeconds(driver.quali_delta)} />
            <FeatureRow icon={Cpu} label="Practice Δ" hintKey="fpDelta"
              value={deltaSeconds(driver.practice_delta)} />
            <FeatureRow icon={Gauge} label="Long-run Δ" hintKey="longRunDelta"
              value={deltaSeconds(driver.long_run_delta)} />
            <FeatureRow icon={History} label="Track" hintKey="trackHistory"
              value={
                driver.track_races
                  ? `Ø P${Math.round(driver.track_avg_finish ?? 0)} · best P${driver.track_best} · ${driver.track_races} ${driver.track_races === 1 ? 'race' : 'races'}`
                  : 'no data'
              }
              extra={
                driver.track_races
                  ? `Exact average: P${(driver.track_avg_finish ?? 0).toFixed(1)} over ${driver.track_races} race${driver.track_races === 1 ? '' : 's'} at this circuit.`
                  : undefined
              } />
            <FeatureRow icon={TrendingUp} label="Form" hintKey="recentForm"
              value={driver.form_avg_finish ? `Ø P${Math.round(driver.form_avg_finish)}` : 'no data'}
              extra={
                driver.form_avg_finish
                  ? `Exact average: P${driver.form_avg_finish.toFixed(1)} over the last 3 Grands Prix.`
                  : undefined
              } />
            <FeatureRow icon={AlertTriangle} label="DNF risk" hintKey="dnfRisk"
              value={driver.dnf_risk !== undefined ? pct(driver.dnf_risk, 1) : '—'} />
          </div>

          {/* Model explanation pills */}
          <div className="space-y-2.5 pt-1">
            <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
              What moves this prediction
            </div>
            <div className="flex flex-wrap gap-3">
              {driver.top_factors.length ? (
                driver.top_factors.map((factor) => (
                  <span
                    key={factor}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono border ${
                      factor.startsWith('+')
                        ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25'
                        : factor.startsWith('-') || factor.startsWith('−')
                        ? 'text-red-300 bg-red-500/10 border-red-500/25'
                        : 'text-zinc-300 bg-white/[0.04] border-white/[0.1]'
                    }`}
                  >
                    {factor.replace(/^[+−-] ~?/, '').trim()}
                  </span>
                ))
              ) : (
                <span className="text-[11px] font-mono text-zinc-500">—</span>
              )}
            </div>
          </div>

          {/* Engine note */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="text-[10px] font-mono text-zinc-400 leading-relaxed">
              <GlassInfo hintKey="engine">
                <span className="cursor-help underline decoration-dotted decoration-white/30 underline-offset-2">
                  How this number was made
                </span>
              </GlassInfo>
            </div>
          </div>
        </div>
      </div>
    );
  },
);

/* ------------------------------------------------------------------ */
/* Predicted grid row (bigger)                                         */
/* ------------------------------------------------------------------ */

const PredictedRow: React.FC<{
  driver: DriverPrediction;
  index: number;
  leaderPosition: number;
  isSelected: boolean;
  onSelect: () => void;
}> = memo(function PredictedRow({ driver, index, leaderPosition, isSelected, onSelect }) {
  const fullName = formatDriverName(driver.full_name, driver.name_acronym);
  const gapToLeader = driver.predicted_position - leaderPosition;
  const isWinner = index === 0;

  return (
    <button
      onClick={onSelect}
      className={`w-full group relative flex items-center h-24 px-5 rounded-2xl border text-left transition-colors duration-200 ${
        isSelected
          ? 'bg-white/[0.08] border-white/[0.2] shadow-[0_4px_24px_rgba(0,0,0,0.45)]'
          : 'bg-white/[0.02] border-white/[0.05] hover:bg-white/[0.05] hover:border-white/[0.12]'
      }`}
    >
      {/* Livery accent */}
      <div
        className="absolute left-0 top-2 bottom-2 w-1.5 rounded-full transition-all"
        style={{
          backgroundColor: driver.team_colour,
          boxShadow: isSelected ? `0 0 14px ${driver.team_colour}` : 'none',
          opacity: isSelected ? 1 : 0.5,
        }}
      />

      <div className="flex items-center gap-4 flex-1 min-w-0 pl-2">
        {/* Predicted position — ALWAYS the leaderboard rank, so it matches
            the detail panel on the left */}
        <span
          className={`w-12 shrink-0 text-center font-mono font-black text-2xl ${
            isWinner ? 'text-yellow-400' : 'text-zinc-300'
          }`}
        >
          P{index + 1}
        </span>

        <DriverAvatar driver={driver} size="lg" />

        {/* Name & team */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2.5 flex-wrap">
            <span
              className="shrink-0 text-lg tracking-wide text-white"
              style={{ fontFamily: 'Formula1-Display-Bold, Formula1-Bold, sans-serif' }}
            >
              {driver.name_acronym}
            </span>
            <span className="text-sm text-zinc-200 truncate leading-tight">{fullName}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-xs font-medium text-zinc-400 truncate">{driver.team_name}</span>
            <span className="text-xs font-mono text-zinc-500">
              · grid {driver.grid_position ? `P${driver.grid_position}` : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Win bar (main visible metric) */}
      <div className="hidden sm:block w-56 shrink-0 ml-2">
        <GlassInfo hintKey="winChance">
          <div className="flex items-center gap-3 w-full">
            <span className="shrink-0 text-xs font-mono text-zinc-400 uppercase">WIN</span>
            <div className="flex-1 h-3 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${Math.max(driver.p_win * 100, driver.p_win > 0 ? 1.5 : 0)}%`,
                  backgroundColor: driver.team_colour,
                }}
              />
            </div>
            <span className="shrink-0 w-14 text-right text-sm font-mono font-bold text-white">
              {pct(driver.p_win)}
            </span>
          </div>
        </GlassInfo>
      </div>

      {/* Podium / points / expected points */}
      <div className="hidden md:flex items-center gap-1.5 shrink-0 ml-4 font-mono">
        <GlassInfo hintKey="podiumChance">
          <span className="text-xs text-zinc-400 uppercase hover:text-white cursor-help">
            Pod.{' '}
            <span className="text-sm font-bold text-zinc-100">{pct(driver.p_podium)}</span>
          </span>
        </GlassInfo>
        <span className="text-zinc-700 mx-1.5">|</span>
        <GlassInfo hintKey="pointsChance">
          <span className="text-xs text-zinc-400 uppercase hover:text-white cursor-help">
            Pts{' '}
            <span className="text-sm font-bold text-zinc-100">{pct(driver.p_points)}</span>
          </span>
        </GlassInfo>
        <span className="text-zinc-700 mx-1.5">|</span>
        <GlassInfo hintKey="expectedPoints">
          <span className="text-xs text-zinc-400 uppercase hover:text-white cursor-help">
            Ø{' '}
            <span className="text-sm font-bold text-emerald-400">
              {driver.expected_points.toFixed(1)}
            </span>
          </span>
        </GlassInfo>
      </div>

      {/* Gap in positions */}
      <div className="shrink-0 ml-4 w-12 text-right">
        {gapToLeader > 0.25 ? (
          <span className="text-sm font-mono text-zinc-400">−{gapToLeader.toFixed(0)}</span>
        ) : null}
      </div>
    </button>
  );
});

/* ------------------------------------------------------------------ */
/* Panel: context ribbon, podium, detail, predicted grid               */
/* ------------------------------------------------------------------ */

export const PredictionsPanel: React.FC = memo(function PredictionsPanel() {
  const [raceSessions, setRaceSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<Session | null>(null);
  const [prediction, setPrediction] = useState<RacePrediction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const now = useMemo(() => new Date().toISOString(), []);
  const year = new Date().getFullYear();

  // 1. Load the race calendar; start on the most recent race that has
  //    already happened — upcoming races carry no data yet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sessions = await fetchSessions(year, 'Race');
        if (cancelled) return;
        const completed = sessions
          .filter((s) => s.date_start < now)
          .sort((a, b) => b.date_start.localeCompare(a.date_start));
        setRaceSessions(sessions);
        setSelected(completed[0] ?? null);
        if (!completed.length) {
          setError('No completed race weekend has data yet — predictions unlock after qualifying.');
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load race calendar');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [now, year]);

  // 2. Load prediction whenever the weekend changes
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchRacePrediction(selected.session_key)
      .then((res) => {
        if (cancelled) return;
        setPrediction(res);
        setSelectedNumber(res.predictions[0]?.driver_number ?? null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Prediction failed');
          setPrediction(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const selectedDriver = useMemo(
    () => prediction?.predictions.find((p) => p.driver_number === selectedNumber) ?? null,
    [prediction, selectedNumber],
  );
  const podium = useMemo(
    () => (prediction ? prediction.predictions.slice(0, 3) : []),
    [prediction],
  );

  return (
    <div className="relative flex-1 flex flex-col min-h-0 gap-3">
      {/* Loading overlay: whenever a prediction is being computed (tab switch
          or weekend change) a clear spinner covers the (stale) workspace */}
      {loading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm rounded-2xl">
          <div className="flex flex-col items-center gap-3 px-8 py-6 rounded-2xl border border-white/[0.12] bg-zinc-950/90 shadow-[0_16px_48px_rgba(0,0,0,0.7)]">
            <div className="h-8 w-8 rounded-full border-2 border-red-500 border-t-transparent animate-spin" />
            <span className="text-[11px] font-mono tracking-widest text-zinc-300 uppercase">
              Simulating 4,000 races…
            </span>
          </div>
        </div>
      )}
      {/* Weekend selector + context ribbon */}
      <div className="flex flex-wrap items-center gap-2.5 shrink-0">
        <div className="relative flex items-center bg-white/[0.04] px-3 py-2 rounded-xl border border-white/[0.08]">
          <Trophy size={14} className="text-yellow-400 mr-2 shrink-0" />
          <select
            className="bg-transparent text-sm font-bold text-white focus:outline-none cursor-pointer pr-3"
            value={selected?.session_key ?? ''}
            onChange={(e) => {
              const found = raceSessions.find((s) => s.session_key === Number(e.target.value));
              if (found) setSelected(found);
            }}
          >
            {raceSessions.map((s) => {
              const upcoming = s.date_start >= now;
              return (
                <option
                  key={s.session_key}
                  value={s.session_key}
                  disabled={upcoming}
                  className="bg-zinc-950"
                >
                  {s.country_name} — {s.circuit_short_name}
                  {upcoming ? '  ·  no data yet' : ''}
                </option>
              );
            })}
          </select>
        </div>

        {raceSessions.some((s) => s.date_start >= now) && (
          <span className="hidden xl:flex items-center gap-1.5 text-[10px] font-mono text-zinc-500">
            upcoming races are locked until session data is available
          </span>
        )}

        {prediction && (
          <>
            <GlassInfo hintKey="weather">
              <span
                className={`cursor-help flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-mono font-bold border ${
                  prediction.context.rain
                    ? 'text-sky-300 bg-sky-500/10 border-sky-500/30'
                    : 'text-zinc-200 bg-white/[0.04] border-white/[0.08]'
                }`}
              >
                {prediction.context.rain ? <CloudRain size={14} /> : <Sun size={14} />}
                {prediction.context.rain ? 'RAIN RISK' : 'DRY'}
              </span>
            </GlassInfo>
            {prediction.context.track_temp !== undefined && (
              <span className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-mono text-zinc-200 bg-white/[0.04] border border-white/[0.08]">
                <Thermometer size={14} className="text-zinc-500" />
                {prediction.context.track_temp}°C Track
                {prediction.context.air_temp !== undefined && (
                  <span className="text-zinc-500">/ {prediction.context.air_temp}°C Air</span>
                )}
              </span>
            )}
            <GlassInfo hintKey="engine">
              <span className="cursor-help flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-mono text-zinc-200 bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.2]">
                <Cpu
                  size={14}
                  className={
                    prediction.context.model_source.startsWith('xgboost')
                      ? 'text-emerald-400'
                      : 'text-zinc-500'
                  }
                />
                {prediction.context.model_source.startsWith('xgboost')
                  ? 'XGBOOST + BASELINE'
                  : 'BASELINE ENGINE'}
                <span className="text-[9px] text-zinc-600 ml-1">MC ×4000</span>
              </span>
            </GlassInfo>
          </>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="shrink-0 px-4 py-2.5 rounded-xl bg-red-950/70 border border-red-500/50 text-red-200 text-xs flex items-center gap-2">
          <AlertTriangle size={14} className="shrink-0" />
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !prediction && (
        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3 content-start">
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              className="h-24 rounded-2xl bg-white/[0.02] border border-white/[0.04] animate-pulse"
            />
          ))}
        </div>
      )}

      {/* Workspace */}
      {prediction && (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0">
          {/* Left: podium + (selection?) detail, nearly full height */}
          <div className="lg:col-span-4 flex flex-col gap-3 min-h-0">
            {/* Podium: P2 — P1 (raised, featured) — P3; three equal cards
                spread across the FULL width of the left column */}
            <div className="shrink-0 flex items-end justify-between gap-4 w-full">
              {podium.length >= 3 ? (
                <>
                  <div className="flex-1 min-w-0">
                    <PodiumStep
                      driver={podium[1]}
                      place={2}
                      height="13rem"
                      featured={false}
                      onSelect={() => setSelectedNumber(podium[1].driver_number)}
                    />
                  </div>
                  <div className="flex-1 min-w-0 z-10">
                    <PodiumStep
                      driver={podium[0]}
                      place={1}
                      height="16rem"
                      featured
                      onSelect={() => setSelectedNumber(podium[0].driver_number)}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <PodiumStep
                      driver={podium[2]}
                      place={3}
                      height="11.5rem"
                      featured={false}
                      onSelect={() => setSelectedNumber(podium[2].driver_number)}
                    />
                  </div>
                </>
              ) : (
                <div className="w-full h-32 rounded-2xl bg-white/[0.02] border border-white/[0.04] animate-pulse" />
              )}
            </div>

            {/* Full-height detail (default: race leader preselected).
                rank = index in the sorted prediction list + 1 — guarantees
                the P number here ALWAYS matches the leaderboard on the right */}
            {selectedDriver ? (
              <DriverDetail
                key={selectedDriver.driver_number}
                driver={selectedDriver}
                rank={
                  (prediction.predictions.findIndex(
                    (p) => p.driver_number === selectedDriver.driver_number,
                  ) + 1) || 1
                }
                onClose={() => setSelectedNumber(null)}
              />
            ) : (
              <div className="flex-1 min-h-0 rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] flex flex-col items-center justify-center gap-2 text-center p-6">
                <MousePointerClick size={20} className="text-zinc-600" />
                <p className="text-xs text-zinc-500 font-mono">
                  Select any driver on the right or on the podium for the full prediction breakdown
                </p>
              </div>
            )}
          </div>

          {/* Right: full predicted grid */}
          <div className="lg:col-span-8 flex flex-col min-h-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.03] to-black/60 shadow-[0_16px_40px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4 bg-white/[0.02]">
              <div>
                <h3 className="text-base font-extrabold tracking-wider text-white uppercase">
                  Predicted Race Outcome
                </h3>
                <p className="text-[11px] font-mono text-zinc-400">
                  {prediction.context.circuit} · {prediction.context.country} — hover any number for
                  its meaning, click a row for the full breakdown
                </p>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5 custom-scrollbar">
              {prediction.predictions.map((driver, index) => (
                <PredictedRow
                  key={driver.driver_number}
                  driver={driver}
                  index={index}
                  leaderPosition={prediction.predictions[0].predicted_position}
                  isSelected={selectedNumber === driver.driver_number}
                  onSelect={() =>
                    setSelectedNumber(
                      selectedNumber === driver.driver_number ? null : driver.driver_number,
                    )
                  }
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
