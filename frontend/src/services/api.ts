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

export async function shutdownServer(): Promise<void> {
  await fetch(`${API_BASE}/shutdown`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }).catch(() => {
    // Network error is expected when server process terminates immediately
  });
}

