/**
 * TypeScript type definitions for F1SION.
 * Mirrors the backend Pydantic schemas in app.models.schemas.
 */

export interface Session {
  session_key: number;
  meeting_key: number;
  year: number;
  country_name: string;
  location: string;
  circuit_short_name: string;
  session_name: string;
  session_type: string;
  date_start: string;
  date_end: string;
  gmt_offset?: string;
}

export interface Driver {
  driver_number: number;
  broadcast_name: string;
  full_name?: string;
  name_acronym: string;
  team_name: string;
  team_colour: string;
  headshot_url?: string;
  country_code?: string;
}

export interface TrackPoint {
  raw_x: number;
  raw_y: number;
  norm_x: number;
  norm_y: number;
  sector: number; // 1, 2, or 3
}

export interface CircuitBounds {
  min_x: number;
  max_x: number;
  min_y: number;
  max_y: number;
  width: number;
  height: number;
}

export interface SectorSplits {
  sector_1: number;
  sector_2: number;
  sector_3: number;
}

export interface TrackLayout {
  points: TrackPoint[];
  driver_number: number;
  lap_duration: number;
  bounds: CircuitBounds;
  sectors?: SectorSplits;
}

export interface DriverLap {
  driver_number: number;
  lap_duration?: number;
  duration_sector_1?: number;
  duration_sector_2?: number;
  duration_sector_3?: number;
  compound?: string;
  date_start?: string;
}
