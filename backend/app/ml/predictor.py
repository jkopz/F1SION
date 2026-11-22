"""F1SION hybrid race predictor.

Combines a transparent, deterministic baseline (weighted pace-index over
practice/qualifying deltas, long-run pace, track history and recent form)
with an optional trained XGBoost artifact. When a trained model is
available it provides the primary expected-position estimate; otherwise
the baseline takes over — so predictions always work.

Positional uncertainty (P(win), P(podium), P(points)) is estimated with a
lightweight Monte-Carlo simulation over the pace scores.
"""

from __future__ import annotations

import pickle
import random
from pathlib import Path
from typing import Any, Optional

ARTIFACT_PATH = Path(__file__).resolve().parent / "artifacts" / "race_model.pkl"

from app.ml.features import F1_POINTS  # noqa: E402  (shared points table)

# Component weights of the baseline pace-index. Each feature is normalised
# into a rank between 0 (fastest/best) and 1 (slowest/worst) among drivers
# that have the feature; missing features simply redistribute weight.
BASELINE_WEIGHTS = {
    "quali_delta": 0.40,
    "practice_delta": 0.20,
    "long_run_delta": 0.15,
    "track_avg_finish": 0.15,
    "form_avg_finish": 0.10,
}

RAIN_WEIGHTS = {
    "quali_delta": 0.25,
    "practice_delta": 0.15,
    "long_run_delta": 0.10,
    "track_avg_finish": 0.15,
    "form_avg_finish": 0.35,  # recent form carries more weight in the wet
}

BASE_SIGMA = 1.4    # rank-space noise, dry
RAIN_SIGMA = 2.2    # rank-space noise, wet
# Per-race chaos multiplier: every simulated race draws a chaos level in
# [0.4, 2.4] and scales that race's noise with it. Some races are
# processional (low chaos, results match pace), some are wild (safety cars,
# first-lap incidents, strategy luck) — midfield cars DO win those, which
# keeps P(win) for drivers outside the pace-top-3 realistically above zero.
CHAOS_MIN = 0.4
CHAOS_MAX = 2.4
BASE_DNF_RATE = 0.08

MONTE_CARLO_RUNS = 4000


def _ranks(values: dict[int, float]) -> dict[int, float]:
    """Normalises values onto [0 (best), 1 (worst)] in rank space."""
    if not values:
        return {}
    ordered = sorted(values.items(), key=lambda kv: kv[1])
    n = max(len(ordered) - 1, 1)
    return {num: i / n for i, (num, _) in enumerate(ordered)}


def baseline_scores(
    drivers: list[dict[str, Any]], rain: bool
) -> tuple[dict[int, float], dict[int, list[str]]]:
    """Computes the weighted pace-index and human-readable top factors.

    Returns:
        (scores, factors) where scores maps driver_number -> pace index in
        [0, 1] (lower = better) and factors maps driver_number -> list of
        short explanation strings ordered by influence.
    """
    weights = RAIN_WEIGHTS if rain else BASELINE_WEIGHTS
    labels = {
        "quali_delta": "Qualifying pace",
        "practice_delta": "Practice pace (FP1–FP3)",
        "long_run_delta": "Long-run pace (FP2)",
        "track_avg_finish": "Track history",
        "form_avg_finish": "Recent form",
    }

    rank_maps: dict[str, dict[int, float]] = {}
    raw_values: dict[str, dict[int, float]] = {}
    for feature in weights:
        values = {
            d["driver_number"]: d[feature]
            for d in drivers
            if d.get(feature) is not None
        }
        raw_values[feature] = values
        rank_maps[feature] = _ranks(values)

    n_drivers = len(drivers) or 1
    scores: dict[int, float] = {}
    factors: dict[int, list[str]] = {}
    for d in drivers:
        n = d["driver_number"]
        total_weight = 0.0
        weighted_sum = 0.0
        contributions: list[tuple[float, str]] = []
        for feature, weight in weights.items():
            if n not in rank_maps[feature]:
                continue  # missing feature -> weights redistribute
            rank = rank_maps[feature][n]
            weighted_sum += weight * rank
            total_weight += weight
            # Contribution relative to a mid-field baseline (0.5).
            contributions.append((weight * (0.5 - rank), labels[feature]))
        scores[n] = weighted_sum / total_weight if total_weight else 1.0
        contributions.sort(key=lambda c: -abs(c[0]))
        factors[n] = [
            f"{'+' if gain > 0.02 else ('-' if gain < -0.02 else '±')} {label}"
            for gain, label in contributions[:3]
        ]
        if len(factors[n]) < len(weights) and n not in raw_values.get("track_avg_finish", {}):
            factors[n].append("~ no track history at this circuit")
    return scores, factors


