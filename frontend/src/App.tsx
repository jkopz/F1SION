import React, { useEffect, useRef, useState } from 'react';
import { Header } from './components/Header';
import { CircuitMap } from './components/CircuitMap';
import { Leaderboard } from './components/Leaderboard';
import {
  fetchDriverLap,
  fetchDrivers,
  fetchFastestLapPerDriver,
  fetchSessions,
  fetchTrackLayout,
  shutdownServer,
} from './services/api';
import { formatTimeMMSS } from './utils/driver';
import { Driver, DriverLap, Session, TrackLayout } from './types/f1';
import { Activity, Zap, Cpu, Sparkles, ChevronRight, Power, CheckCircle, AlertTriangle } from 'lucide-react';

/** Subtle cursor-following livery glow — tuned down from the original */
function CursorGlow({ color }: { color: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const move = (e: MouseEvent) => {
      el.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%)`;
    };
    window.addEventListener('mousemove', move, { passive: true });
    return () => window.removeEventListener('mousemove', move);
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[4] h-[380px] w-[380px] rounded-full mix-blend-screen"
      style={{
        // reduced: 73→40 opacity, 2e→16, 68%→62% spread
        background: `radial-gradient(circle, ${color}40 0%, ${color}16 32%, transparent 62%)`,
        willChange: 'transform',
        opacity: 0.75,
      }}
    />
  );
}

export const App: React.FC = () => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [layout, setLayout] = useState<TrackLayout | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [driverLap, setDriverLap] = useState<DriverLap | null>(null);
  const [fastestLaps, setFastestLaps] = useState<Map<number, number>>(new Map());
  const [activeTab, setActiveTab] = useState<string>('qualifying');
  const [error, setError] = useState<string | null>(null);
  const [showShutdownModal, setShowShutdownModal] = useState<boolean>(false);
  const [isShutDown, setIsShutDown] = useState<boolean>(false);

  // 1. Initial load: fetch 2026 Qualifying sessions only
  useEffect(() => {
    async function loadInitialData() {
      try {
        // Fetch only 2026 sessions
        const sessions2026 = await fetchSessions(2026, 'Qualifying');
        
        // Filter out sessions that haven't happened yet (date_start > now)
        const now = new Date();
        const pastSessions = sessions2026.filter(s => {
          const sessionDate = new Date(s.date_start);
          return sessionDate <= now;
        });
        
        // Sort by date (newest first)
        const sortedSessions = pastSessions
          .sort((a, b) => b.date_start.localeCompare(a.date_start));
        
        setSessions(sortedSessions);

        // Select most recent past session by default
        const initial = sortedSessions[0] || null;
        if (initial) {
          setSelectedSession(initial);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to connect to F1SION backend';
        setError(message);
      }
    }

    loadInitialData();
  }, []);

  // 2. When session changes: load track + drivers, then auto-select fastest driver
  useEffect(() => {
    if (!selectedSession) return;

    const currentKey = selectedSession.session_key;

    async function loadSessionDetails() {
      try {
        setLayout(null);
        setDriverLap(null);
        setError(null);

        // Fetch track, drivers and fastest-lap data in parallel
        const [trackData, driverList, fastestLaps] = await Promise.all([
          fetchTrackLayout(currentKey),
          fetchDrivers(currentKey),
          fetchFastestLapPerDriver(currentKey),
        ]);

        setLayout(trackData);
        
        // Sort drivers by fastest lap time (slowest to fastest, then reverse for descending)
        const driversWithTimes = driverList.map(driver => ({
          driver,
          lapTime: fastestLaps.get(driver.driver_number) || Infinity
        }));
        
        // Sort by lap time ascending (fastest first), but we want fastest at top
        // So we sort by lapTime ascending, then reverse to get fastest first
        const sortedDrivers = driversWithTimes
          .sort((a, b) => a.lapTime - b.lapTime)
          .map(item => item.driver);
        
        setDrivers(sortedDrivers);
        setFastestLaps(fastestLaps);

        if (sortedDrivers.length > 0) {
          // Auto-select the driver with the fastest lap time for all sessions
          // This ensures autoplay always shows the quickest driver
          setSelectedDriver(sortedDrivers[0]);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Error loading session telemetry';
        setError(message);
      }
    }

    loadSessionDetails();
  }, [selectedSession]);

  // 3. When driver changes: load driver-specific fastest lap telemetry
  useEffect(() => {
    if (!selectedSession || !selectedDriver) return;

    async function loadDriverTelemetry() {
      try {
        const lapData = await fetchDriverLap(
          selectedSession!.session_key,
          selectedDriver!.driver_number
        );
        setDriverLap(lapData);
      } catch {
        setDriverLap(null);
      }
    }

    loadDriverTelemetry();
  }, [selectedSession, selectedDriver]);

  const activeLiveryColor = selectedDriver?.team_colour || '#E10600';

  const handleConfirmShutdown = async () => {
    setShowShutdownModal(false);
    setIsShutDown(true);
    await shutdownServer();
  };

  // Poll for backend revival after shutdown so user can seamlessly reconnect
  useEffect(() => {
    if (!isShutDown) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/health');
        if (res.ok) {
          clearInterval(interval);
          window.location.reload();
        }
      } catch {
        // Still offline, continue polling
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [isShutDown]);

  if (isShutDown) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#07080B] text-white p-6 selection:bg-red-600">
        <div className="max-w-md w-full p-8 rounded-2xl border border-white/[0.08] bg-black/60 backdrop-blur-2xl text-center space-y-4 shadow-2xl">
          <div className="h-14 w-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto">
            <CheckCircle size={28} />
          </div>
          <h2 className="text-xl font-black tracking-wider text-white uppercase">
            F1SION Stopped
          </h2>
          <p className="text-xs text-zinc-400 leading-relaxed font-mono">
            Backend &amp; development processes were terminated cleanly.
          </p>
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] text-left text-[11px] font-mono text-zinc-300 space-y-1">
            <div className="text-zinc-500">To start F1SION again:</div>
            <div className="text-red-400 font-bold">$ ./run_dev.sh</div>
            <div className="text-[10px] text-zinc-400 pt-1">
              (This page will automatically reconnect once the server is back online)
            </div>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="w-full py-2.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.15] text-white text-xs font-bold transition-all"
          >
            Reconnect Now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen flex flex-col bg-[#07080B] text-white overflow-hidden selection:bg-red-600 selection:text-white">
      <CursorGlow color={activeLiveryColor} />

      {/* Drifting team-colour ambient blooms */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="livery-orb livery-orb-a" style={{ backgroundColor: activeLiveryColor }} />
        <div className="livery-orb livery-orb-b" style={{ backgroundColor: activeLiveryColor }} />
        <div className="livery-orb livery-orb-c" style={{ backgroundColor: activeLiveryColor }} />
      </div>

      {/* Global Command Header */}
      <Header
        sessions={sessions}
        selectedSession={selectedSession}
        onSelectSession={setSelectedSession}
        year={selectedSession?.year || 2026}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onShutdownRequest={() => setShowShutdownModal(true)}
      />

      {/* Error notification banner */}
      {error && (
        <div className="mx-6 mt-3 px-4 py-2 rounded-xl bg-red-950/70 border border-red-500/50 text-red-200 text-xs flex items-center justify-between z-40 backdrop-blur-md">
          <span>⚠️ {error}</span>
          <button
            onClick={() => setError(null)}
            className="text-[11px] font-mono underline hover:text-white"
          >
            DISMISS
          </button>
        </div>
      )}

      {/* Main Qualifying Analysis Viewport */}
      <main className="flex-1 flex flex-col p-4 md:p-6 overflow-hidden gap-4">
        {/* Quick Metrics Ribbon */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-xl">
            <div className="p-2 rounded-lg bg-red-600/20 text-red-400 border border-red-500/30">
              <Activity size={16} />
            </div>
            <div>
              <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider block">CIRCUIT</span>
              <span className="text-xs font-bold text-white uppercase">
                {selectedSession ? `${selectedSession.circuit_short_name}` : '...'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-xl">
            <div className="p-2 rounded-lg bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
              <Zap size={16} />
            </div>
            <div>
              <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider block">SESSION POLE</span>
              <span className="text-xs font-mono font-bold text-white">
                {layout?.lap_duration ? formatTimeMMSS(layout.lap_duration) : '--.---'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-xl">
            <div className="p-2 rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
              <Cpu size={16} />
            </div>
            <div>
              <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider block">ACTIVE DRIVER LAP</span>
              <span className="text-xs font-mono font-bold text-cyan-400">
                {driverLap?.lap_duration ? formatTimeMMSS(driverLap.lap_duration) : 'CALCULATING...'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-xl">
            <div className="p-2 rounded-lg bg-purple-500/20 text-purple-400 border border-purple-500/30">
              <Sparkles size={16} />
            </div>
            <div>
              <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider block">TIRE COMPOUND</span>
              <span className="text-xs font-mono font-bold text-purple-300">
                {driverLap?.compound && driverLap.compound !== 'UNKNOWN' ? driverLap.compound : 'SOFT (C4)'}
              </span>
            </div>
          </div>
        </div>

        {/* Primary Workspace: Full Responsive Split */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0">
          {/* Left 8-9 cols: Circuit Map & Telemetry Canvas */}
          <div className="lg:col-span-8 xl:col-span-9 h-full flex flex-col min-h-0">
            <CircuitMap
              layout={layout}
              selectedDriver={selectedDriver}
              driverLap={driverLap}
              circuitName={selectedSession?.circuit_short_name}
              countryName={selectedSession?.country_name}
              error={error}
            />
          </div>

          {/* Right 3-4 cols: Driver Leaderboard */}
          <div className="lg:col-span-4 xl:col-span-3 h-full flex flex-col min-h-0">
            <Leaderboard
              drivers={drivers}
              selectedDriver={selectedDriver}
              driverLaps={fastestLaps}
              driverLap={driverLap}
              onSelectDriver={setSelectedDriver}
            />
          </div>
        </div>
      </main>

      {/* Keep activeTab wired even though other tabs are locked */}
      {activeTab !== 'qualifying' && (
        <div className="hidden">
          <ChevronRight />
        </div>
      )}

      {/* Shutdown Confirmation Modal */}
      {showShutdownModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
          <div
            className="max-w-sm w-full p-6 rounded-2xl border border-red-500/30 bg-[#0F1117] text-center space-y-4 shadow-[0_16px_50px_rgba(0,0,0,0.9)]"
            style={{ animation: 'fadeInScale 150ms ease-out' }}
          >
            <div className="h-12 w-12 rounded-2xl bg-red-600/20 text-red-500 flex items-center justify-center mx-auto border border-red-500/40">
              <AlertTriangle size={24} />
            </div>
            <div>
              <h3 className="text-base font-bold text-white uppercase tracking-wider">
                Shut Down F1SION?
              </h3>
              <p className="text-xs text-zinc-400 mt-1 font-mono">
                This will gracefully terminate all backend and development server processes.
              </p>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setShowShutdownModal(false)}
                className="flex-1 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300 hover:text-white text-xs font-bold transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmShutdown}
                className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-all shadow-[0_0_15px_rgba(225,6,0,0.4)] flex items-center justify-center gap-1.5"
              >
                <Power size={13} />
                <span>Shut Down</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
