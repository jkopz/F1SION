"""OpenF1 API client module with local disk caching.

Provides an asynchronous client to fetch sessions, drivers, lap timings,
car telemetry, and track coordinates from api.openf1.org, persisting
responses locally as JSON to prevent redundant network round-trips.
"""

from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional
import asyncio
import json
import httpx

BASE_URL = "https://api.openf1.org/v1"
CACHE_DIR = Path(__file__).resolve().parent.parent.parent / "cache" / "openf1"
CACHE_DIR.mkdir(parents=True, exist_ok=True)


class OpenF1Client:
    """Asynchronous client for OpenF1 API with persistent disk caching.

    Attributes:
        cache_enabled (bool): Whether local file caching is enabled.
        RETRY_DELAYS (tuple[float, ...]): Backoff seconds per retry attempt
            for transient OpenF1 responses (429 rate limit / 5xx).
    """

    RETRY_DELAYS: tuple[float, ...] = (0.5, 1.0, 2.0)

    def __init__(self, cache_enabled: bool = True) -> None:
        """Initializes the OpenF1 client.

        Args:
            cache_enabled: If True, responses are cached to disk in JSON format.
        """
        self.cache_enabled = cache_enabled
        # Reused connection pool: avoids a fresh TLS handshake per request
        self._http: Optional[httpx.AsyncClient] = None

    def _get_http(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(timeout=30.0)
        return self._http

    def _get_cache_path(self, endpoint: str, params: dict[str, Any]) -> Path:
        """Generates a safe deterministic cache filepath for a given request.

        Args:
            endpoint: The API endpoint path (e.g. 'sessions', 'laps').
            params: Query parameter dictionary.

        Returns:
            Path object pointing to the cached JSON file.
        """
        param_str = "_".join(f"{k}={v}" for k, v in sorted(params.items()))
        safe_name = (
            f"{endpoint}_{param_str}"
            .replace("/", "_")
            .replace(":", "_")
            .replace(">", "gt")
            .replace("<", "lt")
        )
        return CACHE_DIR / f"{safe_name}.json"

    async def get(
        self, endpoint: str, params: Optional[dict[str, Any]] = None
    ) -> list[dict[str, Any]]:
        """Performs an HTTP GET request to OpenF1 with disk caching.

        Args:
            endpoint: OpenF1 API resource endpoint.
            params: Optional query parameters supporting comparison operators.

        Returns:
            Parsed JSON list response from OpenF1.

        Raises:
            httpx.HTTPStatusError: If the remote API returns an error response.
        """
        params = params or {}
        cache_file = self._get_cache_path(endpoint, params)

        # Check local cache first
        if self.cache_enabled and cache_file.exists():
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass  # Fallback to remote request if cache read fails

        # Format query parameters: preserve unencoded comparison operators
        query_parts: list[str] = []
        for k, v in params.items():
            if any(op in k for op in [">=", "<=", ">", "<"]):
                query_parts.append(f"{k}{v}")
            else:
                query_parts.append(f"{k}={v}")

        query_str = f"?{'&'.join(query_parts)}" if query_parts else ""
        url = f"{BASE_URL}/{endpoint}{query_str}"

        # Session switches fire several OpenF1 requests in quick succession
        # (drivers, results, laps, location); their rate limiter answers with
        # 429 — retry transient responses with backoff instead of bubbling a
        # 500 to the frontend. Retry-After is honoured when present.
        http = self._get_http()
        attempt = 0
        while True:
            try:
                resp = await http.get(url)
                resp.raise_for_status()
                break
            except httpx.HTTPStatusError as exc:
                status = exc.response.status_code
                if status != 429 and status not in (500, 502, 503, 504):
                    raise
                if attempt >= len(self.RETRY_DELAYS):
                    raise
                retry_after = exc.response.headers.get("Retry-After")
                try:
                    delay = float(retry_after)
                except (TypeError, ValueError):
                    delay = self.RETRY_DELAYS[attempt]
                attempt += 1
                await asyncio.sleep(delay)
        data: list[dict[str, Any]] = resp.json()

        # Cache response locally
        if self.cache_enabled and data:
            with open(cache_file, "w", encoding="utf-8") as f:
                json.dump(data, f)

        return data

    async def get_sessions(self, year: int = 2024) -> list[dict[str, Any]]:
        """Retrieves all Grand Prix sessions for a given championship year."""
        return await self.get("sessions", {"year": year})

    async def get_drivers(self, session_key: int) -> list[dict[str, Any]]:
        """Retrieves all participating drivers for a specific session."""
        return await self.get("drivers", {"session_key": session_key})

    async def get_results(self, session_key: int) -> list[dict[str, Any]]:
        """Retrieves classified session results (position, DNF flags) for a session.

        Uses OpenF1's ``session_result`` endpoint — the plain ``results``
        endpoint returns an error payload and no per-driver classification.
        """
        return await self.get("session_result", {"session_key": session_key})

    async def get_laps(
        self, session_key: int, driver_number: Optional[int] = None
    ) -> list[dict[str, Any]]:
        """Retrieves lap timing records for a session, optionally filtered by driver."""
        params: dict[str, Any] = {"session_key": session_key}
        if driver_number is not None:
            params["driver_number"] = driver_number
        return await self.get("laps", params)

    async def get_weather(self, session_key: int) -> list[dict[str, Any]]:
        """Retrieves weather samples (air/track temperature, rainfall) for a session."""
        return await self.get("weather", {"session_key": session_key})

    async def get_driver_fastest_lap(
        self, session_key: int, driver_number: int
    ) -> Optional[dict[str, Any]]:
        """Retrieves the fastest valid lap and sector splits for a specific driver.

        Fetches all session laps once and caches them locally, filtering in memory
        to avoid redundant per-driver network round-trips.
        """
        all_laps = await self.get_laps(session_key)
        valid = [
            l
            for l in all_laps
            if l.get("driver_number") == driver_number
            and l.get("lap_duration")
            and l.get("date_start")
        ]
        if not valid:
            return None

        fastest = min(valid, key=lambda x: x["lap_duration"])
        return {
            "driver_number": driver_number,
            "lap_duration": fastest.get("lap_duration"),
            "duration_sector_1": fastest.get("duration_sector_1"),
            "duration_sector_2": fastest.get("duration_sector_2"),
            "duration_sector_3": fastest.get("duration_sector_3"),
            "compound": fastest.get("compound", "UNKNOWN"),
            "date_start": fastest.get("date_start"),
        }

    async def get_driver_trajectory(
        self, session_key: int, driver_number: int
    ) -> Optional[dict[str, Any]]:
        """Builds the driver's real timestamped trajectory for their fastest lap.

        Fetches location telemetry strictly within the driver's fastest lap
        window and annotates each sample with the elapsed time since lap
        start (``t`` in seconds). Because samples are recorded at varying
        rates, consecutive points sit far apart on straights and densely in
        corners — replaying them against real time reproduces the driver's
        actual speed profile.

        Returns:
            Dictionary with lap duration and ordered trajectory points, or
            None when no location telemetry covers the lap.
        """
        fastest = await self.get_driver_fastest_lap(session_key, driver_number)
        if not fastest or not fastest.get("date_start") or not fastest.get("lap_duration"):
            return None

        start_dt = datetime.fromisoformat(fastest["date_start"])
        lap_duration = float(fastest["lap_duration"])

        s1_duration = fastest.get("duration_sector_1") or (lap_duration / 3.0)
        s2_duration = fastest.get("duration_sector_2") or (lap_duration / 3.0)
        s1_end = start_dt + timedelta(seconds=s1_duration)
        s2_end = s1_end + timedelta(seconds=s2_duration)

        def fmt(dt: datetime) -> str:
            return dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3]

        locs = await self.get(
            "location",
            {
                "session_key": session_key,
                "driver_number": driver_number,
                "date>=": fmt(start_dt),
                "date<=": fmt(start_dt + timedelta(seconds=lap_duration)),
            },
        )
        if not locs:
            return None

        points: list[dict[str, Any]] = []
        last_t = -1.0
        for p in sorted(locs, key=lambda q: q.get("date") or ""):
            if p.get("x") == 0 and p.get("y") == 0:
                continue
            try:
                p_dt = datetime.fromisoformat(p["date"])
            except Exception:
                continue

            t = max(0.0, min((p_dt - start_dt).total_seconds(), lap_duration))
            # Enforce strictly increasing timestamps so binary-search playback
            # never interpolates against a zero or negative time span
            if t <= last_t:
                continue
            last_t = t

            if p_dt <= s1_end:
                sector = 1
            elif p_dt <= s2_end:
                sector = 2
            else:
                sector = 3

            points.append(
                {
                    "x": p["x"],
                    "y": p["y"],
                    "t": round(t, 4),
                    "sector": sector,
                }
            )

        if len(points) < 2:
            return None

        return {
            "driver_number": driver_number,
            "lap_duration": lap_duration,
            "points": points,
        }

    async def get_circuit_layout(
        self, session_key: int, driver_number: Optional[int] = None
    ) -> dict[str, Any]:
        """Extracts strictly bounded, closed circuit coordinates and sectors.

        Uses the fastest recorded lap, bounds the telemetry query to the exact
        lap duration to avoid pit-lane or slow-down deviations, and annotates
        points with sectors 1, 2, and 3.

        Args:
            session_key: Unique identifier for the F1 session.
            driver_number: Optional driver number preference.

        Returns:
            Dictionary containing normalized track points with sector tags,
            bounding box, and sector durations.
        """
        # Fetch valid reference laps with all sectors
        if driver_number is not None:
            laps = await self.get_laps(session_key, driver_number=driver_number)
            valid_laps = [
                l for l in laps if l.get("lap_duration") and l.get("date_start")
            ]
        else:
            valid_laps = []

        if not valid_laps:
            all_laps = await self.get_laps(session_key)
            valid_laps = [
                l for l in all_laps if l.get("lap_duration") and l.get("date_start")
            ]
            if not valid_laps:
                return {"points": [], "bounds": {}, "sectors": {}}

        fastest = min(valid_laps, key=lambda x: x["lap_duration"])
        ref_driver = fastest["driver_number"]
        lap_duration = fastest["lap_duration"]

        start_dt = datetime.fromisoformat(fastest["date_start"])
        end_dt = start_dt + timedelta(seconds=lap_duration)

        # Calculate exact sector boundaries
        s1_duration = fastest.get("duration_sector_1") or (lap_duration / 3.0)
        s2_duration = fastest.get("duration_sector_2") or (lap_duration / 3.0)
        s3_duration = (
            fastest.get("duration_sector_3")
            or (lap_duration - s1_duration - s2_duration)
        )

        s1_end = start_dt + timedelta(seconds=s1_duration)
        s2_end = s1_end + timedelta(seconds=s2_duration)

        start_str = start_dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3]
        end_str = end_dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3]

        # Query location strictly within the lap timeframe
        locs = await self.get(
            "location",
            {
                "session_key": session_key,
                "driver_number": ref_driver,
                "date>=": start_str,
                "date<=": end_str,
            },
        )

        if not locs:
            # Try to get location data without driver_number filter
            locs = await self.get(
                "location",
                {
                    "session_key": session_key,
                    "date>=": start_str,
                    "date<=": end_str,
                },
            )
            if not locs:
                return {"points": [], "bounds": {}, "sectors": {}}

        # Filter out static/zero points and annotate with sector ID
        raw_points: list[dict[str, Any]] = []
        for p in locs:
            if p.get("x") == 0 and p.get("y") == 0:
                continue

            try:
                p_dt = datetime.fromisoformat(p["date"])
            except Exception:
                p_dt = start_dt

            if p_dt <= s1_end:
                sector = 1
            elif p_dt <= s2_end:
                sector = 2
            else:
                sector = 3

            raw_points.append(
                {
                    "x": p["x"],
                    "y": p["y"],
                    "z": p.get("z", 0),
                    "sector": sector,
                    "date": p.get("date"),
                }
            )

        if len(raw_points) < 10:
            # Not enough points - try with a different driver
            all_drivers = await self.get_drivers(session_key)
            for driver in all_drivers:
                if driver.get("driver_number") == ref_driver:
                    continue
                driver_num = driver.get("driver_number")
                locs = await self.get(
                    "location",
                    {
                        "session_key": session_key,
                        "driver_number": driver_num,
                        "date>=": start_str,
                        "date<=": end_str,
                    },
                )
                if locs:
                    # Reprocess with new locs
                    new_points: list[dict[str, Any]] = []
                    for p in locs:
                        if p.get("x") == 0 and p.get("y") == 0:
                            continue
                        try:
                            p_dt = datetime.fromisoformat(p["date"])
                        except Exception:
                            p_dt = start_dt
                        if p_dt <= s1_end:
                            sector = 1
                        elif p_dt <= s2_end:
                            sector = 2
                        else:
                            sector = 3
                        new_points.append({
                            "x": p["x"],
                            "y": p["y"],
                            "z": p.get("z", 0),
                            "sector": sector,
                            "date": p.get("date"),
                        })
                    if len(new_points) >= 10:
                        raw_points = new_points
                        break
            
            if len(raw_points) < 10:
                return {"points": [], "bounds": {}, "sectors": {}}

        xs = [p["x"] for p in raw_points]
        ys = [p["y"] for p in raw_points]

        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        width = max_x - min_x or 1
        height = max_y - min_y or 1

        # Normalize coordinates into [0.0, 1.0] space
        normalized = [
            {
                "raw_x": p["x"],
                "raw_y": p["y"],
                "norm_x": round((p["x"] - min_x) / width, 5),
                "norm_y": round((p["y"] - min_y) / height, 5),
                "sector": p["sector"],
            }
            for p in raw_points
        ]

        return {
            "points": normalized,
            "driver_number": ref_driver,
            "lap_duration": lap_duration,
            "bounds": {
                "min_x": min_x,
                "max_x": max_x,
                "min_y": min_y,
                "max_y": max_y,
                "width": width,
                "height": height,
            },
            "sectors": {
                "sector_1": round(s1_duration, 3),
                "sector_2": round(s2_duration, 3),
                "sector_3": round(s3_duration, 3),
            },
        }