# ---------------------------------------------------------------------------
# Optional XGBoost artifact (trained via backend/scripts/train_model.py)
# ---------------------------------------------------------------------------

ML_FEATURES = [
    "grid_position",
    "quali_delta",
    "practice_delta",
    "long_run_delta",
    "track_races",
    "track_avg_finish",
    "track_best",
    "form_avg_finish",
    "rain",
]

FEATURE_MEDIANS = {
    "quali_delta": 0.6,
    "practice_delta": 0.8,
    "long_run_delta": 0.7,
    "track_avg_finish": 11.0,
    "track_best": 9.0,
    "form_avg_finish": 11.0,
}


def load_model() -> Optional[dict[str, Any]]:
    """Loads the trained model artifact when present and non-corrupt."""
    if not ARTIFACT_PATH.exists():
        return None
    try:
        with open(ARTIFACT_PATH, "rb") as f:
            bundle = pickle.load(f)
        if "model" not in bundle or "feature_names" not in bundle:
            return None
        return bundle
    except Exception:
        return None


def _ml_row(d: dict[str, Any], rain: bool) -> list[float]:
    """Builds one model input row with median-imputation for gaps."""
    row: list[float] = []
    for name in ML_FEATURES:
        if name == "rain":
            row.append(1.0 if rain else 0.0)
            continue
        value = d.get(name)
        if value is None:
            value = FEATURE_MEDIANS.get(name, 12.0)
        row.append(float(value))
    return row


def ml_scores(
    bundle: dict[str, Any], drivers: list[dict[str, Any]], rain: bool
) -> tuple[dict[int, float], bool]:
    """Predicts expected finishing positions with the trained model.

    Returns (scores, usable). ``usable`` is False when the model cannot
    produce a prediction for any driver, letting the caller fall back to
    the deterministic baseline.
    """
    try:
        model = bundle["model"]
        names = bundle["feature_names"]
        rows = []
        usable_numbers = []
        for d in drivers:
            row_dict = dict(zip(ML_FEATURES, _ml_row(d, rain)))
            try:
                rows.append([row_dict[f] for f in names])
                usable_numbers.append(d["driver_number"])
            except KeyError:
                continue  # artifact trained on a different feature set
        if not rows:
            return {}, False
        preds = model.predict(rows)
        scores = {n: float(p) for n, p in zip(usable_numbers, preds)}
        return scores, len(scores) == len(drivers)
    except Exception:
        return {}, False


