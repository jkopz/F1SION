"""F1 Data Exploration Script.

Inspects FastF1 and OpenF1 data structures:
1. Configures local disk cache.
2. Fetches session metadata (e.g. Monza 2024 Qualifying).
3. Analyzes fastest laps and extracts spatial X/Y telemetry coordinates.
"""

from pathlib import Path
import fastf1

# 1. Enable local FastF1 cache
CACHE_DIR = Path(__file__).resolve().parent.parent / "fastf1_cache"
CACHE_DIR.mkdir(exist_ok=True)
fastf1.Cache.enable_cache(str(CACHE_DIR))
print(f"FastF1 cache enabled at: {CACHE_DIR}")

# 2. Load session (Monza 2024 Qualifying)
print("\nLoading session: Monza 2024 Qualifying...")
session = fastf1.get_session(2024, "Monza", "Q")
session.load(telemetry=True, laps=True, weather=True)

print(f"Session loaded: {session.event['EventName']} ({session.event['EventDate']})")

# 3. Top 5 results
print("\nTop 5 Qualifying Results:")
top5 = session.results.head(5)[["Position", "Abbreviation", "TeamName", "Q3"]]
print(top5.to_string(index=False))

# 4. Fastest lap
fastest_lap = session.laps.pick_fastest()
print(
    f"\nFastest Lap: {fastest_lap['Driver']} - "
    f"{fastest_lap['LapTime']} (Compound: {fastest_lap['Compound']})"
)

# 5. Telemetry details
telemetry = fastest_lap.get_telemetry()
print(f"\nTotal Telemetry Samples: {len(telemetry)}")
print(telemetry[["Speed", "Throttle", "Brake", "X", "Y"]].head(10).to_string())

# 6. Spatial coordinate boundaries
min_x, max_x = telemetry["X"].min(), telemetry["X"].max()
min_y, max_y = telemetry["Y"].min(), telemetry["Y"].max()
print(f"\nCircuit Coordinate Bounds:")
print(f"   X: [{min_x:.0f} to {max_x:.0f}]")
print(f"   Y: [{min_y:.0f} to {max_y:.0f}]")
