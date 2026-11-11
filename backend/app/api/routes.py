"""F1SION REST API route handlers.

Defines endpoints for querying F1 sessions, track layouts, driver standings,
telemetry curves, and machine learning prediction inference.
"""

from typing import Any, Optional
from fastapi import APIRouter, HTTPException, Query

from app.data.openf1 import OpenF1Client
from app.models.schemas import (
    DriverLapResponse,
    DriverResponse,
    HealthResponse,
    SessionResponse,
    TrackLayoutResponse,
)

router = APIRouter(prefix="/api", tags=["F1SION"])
client = OpenF1Client(cache_enabled=True)


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Health check",
    description="Returns the operational status of the F1SION backend service.",
)
async def health_check() -> HealthResponse:
    """Verifies that the backend service is healthy and responsive."""
    return HealthResponse(status="ok", service="F1SION")


@router.get(
    "/sessions",
    response_model=list[SessionResponse],
    summary="List F1 sessions",
    description="Fetches and filters Grand Prix sessions for a given championship year.",
)
async def get_sessions(
    year: int = Query(2024, ge=1950, le=2030, description="Championship season year"),
    session_type: Optional[str] = Query(
        None, description="Optional session type filter (e.g. 'Race', 'Qualifying')"
    ),
) -> list[SessionResponse]:
    """Retrieves all sessions matching the provided year and session type filter."""
    try:
        raw_sessions = await client.get_sessions(year=year)
        sorted_sessions = sorted(raw_sessions, key=lambda s: s.get("date_start", ""))

        if session_type:
            sorted_sessions = [
                s for s in sorted_sessions if s.get("session_name") == session_type
            ]

        return [
            SessionResponse(
                session_key=s["session_key"],
                meeting_key=s["meeting_key"],
                year=s["year"],
                country_name=s.get("country_name", "Unknown"),
                location=s.get("location", "Unknown"),
                circuit_short_name=s.get("circuit_short_name", "Unknown"),
                session_name=s.get("session_name", "Unknown"),
                session_type=s.get("session_type", "Unknown"),
                date_start=s.get("date_start", ""),
                date_end=s.get("date_end", ""),
                gmt_offset=s.get("gmt_offset"),
            )
            for s in sorted_sessions
        ]
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch sessions: {str(exc)}"
        ) from exc


@router.get(
    "/sessions/{session_key}/track",
    response_model=TrackLayoutResponse,
    summary="Get circuit layout",
    description="Extracts normalized X/Y track coordinates and boundaries for frontend rendering.",
)
async def get_track_layout(session_key: int) -> TrackLayoutResponse:
    """Extracts cleanly bounded track geometry and sectors for a specific session."""
    try:
        layout = await client.get_circuit_layout(session_key)
        if not layout or not layout.get("points"):
            raise HTTPException(
                status_code=404,
                detail=f"No track coordinates available for session key {session_key}.",
            )
        return TrackLayoutResponse(**layout)
    except HTTPException:
        raise
    except Exception as exc:
        # Return 404 for any error (no track data available) instead of 500
        raise HTTPException(
            status_code=404,
            detail=f"No track data available for session {session_key}: {str(exc)}"
        ) from exc


