"""Data models and Pydantic schemas for the F1SION API.

Defines request/response contracts for F1 sessions, track layouts,
drivers, lap telemetry, and machine learning predictions.
"""

from typing import Optional
from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    """Health check response payload."""
    status: str = Field(..., description="Service status indicator")
    service: str = Field(..., description="Service name")


class SessionResponse(BaseModel):
    """F1 championship session metadata."""
    session_key: int = Field(..., description="Unique session identifier in OpenF1")
    meeting_key: int = Field(..., description="Grand Prix weekend meeting identifier")
    year: int = Field(..., description="Championship year")
    country_name: str = Field(..., description="Host country name")
    location: str = Field(..., description="Circuit geographical location or city")
    circuit_short_name: str = Field(..., description="Circuit short name (e.g. Monza, Spa)")
    session_name: str = Field(..., description="Session title (e.g. Practice 1, Qualifying, Race)")
    session_type: str = Field(..., description="Session type category")
    date_start: str = Field(..., description="ISO 8601 start timestamp")
    date_end: str = Field(..., description="ISO 8601 end timestamp")
    gmt_offset: Optional[str] = Field(None, description="Local GMT offset")


class DriverResponse(BaseModel):
    """Driver profile and team branding."""
    driver_number: int = Field(..., description="Permanent racing car number")
    broadcast_name: str = Field(..., description="Broadcast overlay name (e.g. M VERSTAPPEN)")
    full_name: Optional[str] = Field(None, description="Driver full name")
    name_acronym: str = Field(..., description="Three-letter FIA acronym (e.g. VER)")
    team_name: str = Field(..., description="Constructor or team name")
    team_colour: str = Field(..., description="Team livery color in HEX format (#RRGGBB)")
    headshot_url: Optional[str] = Field(None, description="Official driver portrait URL")
    country_code: Optional[str] = Field(None, description="Country code (e.g. NLD, GBR)")
    position: Optional[int] = Field(None, description="Qualifying or race position")


class TrackPoint(BaseModel):
    """Spatial coordinate point along the circuit geometry."""
    raw_x: float = Field(..., description="Raw coordinate X from telemetry")
    raw_y: float = Field(..., description="Raw coordinate Y from telemetry")
    norm_x: float = Field(..., description="Normalized X coordinate in [0.0, 1.0]")
    norm_y: float = Field(..., description="Normalized Y coordinate in [0.0, 1.0]")
    sector: int = Field(1, description="Circuit sector identifier (1, 2, or 3)")


class CircuitBounds(BaseModel):
    """Bounding box boundaries for canvas scaling."""
    min_x: float
    max_x: float
    min_y: float
    max_y: float
    width: float
    height: float


class SectorSplits(BaseModel):
    """Sector timing split benchmarks in seconds."""
    sector_1: float
    sector_2: float
    sector_3: float


class TrackLayoutResponse(BaseModel):
    """Track layout geometry ready for SVG/Canvas rendering."""
    points: list[TrackPoint] = Field(..., description="Ordered coordinate sequence of the track")
    driver_number: int = Field(..., description="Driver number used for reference lap")
    lap_duration: float = Field(..., description="Lap duration in seconds")
    bounds: CircuitBounds = Field(..., description="Spatial bounding dimensions")
    sectors: Optional[SectorSplits] = Field(None, description="Sector durations")


class DriverLapResponse(BaseModel):
    """Fastest lap and sector split times for an individual driver."""
    driver_number: int
    lap_duration: Optional[float] = None
    duration_sector_1: Optional[float] = None
    duration_sector_2: Optional[float] = None
    duration_sector_3: Optional[float] = None
    compound: Optional[str] = None
    date_start: Optional[str] = None
