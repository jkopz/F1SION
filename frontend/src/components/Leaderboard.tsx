import React from 'react';
import { Driver, DriverLap } from '../types/f1';
import { Trophy, ChevronRight, Timer } from 'lucide-react';

interface LeaderboardProps {
  drivers: Driver[];
  selectedDriver: Driver | null;
  driverLap: DriverLap | null;
  onSelectDriver: (driver: Driver) => void;
}

export const Leaderboard: React.FC<LeaderboardProps> = ({
  drivers,
  selectedDriver,
  driverLap,
  onSelectDriver,
}) => {
  return (
    <div className="flex flex-col h-full overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.03] to-black/60 shadow-[0_16px_40px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4 bg-white/[0.02]">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
            <Trophy size={14} />
          </div>
          <div>
            <h3 className="text-sm font-extrabold tracking-wider text-white uppercase">
              Grid Lineup
            </h3>
            <p className="text-[10px] font-mono text-zinc-400">
              {drivers.length} Drivers Qualified
            </p>
          </div>
        </div>
      </div>

      {/* Driver List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5 custom-scrollbar">
        {drivers.map((driver, index) => {
          const isSelected = selectedDriver?.driver_number === driver.driver_number;
          const isPole = index === 0;

          return (
            <button
              key={driver.driver_number}
              onClick={() => onSelectDriver(driver)}
              className={`w-full group relative flex items-center justify-between p-2.5 rounded-xl transition-all duration-200 border text-left ${
                isSelected
                  ? 'bg-white/[0.08] border-white/[0.2] shadow-[0_4px_20px_rgba(0,0,0,0.4)] translate-x-1'
                  : 'bg-white/[0.02] border-white/[0.04] hover:bg-white/[0.05] hover:border-white/[0.1]'
              }`}
            >
              {/* Active glow accent bar */}
              <div
                className={`absolute left-0 top-1 bottom-1 w-1 rounded-full transition-all ${
                  isSelected ? 'opacity-100' : 'opacity-40 group-hover:opacity-75'
                }`}
                style={{
                  backgroundColor: driver.team_colour,
                  boxShadow: isSelected ? `0 0 12px ${driver.team_colour}` : 'none',
                }}
              />

              <div className="flex items-center gap-3 pl-2">
                {/* Position / Pole Indicator */}
                <span className={`w-5 text-center font-mono text-xs font-bold ${
                  isPole ? 'text-yellow-400' : 'text-zinc-400'
                }`}>
                  {index + 1}
                </span>

                {/* Driver Headshot or Number Badge */}
                <div className="relative h-8 w-8 rounded-full overflow-hidden border border-white/[0.1] bg-black/40 shrink-0">
                  {driver.headshot_url ? (
                    <img
                      src={driver.headshot_url}
                      alt={driver.broadcast_name}
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center font-f1-wide text-[9px] text-zinc-200">
                      {driver.name_acronym}
                    </div>
                  )}
                </div>

                {/* Driver & Team Info */}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-f1-wide shrink-0 text-[11px] tracking-wide text-white">
                      {driver.name_acronym}
                    </span>
                    <span className="max-w-[88px] truncate text-[11px] font-semibold text-zinc-300">
                      {driver.broadcast_name}
                    </span>
                    <span
                      className="text-[9px] font-mono font-bold px-1 rounded"
                      style={{
                        backgroundColor: `${driver.team_colour}25`,
                        color: driver.team_colour,
                      }}
                    >
                      #{driver.driver_number}
                    </span>
                  </div>
                  <span className="text-[10px] font-medium text-zinc-400 truncate max-w-[130px] block">
                    {driver.team_name}
                  </span>
                </div>
              </div>

              {/* Lap Time or Active Telemetry Pill */}
              <div className="flex items-center gap-2">
                {isSelected && driverLap?.lap_duration ? (
                  <div className="flex items-center gap-1 text-[11px] font-mono font-bold text-green-400 bg-green-500/10 px-2 py-0.5 rounded border border-green-500/20">
                    <Timer size={10} />
                    <span>{driverLap.lap_duration.toFixed(3)}s</span>
                  </div>
                ) : (
                  <ChevronRight
                    size={14}
                    className={`text-zinc-500 transition-transform ${
                      isSelected ? 'text-white translate-x-0.5' : 'group-hover:translate-x-0.5'
                    }`}
                  />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