@router.get(
    "/sessions/{session_key}/drivers",
    response_model=list[DriverResponse],
    summary="List session drivers",
    description="Retrieves drivers sorted by qualifying/race position with liveries and team identifiers.",
)
async def get_drivers(session_key: int) -> list[DriverResponse]:
    """Retrieves all participating drivers sorted by position, with normalized team colors."""
    try:
        # Try to get drivers first (always needed)
        raw_drivers = await client.get_drivers(session_key)
        
        # Try to get results (contains position data for qualifying/race) - may not exist
        results = []
        try:
            results = await client.get_results(session_key)
        except Exception:
            # Results endpoint may return 404 for some sessions - that's fine, just continue without positions
            results = []
        
        # Create a mapping from driver_number to driver details
        driver_map = {d.get("driver_number"): d for d in raw_drivers}
        
        # Sort drivers by position from results
        formatted: list[DriverResponse] = []
        used_drivers = set()
        
        # First pass: add drivers from results in position order
        for r in results:
            driver_number = r.get("driver_number")
            if driver_number in driver_map and driver_number not in used_drivers:
                d = driver_map[driver_number]
                colour = d.get("team_colour") or r.get("team_colour")
                if colour and not colour.startswith("#"):
                    colour = f"#{colour}"
                elif not colour:
                    colour = "#E10600"  # Official F1 red fallback
                
                formatted.append(
                    DriverResponse(
                        driver_number=driver_number,
                        broadcast_name=d.get("broadcast_name", "UNKNOWN"),
                        full_name=d.get("full_name"),
                        name_acronym=d.get("name_acronym", "UNK"),
                        team_name=d.get("team_name", r.get("team_name", "Independent")),
                        team_colour=colour,
                        headshot_url=d.get("headshot_url"),
                        country_code=d.get("country_code"),
                        position=r.get("position"),
                    )
                )
                used_drivers.add(driver_number)
        
        # Second pass: add any remaining drivers not in results
        for d in raw_drivers:
            driver_number = d.get("driver_number")
            if driver_number not in used_drivers:
                colour = d.get("team_colour")
                if colour and not colour.startswith("#"):
                    colour = f"#{colour}"
                elif not colour:
                    colour = "#E10600"
                
                formatted.append(
                    DriverResponse(
                        driver_number=driver_number,
                        broadcast_name=d.get("broadcast_name", "UNKNOWN"),
                        full_name=d.get("full_name"),
                        name_acronym=d.get("name_acronym", "UNK"),
                        team_name=d.get("team_name", "Independent"),
                        team_colour=colour,
                        headshot_url=d.get("headshot_url"),
                        country_code=d.get("country_code"),
                        position=None,
                    )
                )
        
        return formatted
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch drivers: {str(exc)}"
        ) from exc


@router.get(
    "/sessions/{session_key}/drivers/{driver_number}/lap",
    response_model=DriverLapResponse,
    summary="Get driver fastest lap",
    description="Retrieves the fastest lap and sector timing splits for a specific driver.",
)
async def get_driver_lap(session_key: int, driver_number: int) -> DriverLapResponse:
    """Retrieves fastest lap timings and sector splits for the specified driver."""
    try:
        lap = await client.get_driver_fastest_lap(session_key, driver_number)
        if not lap:
            raise HTTPException(
                status_code=404,
                detail=f"No valid lap found for driver {driver_number} in session {session_key}.",
            )
        return DriverLapResponse(**lap)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch driver lap: {str(exc)}"
        ) from exc


@router.get(
    "/sessions/{session_key}/laps",
    summary="Get session laps",
    description="Retrieves raw lap records with sector durations and tyre compounds.",
)
async def get_laps(
    session_key: int,
    driver_number: Optional[int] = Query(None, description="Optional driver number filter"),
) -> list[dict[str, Any]]:
    """Retrieves lap records for the given session."""
    try:
        return await client.get_laps(session_key, driver_number=driver_number)
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch lap data: {str(exc)}"
        ) from exc


@router.post(
    "/shutdown",
    summary="Shutdown server",
    description="Gracefully shuts down the F1SION backend and development services.",
)
async def shutdown_service() -> dict[str, str]:
    """Gracefully terminates the backend process via SIGTERM after sending response."""
    import asyncio
    import os
    import signal

    async def _terminate() -> None:
        await asyncio.sleep(0.5)
        # Send SIGTERM to current process and parent process group
        try:
            os.kill(os.getpid(), signal.SIGTERM)
        except Exception:
            pass

    asyncio.create_task(_terminate())
    return {
        "status": "shutting_down",
        "message": "F1SION services shutting down cleanly.",
    }

