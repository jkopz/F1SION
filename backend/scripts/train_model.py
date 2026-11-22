"""Trains the F1SION race-result model and saves the artifact.

Builds one training row per (Grand Prix weekend, driver) using the exact
same feature pipeline as inference (``app.ml.features``), with the
official race finishing position as the regression target, then trains a
gradient-boosted regressor and pickles the bundle next to the predictor.

Usage::

    cd backend && python scripts/train_model.py [--years 2023 2024 2025]

The artifact is optional at inference time: without it the API serves
the deterministic baseline automatically.
"""

from __future__ import annotations

import argparse
import asyncio
import pickle
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sklearn.metrics import mean_absolute_error  # noqa: E402
from xgboost import XGBRegressor  # noqa: E402

from app.data.openf1 import OpenF1Client  # noqa: E402
from app.ml.features import build_weekend_features  # noqa: E402
from app.ml.predictor import ARTIFACT_PATH, ML_FEATURES  # noqa: E402


async def build_dataset(years: list[int]) -> tuple[list[list[float]], list[float], list[dict]]:
    """Collects feature rows and targets for every race in ``years``."""
    client = OpenF1Client(cache_enabled=True)
    rows: list[list[float]] = []
    targets: list[float] = []
    meta: list[dict] = []

    for year in years:
        sessions = await client.get_sessions(year=year)
        race_sessions = [s for s in sessions if s.get("session_type") == "Race"]
        race_sessions.sort(key=lambda s: s.get("date_start") or "")
        seen_meetings: set[int] = set()

        for race in race_sessions:
            meeting = race.get("meeting_key")
            if meeting in seen_meetings:
                continue
            seen_meetings.add(meeting)

            try:
                bundle = await build_weekend_features(client, race)
                results = await client.get_results(race["session_key"])
            except Exception as exc:
                print(f"  ! skipping {race.get('circuit_short_name')} {year}: {exc}")
                continue

            position_by_number = {
                r.get("driver_number"): r.get("position")
                for r in results
                if r.get("position")
            }

            max_pos = float(max(position_by_number.values()) or 20)
            for d in bundle["drivers"]:
                target = position_by_number.get(d["driver_number"])
                if target is None:
                    continue  # DNF / driver without classified result
                rows.append([
                    float(d.get(f) if d.get(f) is not None else _median_fill(f))
                    if f != "rain"
                    else (1.0 if bundle["context"].get("rain") else 0.0)
                    for f in ML_FEATURES
                ])
                targets.append(float(target))
                meta.append({
                    "year": year,
                    "circuit": race.get("circuit_short_name"),
                    "driver": d.get("name_acronym"),
                })
            print(f"  ✓ {year} {race.get('circuit_short_name')} — rows: {len(rows)}")

    return rows, targets, meta


def _median_fill(feature: str) -> float:
    """Neutral fill matching the inference-time imputation."""
    fills = {
        "grid_position": 12.0,
        "quali_delta": 0.6,
        "practice_delta": 0.8,
        "long_run_delta": 0.7,
        "track_races": 0.0,
        "track_avg_finish": 11.0,
        "track_best": 9.0,
        "form_avg_finish": 11.0,
    }
    return fills.get(feature, 11.0)


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the F1SION race predictor")
    parser.add_argument(
        "--years", type=int, nargs="+", default=[2023, 2024, 2025],
        help="Seasons to train on (default: 2023 2024 2025)",
    )
    args = parser.parse_args()

    print(f"Building dataset for seasons {args.years} (cached OpenF1 data)...")
    rows, targets, meta = asyncio.run(build_dataset(args.years))
    if not rows:
        print("No training data collected — aborting.")
        return

    print(f"Training XGBoost on {len(rows)} rows ...")
    model = XGBRegressor(
        n_estimators=400,
        max_depth=4,
        learning_rate=0.05,
        subsample=0.9,
        colsample_bytree=0.9,
        objective="reg:squarederror",
        eval_metric="mae",
    )
    model.fit(rows, targets, verbose=False)

    preds = model.predict(rows)
    mae = mean_absolute_error(targets, preds)
    print(f"In-sample MAE: {mae:.2f} positions over {len(rows)} driver-races")

    ARTIFACT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(ARTIFACT_PATH, "wb") as f:
        pickle.dump(
            {"model": model, "feature_names": ML_FEATURES, "mae": mae, "meta": meta[-5:]},
            f,
        )
    print(f"Artifact saved: {ARTIFACT_PATH}")


if __name__ == "__main__":
    main()
