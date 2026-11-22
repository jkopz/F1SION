"""F1SION machine-learning package.

Contains the race prediction feature pipeline, the hybrid
baseline/XGBoost predictor and its training entry points.
"""

from app.ml.features import build_weekend_features, resolve_weekend
from app.ml.predictor import predict_race

__all__ = ["build_weekend_features", "resolve_weekend", "predict_race"]
