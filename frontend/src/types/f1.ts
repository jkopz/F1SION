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
  position?: number;
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

export interface TrajectoryPoint {
  x: number; // Raw telemetry X coordinate
  y: number; // Raw telemetry Y coordinate
  t: number; // Elapsed seconds since lap start
  sector: number; // 1, 2, or 3
}

export interface DriverTrajectory {
  driver_number: number;
  lap_duration: number;
  points: TrajectoryPoint[];
}

/* ---------------------- Race Predictor (app.ml) ---------------------- */

export interface PredictionContext {
  circuit?: string;
  country?: string;
  location?: string;
  date?: string;
  rain: boolean;
  air_temp?: number;
  track_temp?: number;
  /** e.g. "xgboost + baseline blend" or "deterministic baseline" */
  model_source: string;
}

/** One driver's race prediction (identity fields + model output). */
export interface DriverPrediction {
  driver_number: number;
  name_acronym: string;
  full_name?: string;
  team_name: string;
  team_colour: string;
  headshot_url?: string;
  country_code?: string;

  /* Features */
  grid_position?: number;
  quali_delta?: number;
  practice_delta?: number;
  long_run_delta?: number;
  track_races?: number;
  track_avg_finish?: number;
  track_best?: number;
  form_avg_finish?: number;
  /** Raw per-season DNF share (unsmoothed) and the number of races it is based on */
  dnf_rate?: number;
  dnf_races?: number;
  /** DNF probability as actually used by the Monte-Carlo simulation (smoothed) */
  dnf_risk?: number;

  /* Model output */
  predicted_position: number;
  p_win: number;
  p_podium: number;
  p_points: number;
  expected_points: number;
  /** Short human-readable drivers of this prediction, most influential first */
  top_factors: string[];
}

export interface RacePrediction {
  context: PredictionContext;
  predictions: DriverPrediction[];
}
