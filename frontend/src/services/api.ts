/**
 * F1SION API client.
 * Provides typed asynchronous methods to interact with the FastAPI backend.
 */

import { Driver, DriverLap, Session, TrackLayout } from '../types/f1';

const API_BASE = '/api';

export async function fetchSessions(year: number = 2024, sessionType?: string): Promise<Session[]> {
  const params = new URLSearchParams({ year: year.toString() });
  if (sessionType) {
    params.append('session_type', sessionType);
  }
  const res = await fetch(`${API_BASE}/sessions?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch sessions: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchTrackLayout(sessionKey: number): Promise<TrackLayout> {
  const res = await fetch(`${API_BASE}/sessions/${sessionKey}/track`);
  if (!res.ok) {
    throw new Error(`Failed to fetch track layout for session ${sessionKey}: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchDrivers(sessionKey: number): Promise<Driver[]> {
  const res = await fetch(`${API_BASE}/sessions/${sessionKey}/drivers`);
  if (!res.ok) {
    throw new Error(`Failed to fetch drivers for session ${sessionKey}: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchDriverLap(sessionKey: number, driverNumber: number): Promise<DriverLap> {
  const res = await fetch(`${API_BASE}/sessions/${sessionKey}/drivers/${driverNumber}/lap`);
  if (!res.ok) {
    throw new Error(`Failed to fetch lap for driver ${driverNumber}: ${res.statusText}`);
  }
  return res.json();
}

/** Raw lap record from /sessions/{key}/laps */
interface RawLap {
  driver_number: number;
  lap_duration?: number | null;
  duration_sector_1?: number | null;
  duration_sector_2?: number | null;
  duration_sector_3?: number | null;
  compound?: string;
  date_start?: string;
}

/**
 * Returns a map from driver_number → fastest lap duration for the whole session.
 * Uses the already-cached /laps endpoint (no extra network round-trip in most cases).
 */
export async function fetchFastestLapPerDriver(
  sessionKey: number
): Promise<Map<number, number>> {
  const res = await fetch(`${API_BASE}/sessions/${sessionKey}/laps`);
  if (!res.ok) return new Map();

  const laps: RawLap[] = await res.json();
  const fastest = new Map<number, number>();

  for (const lap of laps) {
    if (!lap.lap_duration || lap.lap_duration <= 0) continue;
    const existing = fastest.get(lap.driver_number);
    if (existing === undefined || lap.lap_duration < existing) {
      fastest.set(lap.driver_number, lap.lap_duration);
    }
  }

  return fastest;
}

export async function shutdownServer(): Promise<void> {
  await fetch(`${API_BASE}/shutdown`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }).catch(() => {
    // Network error is expected when server process terminates immediately
  });
}
