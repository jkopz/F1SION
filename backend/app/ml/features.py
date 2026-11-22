"""Feature engineering for the F1SION race predictor.

Builds a per-driver feature bundle for a Grand Prix weekend from OpenF1
data: practice/qualifying pace, long-run pace, grid position, track
history and recent form, plus weekend context (weather, circuit).

All OpenF1 responses are served through the cached client, so repeated
predictions and training runs are fast and rate-limit friendly.
"""

from __future__ import annotations

import statistics
from typing import Any, Optional

from app.data.openf1 import OpenF1Client

PRACTICE_SESSION_NAMES = ("Practice 1", "Practice 2", "Practice 3")

# Outlier cap for long-run pace: laps slower than this multiple of the
# driver's own practice best are treated as traffic/lift-and-coast runs.
LONG_RUN_OUTLIER_FACTOR = 1.10

# Points table used to translate finishing positions into championship value.
F1_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]


def _driver_key(result: dict[str, Any]) -> tuple[Optional[str], Optional[int]]:
    """Stable identity for joining data across sessions."""
    return result.get("name_acronym"), result.get("driver_number")


async def resolve_weekend(
    client: OpenF1Client, session_key: int
) -> dict[str, Any]:
    """Resolves any session of a Grand Prix weekend into its full weekend.

    Returns a dict with the race session, its practice/qualifying siblings
    (matched by ``meeting_key``) and shared meeting metadata.
    """
    # Fetch calendars broadly but rely on the disk cache for anything but the
    # current season, so repeated calls are near-instant.
    all_sessions: list[dict[str, Any]] = []
    for year in range(2023, 2031):
        try:
            all_sessions.extend(await client.get_sessions(year=year))
        except Exception:
            continue

    anchor = next((s for s in all_sessions if s.get("session_key") == session_key), None)
    if anchor is None:
        raise ValueError(f"Unknown session_key {session_key}")

    weekend_sessions = [s for s in all_sessions if s.get("meeting_key") == anchor["meeting_key"]]

    def _pick(session_type: str) -> Optional[dict[str, Any]]:
        candidates = [s for s in weekend_sessions if s.get("session_type") == session_type]
        return candidates[0] if candidates else None

    return {
        "year": anchor.get("year"),
        "meeting_key": anchor.get("meeting_key"),
        "circuit_short_name": anchor.get("circuit_short_name"),
        "country_name": anchor.get("country_name"),
        "location": anchor.get("location"),
        "race": _pick("Race"),
        "qualifying": _pick("Qualifying"),
        "practice": {s.get("session_name"): s for s in weekend_sessions if s.get("session_type") == "Practice"},
    }


def _best_lap_by_driver(laps: list[dict[str, Any]]) -> dict[int, float]:
    """Fastest valid lap time per driver number."""
    best: dict[int, float] = {}
    for lap in laps:
        t = lap.get("lap_duration")
        n = lap.get("driver_number")
        if t and n:
            best[n] = min(best.get(n, float("inf")), float(t))
    return best


def _long_run_pace(laps: list[dict[str, Any]]) -> dict[int, float]:
    """Median 'race-simulation' lap time per driver (practice only).

    Keeps laps from lap 3 onward, excludes slow outliers relative to the
    driver's own practice best, and returns the median lap time.
    """
    best = _best_lap_by_driver(laps)
    runs: dict[int, list[float]] = {}
    for lap in laps:
        n = lap.get("driver_number")
        t = lap.get("lap_duration")
        if not n or not t:
            continue
        if (lap.get("lap_number") or 0) < 3:
            continue
        driver_best = best.get(n)
        if not driver_best:
            continue
        if float(t) > driver_best * LONG_RUN_OUTLIER_FACTOR:
            continue
        runs.setdefault(n, []).append(float(t))
    return {
        n: statistics.median(times)
        for n, times in runs.items()
        if len(times) >= 3
    }


