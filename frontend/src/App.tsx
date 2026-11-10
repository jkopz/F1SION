import React, { useEffect, useRef, useState } from 'react';
import { Header } from './components/Header';
import { CircuitMap } from './components/CircuitMap';
import { Leaderboard } from './components/Leaderboard';
import { fetchDriverLap, fetchDrivers, fetchSessions, fetchTrackLayout, shutdownServer } from './services/api';
import { Driver, DriverLap, Session, TrackLayout } from './types/f1';
import { Activity, Zap, Cpu, Sparkles, ChevronRight, Power, CheckCircle, AlertTriangle } from 'lucide-react';

function CursorGlow({ color }: { color: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const move = (event: MouseEvent) => {
      el.style.transform = `translate(${event.clientX}px, ${event.clientY}px) translate(-50%, -50%)`;
    };

    window.addEventListener('mousemove', move, { passive: true });
    return () => window.removeEventListener('mousemove', move);
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[4] h-[520px] w-[520px] rounded-full mix-blend-screen"
      style={{
        background: `radial-gradient(circle, ${color}73 0%, ${color}2e 34%, transparent 68%)`,
        willChange: 'transform',
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
  const [activeTab, setActiveTab] = useState<string>('qualifying');
  const [error, setError] = useState<string | null>(null);
  const [showShutdownModal, setShowShutdownModal] = useState<boolean>(false);
  const [isShutDown, setIsShutDown] = useState<boolean>(false);

  // 1. Initial load: fetch 2024 Qualifying sessions
  useEffect(() => {
    async function loadInitialData() {
      try {
        const fetchedSessions = await fetchSessions(2024, 'Qualifying');
        setSessions(fetchedSessions);

        const initial =
          fetchedSessions.find((s) => s.circuit_short_name === 'Monza') ||
          fetchedSessions[0];

        if (initial) {
          setSelectedSession(initial);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to connect to F1SION backend');
      }
    }

    loadInitialData();
  }, []);

  // 2. When session changes, load circuit layout and drivers
  useEffect(() => {
    if (!selectedSession) return;

    const currentKey = selectedSession.session_key;

    async function loadSessionDetails() {
      try {
        setLayout(null);
        setError(null);
        const [trackData, driverList] = await Promise.all([
          fetchTrackLayout(currentKey),
          fetchDrivers(currentKey),
        ]);

        setLayout(trackData);
        setDrivers(driverList);

        if (driverList.length > 0) {
          setSelectedDriver(driverList[0]);
        }
      } catch (err: any) {
        setError(err.message || 'Error loading session telemetry');
      }
    }

    loadSessionDetails();
  }, [selectedSession]);

  // 3. When driver changes, load driver-specific lap telemetry
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
        // Fallback to null if driver has no lap
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

  // When shut down, poll for backend revival so user can seamlessly reconnect
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
            Backend & development processes were terminated cleanly.
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

      {/* Drifting team-colour blooms */}
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
        year={2024}
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

      {/* Main Command Center Viewport */}
      {activeTab === 'qualifying' && (
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
                  {layout?.lap_duration ? `${layout.lap_duration.toFixed(3)}s` : '--.---'}
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
                  {driverLap?.lap_duration ? `${driverLap.lap_duration.toFixed(3)}s` : 'CALCULATING...'}
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
            {/* Left 8-9 cols: High-End Circuit Map & Scrubbable Telemetry Canvas */}
            <div className="lg:col-span-8 xl:col-span-9 h-full flex flex-col min-h-0">
              <CircuitMap
                layout={layout}
                selectedDriver={selectedDriver}
                driverLap={driverLap}
                circuitName={selectedSession?.circuit_short_name}
                countryName={selectedSession?.country_name}
              />
            </div>

            {/* Right 3-4 cols: Driver Leaderboard & Telemetry Sidebar */}
            <div className="lg:col-span-4 xl:col-span-3 h-full flex flex-col min-h-0">
              <Leaderboard
                drivers={drivers}
                selectedDriver={selectedDriver}
                driverLap={driverLap}
                onSelectDriver={setSelectedDriver}
              />
            </div>
          </div>
        </main>
      )}

      {/* Preview placeholder for other tabs */}
      {activeTab !== 'qualifying' && (
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full p-8 rounded-2xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-2xl text-center space-y-4 shadow-2xl">
            <div className="h-12 w-12 rounded-2xl bg-red-600/20 border border-red-500/40 text-red-500 flex items-center justify-center mx-auto">
              <Sparkles size={24} />
            </div>
            <h3 className="text-lg font-bold text-white uppercase tracking-wider">
              {activeTab === 'predictions' ? 'Machine Learning Predictions' : 'Race Telemetry Engine'}
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              This module connects directly to our Python Machine Learning pipeline for model inference, feature importance, and strategy optimization.
            </p>
            <button
              onClick={() => setActiveTab('qualifying')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-all"
            >
              <span>Back to Qualifying Analysis</span>
              <ChevronRight size={14} />
            </button>
          </div>
        </main>
      )}
      {/* Shutdown Confirmation Modal */}
      {showShutdownModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
          <div className="max-w-sm w-full p-6 rounded-2xl border border-red-500/30 bg-[#0F1117] text-center space-y-4 shadow-[0_16px_50px_rgba(0,0,0,0.9)] animate-in fade-in zoom-in-95 duration-150">
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
