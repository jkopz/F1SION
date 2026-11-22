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


class TrajectoryPoint(BaseModel):
    """Timestamped telemetry sample along the driver's fastest lap."""
    x: float = Field(..., description="Raw telemetry X coordinate")
    y: float = Field(..., description="Raw telemetry Y coordinate")
    t: float = Field(..., description="Elapsed seconds since lap start")
    sector: int = Field(1, description="Circuit sector at this timestamp (1, 2, or 3)")


class TrajectoryResponse(BaseModel):
    """Real-time trajectory of a driver's fastest lap for playback simulation."""
    driver_number: int = Field(..., description="Driver the trajectory belongs to")
    lap_duration: float = Field(..., description="Lap duration in seconds")
    points: list[TrajectoryPoint] = Field(
        ..., description="Chronological samples ordered by elapsed lap time"
    )


class DriverLapResponse(BaseModel):
    """Fastest lap and sector split times for an individual driver."""
    driver_number: int
    lap_duration: Optional[float] = None
    duration_sector_1: Optional[float] = None
    duration_sector_2: Optional[float] = None
    duration_sector_3: Optional[float] = None
    compound: Optional[str] = None
    date_start: Optional[str] = None


class PredictionContext(BaseModel):
    """Weekend context attached to a race prediction."""
    circuit: Optional[str] = Field(None, description="Circuit short name")
    country: Optional[str] = Field(None, description="Host country")
    location: Optional[str] = Field(None, description="Circuit location / city")
    date: Optional[str] = Field(None, description="Race start timestamp")
    rain: bool = Field(False, description="Wet-race flag aggregated over the weekend")
    air_temp: Optional[float] = Field(None, description="Mean air temperature (°C)")
    track_temp: Optional[float] = Field(None, description="Mean track temperature (°C)")
    model_source: str = Field(..., description="Prediction engine used (ML blend or baseline)")


class RacePredictionResponse(BaseModel):
    """Full predicted race outcome: one entry per driver."""
    context: PredictionContext
    predictions: list[dict] = Field(
        ...,
        description=(
            "Drivers ordered by expected finish. Each entry carries the "
            "identity fields of DriverResponse plus predicted_position, "
            "p_win, p_podium, p_points, expected_points and top_factors."
        ),
    )