def monte_carlo(
    expected_positions: dict[int, float],
    rain: bool,
    runs: int = MONTE_CARLO_RUNS,
    dnf_rates: Optional[dict[int, float]] = None,
) -> dict[int, dict[str, float]]:
    """Samples finishing orders around the expected position of each driver.

    DNFs remove a driver from the positional competition (they still get
    ordered among the DNF tail). Aggregates P(win), P(podium), P(points)
    and expected championship points per driver.
    """
    rng = random.Random(4426)  # fixed seed -> deterministic responses
    sigma = RAIN_SIGMA if rain else BASE_SIGMA
    dnf_rates = dnf_rates or {}

    counts: dict[int, list[float]] = {n: [0.0, 0.0, 0.0, 0.0] for n in expected_positions}
    point_tally: dict[int, float] = {n: 0.0 for n in expected_positions}
    driver_numbers = list(expected_positions)

    for _ in range(runs):
        # Every race gets its own chaos level: processional races keep the
        # field close to the expected order, chaotic ones scatter it widely.
        chaos = CHAOS_MIN + (CHAOS_MAX - CHAOS_MIN) * rng.random()
        race_sigma = sigma * chaos
        sampled: dict[int, float] = {}
        for n in driver_numbers:
            if rng.random() < dnf_rates.get(n, BASE_DNF_RATE):
                sampled[n] = 1_000.0 + expected_positions[n]  # DNF tail
            else:
                sampled[n] = max(1.0, rng.gauss(expected_positions[n], race_sigma))
        order = sorted(sampled, key=sampled.get)  # type: ignore[arg-type]
        for pos, n in enumerate(order, start=1):
            finish = sampled[n]
            if finish > 999:  # DNF
                continue
            if pos == 1:
                counts[n][0] += 1
            if pos <= 3:
                counts[n][1] += 1
            if pos <= 10:
                counts[n][2] += 1
                point_tally[n] += _points_for(pos)

    result: dict[int, dict[str, float]] = {}
    for n, (wins, podiums, points_top10, _) in counts.items():
        result[n] = {
            "p_win": wins / runs,
            "p_podium": podiums / runs,
            "p_points": points_top10 / runs,
            "expected_points": point_tally[n] / runs,
        }
    return result


def _points_for(position: int) -> int:
    """Championship points for a finishing position (fast-f1 style table)."""
    return F1_POINTS[position - 1] if 1 <= position <= len(F1_POINTS) else 0


# ---------------------------------------------------------------------------
# Public orchestration
# ---------------------------------------------------------------------------

async def predict_race(features: dict[str, Any]) -> dict[str, Any]:
    """Turns a weekend feature bundle into the final prediction payload.

    Hybrid strategy: use the XGBoost artifact as the primary expected-
    position source when available and complete; otherwise (or partially)
    fall back to the deterministic baseline and merge.
    """
    drivers: list[dict[str, Any]] = [
        d for d in features["drivers"] if d.get("driver_number") is not None
    ]
    rain = bool(features["context"].get("rain"))

    base_scores, factors = baseline_scores(drivers, rain)

    bundle = load_model()
    ml_used = False
    expected_positions = {n: 1.0 + s * (len(drivers) - 1) for n, s in base_scores.items()}

    if bundle:
        ml, usable = ml_scores(bundle, drivers, rain)
        if usable:
            ml_used = True
            # Blend the learned estimate with the baseline (70/30) for
            # robustness on brand-new weekends with sparse features.
            for n in expected_positions:
                expected_positions[n] = 0.7 * ml[n] + 0.3 * expected_positions[n]

    # Per-driver DNF rate from the current season's session results, shrunk
    # toward the fleet baseline (races are few — one DNS/DNF must not imply
    # a 33% failure probability) and clamped to a sane band.
    dnf_rates: dict[int, float] = {}
    for d in drivers:
        rate = d.get("dnf_rate")
        races = d.get("dnf_races") or 0
        if isinstance(rate, (int, float)) and rate is not None and races:
            prior_weight = 10.0
            smoothed = (float(rate) * races + BASE_DNF_RATE * prior_weight) / (
                races + prior_weight
            )
            dnf_rates[d["driver_number"]] = min(max(smoothed, 0.03), 0.35)
        else:
            dnf_rates[d["driver_number"]] = BASE_DNF_RATE
    sim = monte_carlo(expected_positions, rain, dnf_rates=dnf_rates)

    predictions = []
    for d in sorted(drivers, key=lambda d: expected_positions.get(d["driver_number"], 99)):
        n = d["driver_number"]
        stats = sim.get(n, {})
        predictions.append(
            {
                **d,
                "predicted_position": round(expected_positions.get(n, 99.0), 1),
                "p_win": stats.get("p_win", 0.0),
                "p_podium": stats.get("p_podium", 0.0),
                "p_points": stats.get("p_points", 0.0),
                "expected_points": stats.get("expected_points", 0.0),
                "top_factors": factors.get(n, []),
                "dnf_risk": dnf_rates.get(n, BASE_DNF_RATE),
            }
        )

    source = "xgboost + baseline blend" if ml_used else "deterministic baseline"
    return {
        "context": {**features["context"], "model_source": source},
        "predictions": predictions,
    }
