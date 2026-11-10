import React from 'react';
import { Driver, DriverLap } from '../types/f1';
import { Trophy, ChevronRight, Timer } from 'lucide-react';
import { cleanHeadshotUrl, formatDriverName, getCountryFlag } from '../utils/driver';

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
          const headshotUrl = cleanHeadshotUrl(driver.headshot_url);
          const flag = getCountryFlag(driver.country_code);
          const fullName = formatDriverName(driver.full_name, driver.broadcast_name);

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

              <div className="flex items-center gap-2.5 pl-2 min-w-0">
                {/* Position */}
                <span className={`w-4 shrink-0 text-center font-mono text-xs font-bold ${
                  isPole ? 'text-yellow-400' : 'text-zinc-500'
                }`}>
                  {index + 1}
                </span>

                {/* Driver Headshot */}
                <div className="relative h-8 w-8 rounded-full overflow-hidden border border-white/[0.1] bg-black/40 shrink-0">
                  {headshotUrl ? (
                    <img
                      src={headshotUrl}
                      alt={driver.broadcast_name}
                      className="h-full w-full object-cover object-top"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                        // Show fallback number badge
                        const parent = (e.target as HTMLImageElement).parentElement;
                        if (parent) {
                          const fallback = document.createElement('div');
                          fallback.className = 'h-full w-full flex items-center justify-center text-[9px] font-bold text-white';
                          fallback.textContent = driver.name_acronym;
                          parent.appendChild(fallback);
                        }
                      }}
                    />
                  ) : (
                    <div
                      className="h-full w-full flex items-center justify-center text-[9px] font-bold text-white"
                      style={{ backgroundColor: `${driver.team_colour}40` }}
                    >
                      {driver.name_acronym}
                    </div>
                  )}
                </div>

                {/* Driver Name & Team */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {/* Acronym in Display Bold */}
                    <span className="shrink-0 text-[11px] tracking-wide text-white" style={{ fontFamily: 'Formula1-Display-Bold, Formula1-Bold, sans-serif' }}>
                      {driver.name_acronym}
                    </span>
                    {/* Flag */}
                    {flag && (
                      <span className="text-[13px] leading-none shrink-0" title={driver.country_code}>
                        {flag}
                      </span>
                    )}
                  </div>
                  {/* Full Name */}
                  <span className="text-[10px] text-zinc-300 truncate block leading-tight">
                    {fullName}
                  </span>
                  <span className="text-[9px] font-medium text-zinc-500 truncate block leading-tight">
                    {driver.team_name}
                  </span>
                </div>
              </div>

              {/* Lap Time or Chevron */}
              <div className="flex items-center gap-1.5 shrink-0 ml-1">
                {isSelected && driverLap?.lap_duration ? (
                  <div className="flex items-center gap-1 text-[10px] font-mono font-bold text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded border border-green-500/20">
                    <Timer size={9} />
                    <span>{driverLap.lap_duration.toFixed(3)}s</span>
                  </div>
                ) : (
                  <ChevronRight
                    size={13}
                    className={`text-zinc-600 transition-transform ${
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