def _deltas(values: dict[int, float]) -> dict[int, float]:
    """Converts absolute times into deltas (seconds, positive = slower)."""
    if not values:
        return {}
    reference = min(values.values())
    return {n: round(float(t) - reference, 3) for n, t in values.items()}


def _weather_summary(samples: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregates OpenF1 weather samples into a compact weekend context."""
    if not samples:
        return {"rain": False, "air_temp": None, "track_temp": None}
    air = [s["air_temperature"] for s in samples if s.get("air_temperature") is not None]
    track = [s["track_temperature"] for s in samples if s.get("track_temperature") is not None]
    rainfall = [bool(s.get("rainfall")) for s in samples]
    wet_share = sum(rainfall) / max(len(rainfall), 1)
    return {
        "rain": wet_share >= 0.5,
        "air_temp": round(statistics.mean(air), 1) if air else None,
        "track_temp": round(statistics.mean(track), 1) if track else None,
    }


async def build_weekend_features(
    client: OpenF1Client, race_session: dict[str, Any]
) -> dict[str, Any]:
    """Builds the full per-driver feature bundle for one Grand Prix weekend.

    Returns::

        {
            "context": {circuit, country, date, weather ...},
            "drivers": [{
                driver_number, name_acronym, full_name, team_name,
                team_colour, headshot_url,
                grid_position, quali_delta, practice_delta, long_run_delta,
                track_avg_finish, track_avg_grid, track_best, track_races,
                form_avg_finish, dnf_rate,
            }, ...]
        }
    """
    weekend = await resolve_weekend(client, race_session["session_key"])

    anchor_session = (
        weekend.get("qualifying")
        or weekend.get("race")
        or race_session
    )

    raw_drivers = await client.get_drivers(anchor_session["session_key"])

    # --- Pace block -----------------------------------------------------
    quali_delta: dict[int, float] = {}
    practice_delta: dict[int, float] = {}
    long_run_delta: dict[int, float] = {}
    rain_flags: list[bool] = []
    air_temps: list[float] = []
    track_temps: list[float] = []

    quali_session = weekend.get("qualifying")
    if quali_session:
        quali_laps = await client.get_laps(quali_session["session_key"])
        quali_delta = _deltas(_best_lap_by_driver(quali_laps))

    for _, session in sorted((weekend.get("practice") or {}).items()):
        laps = await client.get_laps(session["session_key"])
        for n, delta in _deltas(_best_lap_by_driver(laps)).items():
            practice_delta[n] = min(practice_delta.get(n, float("inf")), delta)
        runs = _long_run_pace(laps)
        session_min = min(runs.values(), default=None)
        if session_min:
            for n, t in runs.items():
                d = t - session_min
                long_run_delta[n] = min(long_run_delta.get(n, float("inf")), d)

    # --- Weather context -------------------------------------------------
    for session in [weekend.get("race"), quali_session, *weekend.get("practice", {}).values()]:
        if not session:
            continue
        try:
            weather = await client.get_weather(session["session_key"])
        except Exception:
            weather = []
        summary = _weather_summary(weather)
        rain_flags.append(summary["rain"])
        if summary.get("air_temp") is not None:
            air_temps.append(summary["air_temp"])
        if summary.get("track_temp") is not None:
            track_temps.append(summary["track_temp"])

    # --- Grid ------------------------------------------------------------
    grid: dict[int, int] = {}
    if quali_session:
        try:
            results = await client.get_results(quali_session["session_key"])
        except Exception:
            results = []
        for r in results:
            n = r.get("driver_number")
            if n is not None and r.get("position") is not None:
                grid[n] = r["position"]
    # Fallback: fastest qualifying lap order
    for rank, (n, _) in enumerate(sorted(quali_delta.items(), key=lambda kv: kv[1]), start=1):
        grid.setdefault(n, rank)

    # --- Track history (up to previous 3 seasons) -------------------------
    # Joined by driver_number: OpenF1's session_result carries no acronym,
    # and the permanent racing number is stable across seasons.
    history: dict[int, dict[str, list[float]]] = {}
    year = weekend.get("year") or 0
    for past_year in [y for y in range(year - 3, year) if y >= 2023]:
        try:
            past_sessions = await client.get_sessions(year=past_year)
        except Exception:
            continue
        for s in past_sessions:
            if s.get("circuit_short_name") != weekend.get("circuit_short_name"):
                continue
            if s.get("session_type") == "Race":
                try:
                    race_results = await client.get_results(s["session_key"])
                except Exception:
                    race_results = []
                for r in race_results:
                    pos = r.get("position")
                    n = r.get("driver_number")
                    if pos is None or n is None:
                        continue
                    history.setdefault(n, {"finish": [], "grid": []})
                    history[n]["finish"].append(float(pos))

    # --- Recent form + DNF reliability (this season, before this meeting) --
    form: dict[int, list[float]] = {}
    dnf_tally: dict[int, tuple[int, int]] = {}  # number -> (dnfs, races)
    try:
        season_race_sessions = [
            s
            for s in await client.get_sessions(year=year)
            if s.get("session_type") == "Race"
            and (s.get("meeting_key") or 0) < (weekend.get("meeting_key") or 0)
        ]
        season_race_sessions.sort(key=lambda s: s.get("date_start") or "")
        for s in season_race_sessions[-3:]:
            try:
                results = await client.get_results(s["session_key"])
            except Exception:
                continue
            for r in results:
                n = r.get("driver_number")
                pos = r.get("position")
                if n is None:
                    continue
                dnfs, races = dnf_tally.get(n, (0, 0))
                dnf_tally[n] = (
                    dnfs + (1 if r.get("dnf") else 0),
                    races + 1,
                )
                if pos is not None:
                    form.setdefault(n, []).append(float(pos))
    except Exception:
        pass

    # --- Assemble ---------------------------------------------------------
    drivers: list[dict[str, Any]] = []
    for d in raw_drivers:
        n = d.get("driver_number")
        hist = history.get(n, {})
        finishes = hist.get("finish", [])
        grids_hist = hist.get("grid", [])
        recent = form.get(n, [])
        dnfs, races_run = dnf_tally.get(n, (0, 0))

        drivers.append(
            {
                "driver_number": n,
                "name_acronym": d.get("name_acronym", "UNK"),
                "full_name": d.get("full_name"),
                "team_name": d.get("team_name", "Independent"),
                "team_colour": (d.get("team_colour") or "#E10600")
                if (d.get("team_colour") or "").startswith("#")
                else f"#{d.get('team_colour') or 'E10600'}",
                "headshot_url": d.get("headshot_url"),
                "grid_position": grid.get(n),
                "quali_delta": quali_delta.get(n),
                "practice_delta": practice_delta.get(n),
                "long_run_delta": long_run_delta.get(n),
                "track_races": len(finishes),
                "track_avg_finish": round(statistics.mean(finishes), 2) if finishes else None,
                "track_avg_grid": round(statistics.mean(grids_hist), 2) if grids_hist else None,
                "track_best": min(finishes) if finishes else None,
                "form_avg_finish": round(statistics.mean(recent), 2) if recent else None,
                "dnf_rate": (dnfs / races_run) if races_run else None,
                "dnf_races": races_run,
            }
        )

    context = {
        "circuit": weekend.get("circuit_short_name"),
        "country": weekend.get("country_name"),
        "location": weekend.get("location"),
        "date": (weekend.get("race") or anchor_session).get("date_start"),
        "rain": any(rain_flags),
        "air_temp": round(statistics.mean(air_temps), 1) if air_temps else None,
        "track_temp": round(statistics.mean(track_temps), 1) if track_temps else None,
    }
    return {"context": context, "drivers": drivers}
