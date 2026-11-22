import React, { memo } from 'react';
import { Driver, DriverLap } from '../types/f1';
import { Trophy, ChevronRight, Timer } from 'lucide-react';
import { cleanHeadshotUrl, formatDriverName, formatGap, formatTimeMMSS } from '../utils/driver';

interface LeaderboardProps {
  drivers: Driver[];
  selectedDriver: Driver | null;
  driverLaps: Map<number, number>;
  driverLap: DriverLap | null;
  onSelectDriver: (driver: Driver) => void;
}

// Memoised: App re-renders (e.g. modal state) must not re-render every row
export const Leaderboard: React.FC<LeaderboardProps> = memo(function Leaderboard({
  drivers,
  selectedDriver,
  driverLaps,
  driverLap,
  onSelectDriver,
}) {
  // Pole reference = fastest lap of the session (P1 in the sorted list)
  const poleTime = drivers.length ? driverLaps.get(drivers[0].driver_number) : undefined;

  return (
    <div className="flex flex-col h-full overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.03] to-black/60 shadow-[0_16px_40px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4 bg-white/[0.02]">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
            <Trophy size={16} />
          </div>
          <div>
            <h3 className="text-base font-extrabold tracking-wider text-white uppercase">
              Fastest Laps
            </h3>
            <p className="text-[11px] font-mono text-zinc-400">
              {drivers.length} Drivers Qualified
            </p>
          </div>
        </div>
      </div>

      {/* Driver List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5 custom-scrollbar">
        {drivers.map((driver, index) => {
          const isSelected = selectedDriver?.driver_number === driver.driver_number;
          const isPole = index === 0;
          const lapTime = driverLaps.get(driver.driver_number);
          const headshotUrl = cleanHeadshotUrl(driver.headshot_url);
          const fullName = formatDriverName(driver.full_name, driver.broadcast_name);

          // Timing-tower logic: P1 shows the lap time, everyone else the gap to pole
          const rowTime =
            lapTime === undefined
              ? undefined
              : isPole || poleTime === undefined
              ? formatTimeMMSS(lapTime)
              : formatGap(lapTime - poleTime);

          return (
            <button
              key={driver.driver_number}
              onClick={() => onSelectDriver(driver)}
              className={`w-full group relative flex items-center justify-between h-24 px-5 rounded-2xl transition-colors duration-200 border text-left ${
                isSelected
                  ? 'bg-white/[0.08] border-white/[0.2] shadow-[0_4px_20px_rgba(0,0,0,0.4)]'
                  : 'bg-white/[0.02] border-white/[0.05] hover:bg-white/[0.05] hover:border-white/[0.12]'
              }`}
            >
              {/* Active glow accent bar */}
              <div
                className={`absolute left-0 top-2 bottom-2 w-1.5 rounded-full transition-all ${
                  isSelected ? 'opacity-100' : 'opacity-40 group-hover:opacity-75'
                }`}
                style={{
                  backgroundColor: driver.team_colour,
                  boxShadow: isSelected ? `0 0 12px ${driver.team_colour}` : 'none',
                }}
              />

              <div className="flex items-center gap-4 pl-2 min-w-0">
                {/* Position (based on lap time ranking, not quali position) */}
                <span className={`w-12 shrink-0 text-center font-mono text-2xl font-black ${
                  isPole ? 'text-yellow-400' : 'text-zinc-300'
                }`}>
                  P{index + 1}
                </span>

                {/* Driver Headshot */}
                <div className="relative h-14 w-14 rounded-2xl overflow-hidden border border-white/[0.12] bg-black/40 shrink-0">
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
                          fallback.className = 'h-full w-full flex items-center justify-center text-[11px] font-bold text-white';
                          fallback.textContent = driver.name_acronym;
                          parent.appendChild(fallback);
                        }
                      }}
                    />
                  ) : (
                    <div
                      className="h-full w-full flex items-center justify-center text-[11px] font-bold text-white"
                      style={{ backgroundColor: `${driver.team_colour}40` }}
                    >
                      {driver.name_acronym}
                    </div>
                  )}
                </div>

                {/* Driver Name & Team */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2.5 flex-wrap">
                    {/* Acronym in Display Bold */}
                    <span className="shrink-0 text-lg tracking-wide text-white" style={{ fontFamily: 'Formula1-Display-Bold, Formula1-Bold, sans-serif' }}>
                      {driver.name_acronym}
                    </span>
                    {/* Full Name */}
                    <span className="text-sm text-zinc-200 truncate leading-tight">
                      {fullName}
                    </span>
                  </div>
                  <span className="text-xs font-medium text-zinc-400 truncate block leading-tight mt-1">
                    {driver.team_name}
                  </span>
                </div>
              </div>

              {/* Lap Time (P1) or Gap to Pole, Chevron when no data */}
              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                {rowTime !== undefined ? (
                  isSelected && driverLap?.lap_duration ? (
                    <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-green-400 bg-green-500/10 px-2.5 py-1.5 rounded-lg border border-green-500/25">
                      <Timer size={12} />
                      <span>{rowTime}</span>
                    </div>
                  ) : (
                    <span className="text-base font-mono font-bold text-zinc-100 px-2 py-1 rounded-lg">
                      {rowTime}
                    </span>
                  )
                ) : (
                  <ChevronRight
                    size={16}
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
});
