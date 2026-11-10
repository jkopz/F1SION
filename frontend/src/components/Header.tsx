import React from 'react';
import { Session } from '../types/f1';
import { Radio, Calendar, Sparkles, Activity, Power, Zap } from 'lucide-react';

interface HeaderProps {
  sessions: Session[];
  selectedSession: Session | null;
  onSelectSession: (session: Session) => void;
  year: number;
  activeTab: string;
  onSelectTab: (tab: string) => void;
  onShutdownRequest: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  sessions,
  selectedSession,
  onSelectSession,
  year,
  activeTab,
  onSelectTab,
  onShutdownRequest,
}) => {
  const tabs = [
    { id: 'qualifying', label: 'QUALIFYING ANALYSIS', icon: Activity, active: true },
    { id: 'race', label: 'RACE TELEMETRY', icon: Radio, badge: 'PREVIEW' },
    { id: 'predictions', label: 'AI PREDICTIONS', icon: Sparkles, badge: 'NEXT' },
  ];

  return (
    <header className="border-b border-white/[0.08] bg-black/70 backdrop-blur-2xl sticky top-0 z-50 px-6 py-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Brand: F1SION */}
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-red-600 to-red-500 flex items-center justify-center shadow-[0_0_20px_rgba(225,6,0,0.5)] border border-red-400/40">
            <Zap className="text-white" size={19} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-f1-black tracking-wider uppercase flex items-center leading-none">
                <span className="text-[#E10600]">F1</span>
                <span className="text-white">SION</span>
              </h1>
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-[10px] font-mono text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                <span>ONLINE</span>
              </div>
            </div>
            <p className="text-[10px] font-mono text-zinc-400 tracking-tight">
              Beyond the race. <span className="text-zinc-200">Into the data.</span>
            </p>
          </div>
        </div>

        {/* Navigation Tabs Bar */}
        <nav className="flex items-center gap-1 bg-white/[0.04] p-1 rounded-xl border border-white/[0.06] backdrop-blur-md">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isCurrent = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onSelectTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${
                  isCurrent
                    ? 'bg-red-600 text-white shadow-[0_2px_12px_rgba(225,6,0,0.4)]'
                    : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                <Icon size={13} />
                <span className="tracking-wide">{tab.label}</span>
                {tab.badge && (
                  <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono ${
                    isCurrent ? 'bg-black/30 text-white' : 'bg-white/[0.08] text-zinc-400'
                  }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Grand Prix & Season Selectors */}
        <div className="flex items-center gap-2.5">
          <div className="hidden sm:flex items-center gap-1.5 bg-white/[0.04] px-3 py-1.5 rounded-xl border border-white/[0.06] text-xs font-mono text-zinc-300">
            <Calendar size={13} className="text-zinc-400" />
            <span>SEASON {year}</span>
          </div>

          <div className="relative flex items-center bg-white/[0.04] px-3 py-1.5 rounded-xl border border-white/[0.08] hover:border-white/[0.15] transition-colors">
            <Radio size={13} className="text-red-500 mr-2 shrink-0" />
            <select
              className="bg-transparent text-xs font-bold text-white focus:outline-none cursor-pointer pr-3 font-sans"
              value={selectedSession?.session_key || ''}
              onChange={(e) => {
                const targetKey = Number(e.target.value);
                const found = sessions.find((s) => s.session_key === targetKey);
                if (found) onSelectSession(found);
              }}
            >
              {sessions.map((s) => (
                <option
                  key={s.session_key}
                  value={s.session_key}
                  className="bg-zinc-950 text-white font-sans py-1"
                >
                  {s.country_name} ({s.circuit_short_name}) - {s.session_name}
                </option>
              ))}
            </select>
          </div>

          {/* Clean Shutdown / Power Button */}
          <button
            onClick={onShutdownRequest}
            title="Shut Down F1SION Session Cleanly"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-500/30 bg-red-600/10 hover:bg-red-600 text-red-400 hover:text-white transition-all shadow-sm hover:shadow-[0_0_15px_rgba(239,68,68,0.5)] active:scale-95 text-xs font-bold font-mono"
          >
            <Power size={13} />
            <span className="hidden md:inline">STOP</span>
          </button>
        </div>
      </div>
    </header>
  );
};
