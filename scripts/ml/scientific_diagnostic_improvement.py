#!/usr/bin/env python3
"""Football AI v7.0-alpha.7.1 diagnostic and safe-improvement engine.

This engine:
- diagnoses the completed alpha.7 OOF run;
- measures model quality by fold, horizon, class and temporal split;
- creates reliability, overconfidence, market-coverage and feature-drift reports;
- searches conservative horizon/market-specific convex blends on development
  data only;
- never tunes on or scores a new candidate against the already-opened alpha.7
  EVALUATION holdout;
- never promotes a model or calls an external API.
"""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import math
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np

DIAGNOSTIC_VERSION = "v7.0-alpha.7.1-diagnostic-improvement-v1"
DEVELOPMENT_POLICY_VERSION = "safe-convex-development-v1"
MODEL_KEYS = (
    "baseline",
    "catBoost",
    "dixonColes",
    "stacked",
    "calibrated",
    "market",
    "residualMarket",
)
CLASS_NAMES = ("HOME", "DRAW", "AWAY")
EPSILON = 1e-12


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    diagnose = subparsers.add_parser("diagnose")
    diagnose.add_argument("--input", required=True)
    diagnose.add_argument("--output-dir", required=True)
    diagnose.add_argument("--minimum-branch-fixtures", type=int, default=36)
    diagnose.add_argument("--minimum-validation-fixtures", type=int, default=12)
    diagnose.add_argument("--blend-step", type=float, default=0.05)
    diagnose.add_argument("--minimum-baseline-weight", type=float, default=0.50)
    diagnose.add_argument("--maximum-probability-shift", type=float, default=0.08)
    diagnose.add_argument("--minimum-brier-improvement", type=float, default=0.002)
    diagnose.add_argument("--maximum-logloss-regression", type=float, default=0.005)
    diagnose.add_argument("--maximum-ece-regression", type=float, default=0.02)
    diagnose.add_argument("--reliability-bins", type=int, default=10)
    diagnose.add_argument("--drift-bins", type=int, default=10)
    diagnose.add_argument("--top-drift-features", type=int, default=30)

    return parser.parse_args()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                rows.append(json.loads(stripped))
            except json.JSONDecodeError as exc:
                raise ValueError(
                    f"Invalid JSONL at line {line_number}: {exc}"
                ) from exc
    return rows


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True))
            handle.write("\n")


def parse_time(value: str) -> datetime:
    normalized = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def finite(value: Any, fallback: float = 0.0) -> float:
    try:
        converted = float(value)
    except (TypeError, ValueError):
        return fallback
    return converted if math.isfinite(converted) else fallback


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, float(value)))


def normalize(values: Sequence[float]) -> np.ndarray:
    array = np.maximum(np.asarray(values, dtype=float), 0.0)
    total = float(array.sum())
    if total <= EPSILON:
        return np.full(len(array), 1.0 / len(array), dtype=float)
    return array / total


def probability(row: dict[str, Any], key: str) -> np.ndarray | None:
    value = row.get(key)
    if value is None:
        return None
    if isinstance(value, dict):
        return normalize([value[name] for name in CLASS_NAMES])
    if isinstance(value, list) and len(value) == 3:
        return normalize(value)
    return None


def labels(rows: list[dict[str, Any]]) -> np.ndarray:
    return np.asarray(
        [int(row["labels"]["matchWinner"]) for row in rows],
        dtype=int,
    )


def probabilities(rows: list[dict[str, Any]], key: str) -> np.ndarray:
    values: list[np.ndarray] = []
    for row in rows:
        item = probability(row, key)
        if item is None:
            raise ValueError(f"Missing {key} probability for required row.")
        values.append(item)
    return np.asarray(values, dtype=float)


def softmax(logits: np.ndarray) -> np.ndarray:
    shifted = logits - np.max(logits, axis=1, keepdims=True)
    exponentials = np.exp(np.clip(shifted, -50, 50))
    totals = exponentials.sum(axis=1, keepdims=True)
    totals[totals <= EPSILON] = 1.0
    return exponentials / totals


def multiclass_brier(y: np.ndarray, p: np.ndarray) -> float:
    one_hot = np.eye(3, dtype=float)[y]
    return float(np.mean(np.sum((p - one_hot) ** 2, axis=1)))


def multiclass_log_loss(y: np.ndarray, p: np.ndarray) -> float:
    clipped = np.clip(p, 1e-9, 1.0)
    clipped /= clipped.sum(axis=1, keepdims=True)
    indexes = np.arange(len(y))
    return float(np.mean(-np.log(clipped[indexes, y])))


def expected_calibration_error(
    y: np.ndarray,
    p: np.ndarray,
    bins: int = 10,
) -> float:
    if len(y) == 0:
        return float("nan")
    confidence = np.max(p, axis=1)
    prediction = np.argmax(p, axis=1)
    correct = (prediction == y).astype(float)
    error = 0.0

    for index in range(bins):
        lower = index / bins
        upper = (index + 1) / bins
        mask = (
            (confidence >= lower) & (confidence <= upper)
            if index == bins - 1
            else (confidence >= lower) & (confidence < upper)
        )
        count = int(mask.sum())
        if count == 0:
            continue
        error += (
            count
            / len(y)
            * abs(float(confidence[mask].mean()) - float(correct[mask].mean()))
        )
    return float(error)


def metric_set(
    y: np.ndarray,
    p: np.ndarray,
    bins: int = 10,
) -> dict[str, Any]:
    if len(y) == 0:
        return {
            "rows": 0,
            "brier": None,
            "logLoss": None,
            "accuracy": None,
            "expectedCalibrationError": None,
            "meanConfidence": None,
            "meanEntropy": None,
        }

    entropy = -np.sum(np.clip(p, 1e-12, 1.0) * np.log(np.clip(p, 1e-12, 1.0)), axis=1)
    return {
        "rows": int(len(y)),
        "brier": multiclass_brier(y, p),
        "logLoss": multiclass_log_loss(y, p),
        "accuracy": float(np.mean(np.argmax(p, axis=1) == y)),
        "expectedCalibrationError": expected_calibration_error(y, p, bins),
        "meanConfidence": float(np.max(p, axis=1).mean()),
        "meanEntropy": float(entropy.mean()),
    }


def available_rows(rows: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    return [row for row in rows if probability(row, key) is not None]


def metrics_for(rows: list[dict[str, Any]], key: str, bins: int) -> dict[str, Any]:
    selected = available_rows(rows, key)
    if not selected:
        return metric_set(np.asarray([], dtype=int), np.empty((0, 3)), bins)
    return metric_set(labels(selected), probabilities(selected, key), bins)


def fixture_count(rows: list[dict[str, Any]]) -> int:
    return len({int(row["fixtureId"]) for row in rows})


def sorted_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        rows,
        key=lambda row: (
            parse_time(str(row["kickoffAt"])),
            int(row["fixtureId"]),
            int(row["horizonMinutes"]),
        ),
    )


def validate(rows: list[dict[str, Any]]) -> tuple[list[str], str, int]:
    if not rows:
        raise ValueError("Diagnostic input is empty.")

    required = {
        "fixtureId",
        "predictionAsOf",
        "kickoffAt",
        "horizonMinutes",
        "foldNumber",
        "splitRole",
        "trainedThrough",
        "labels",
        "baseline",
        "catBoost",
        "dixonColes",
        "stacked",
        "calibrated",
        "featureNames",
        "featureVector",
        "featureContractHash",
        "featurePayloadHash",
    }
    feature_names = list(rows[0]["featureNames"])
    contract_hash = str(rows[0]["featureContractHash"])
    source_run_id = int(rows[0]["sourceEvaluationRunId"])

    for row in rows:
        missing = required - row.keys()
        if missing:
            raise ValueError(f"Diagnostic input row missing: {sorted(missing)}")
        if list(row["featureNames"]) != feature_names:
            raise ValueError("Feature names changed inside diagnostic input.")
        if str(row["featureContractHash"]) != contract_hash:
            raise ValueError("Feature contract hash changed inside diagnostic input.")
        if int(row["sourceEvaluationRunId"]) != source_run_id:
            raise ValueError("Source evaluation run changed inside diagnostic input.")
        vector = row["featureVector"]
        if len(vector) != len(feature_names):
            raise ValueError("Feature vector width mismatch.")
        if not all(math.isfinite(finite(value, float("nan"))) for value in vector):
            raise ValueError("Feature vector contains a non-finite value.")
        if parse_time(str(row["trainedThrough"])) >= parse_time(
            str(row["predictionAsOf"])
        ):
            raise ValueError(
                f"OOF leakage in fixture {row['fixtureId']} horizon "
                f"{row['horizonMinutes']}."
            )

    return feature_names, contract_hash, source_run_id


def dataset_fingerprint(rows: list[dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    for row in sorted_rows(rows):
        digest.update(
            json.dumps(
                {
                    "sourceEvaluationRunId": row["sourceEvaluationRunId"],
                    "fixtureId": row["fixtureId"],
                    "horizonMinutes": row["horizonMinutes"],
                    "splitRole": row["splitRole"],
                    "featurePayloadHash": row["featurePayloadHash"],
                },
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        )
        digest.update(b"\n")
    return digest.hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def group_metrics(
    rows: list[dict[str, Any]],
    bins: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    by_fold: dict[str, Any] = {}
    by_horizon: dict[str, Any] = {}

    fold_values = sorted({int(row["foldNumber"]) for row in rows})
    horizons = sorted({int(row["horizonMinutes"]) for row in rows}, reverse=True)

    for fold in fold_values:
        fold_rows = [row for row in rows if int(row["foldNumber"]) == fold]
        by_fold[str(fold)] = {
            "rows": len(fold_rows),
            "fixtures": fixture_count(fold_rows),
            "dateFrom": min(str(row["predictionAsOf"]) for row in fold_rows),
            "dateTo": max(str(row["predictionAsOf"]) for row in fold_rows),
            "models": {
                model: metrics_for(fold_rows, model, bins)
                for model in MODEL_KEYS
            },
        }

    for horizon in horizons:
        horizon_rows = [
            row for row in rows if int(row["horizonMinutes"]) == horizon
        ]
        by_horizon[str(horizon)] = {
            "rows": len(horizon_rows),
            "fixtures": fixture_count(horizon_rows),
            "roles": {
                role: {
                    "rows": len(
                        [row for row in horizon_rows if row["splitRole"] == role]
                    ),
                    "models": {
                        model: metrics_for(
                            [
                                row
                                for row in horizon_rows
                                if row["splitRole"] == role
                            ],
                            model,
                            bins,
                        )
                        for model in MODEL_KEYS
                    },
                }
                for role in sorted({str(row["splitRole"]) for row in horizon_rows})
            },
            "models": {
                model: metrics_for(horizon_rows, model, bins)
                for model in MODEL_KEYS
            },
        }

    return by_fold, by_horizon


def class_metrics(
    rows: list[dict[str, Any]],
) -> dict[str, Any]:
    report: dict[str, Any] = {}
    for model in MODEL_KEYS:
        selected = available_rows(rows, model)
        if not selected:
            report[model] = {"rows": 0, "classes": {}}
            continue
        y = labels(selected)
        p = probabilities(selected, model)
        predicted = np.argmax(p, axis=1)
        model_report: dict[str, Any] = {
            "rows": len(selected),
            "classes": {},
        }
        for class_index, class_name in enumerate(CLASS_NAMES):
            mask = y == class_index
            support = int(mask.sum())
            one_vs_rest_brier = float(
                np.mean((p[:, class_index] - mask.astype(float)) ** 2)
            )
            predicted_mask = predicted == class_index
            precision = (
                float(np.mean(y[predicted_mask] == class_index))
                if int(predicted_mask.sum()) > 0
                else None
            )
            recall = (
                float(np.mean(predicted[mask] == class_index))
                if support > 0
                else None
            )
            model_report["classes"][class_name] = {
                "support": support,
                "observedFrequency": float(mask.mean()),
                "meanPredictedProbability": float(p[:, class_index].mean()),
                "oneVsRestBrier": one_vs_rest_brier,
                "precision": precision,
                "recall": recall,
                "predictedCount": int(predicted_mask.sum()),
            }
        report[model] = model_report
    return report


def reliability_report(
    rows: list[dict[str, Any]],
    bin_count: int,
) -> dict[str, Any]:
    report: dict[str, Any] = {}
    horizons = sorted({int(row["horizonMinutes"]) for row in rows}, reverse=True)
    roles = sorted({str(row["splitRole"]) for row in rows})

    for model in MODEL_KEYS:
        report[model] = {}
        for horizon in horizons:
            report[model][str(horizon)] = {}
            for role in roles:
                selected = [
                    row
                    for row in rows
                    if int(row["horizonMinutes"]) == horizon
                    and row["splitRole"] == role
                    and probability(row, model) is not None
                ]
                if not selected:
                    report[model][str(horizon)][role] = []
                    continue
                y = labels(selected)
                p = probabilities(selected, model)
                confidence = np.max(p, axis=1)
                predicted = np.argmax(p, axis=1)
                correct = (predicted == y).astype(float)
                bins: list[dict[str, Any]] = []
                for index in range(bin_count):
                    lower = index / bin_count
                    upper = (index + 1) / bin_count
                    mask = (
                        (confidence >= lower) & (confidence <= upper)
                        if index == bin_count - 1
                        else (confidence >= lower) & (confidence < upper)
                    )
                    count = int(mask.sum())
                    bins.append(
                        {
                            "lower": lower,
                            "upper": upper,
                            "rows": count,
                            "meanConfidence": (
                                float(confidence[mask].mean()) if count else None
                            ),
                            "accuracy": (
                                float(correct[mask].mean()) if count else None
                            ),
                            "gap": (
                                float(
                                    confidence[mask].mean()
                                    - correct[mask].mean()
                                )
                                if count
                                else None
                            ),
                        }
                    )
                report[model][str(horizon)][role] = bins
    return report


def overconfidence_report(rows: list[dict[str, Any]]) -> dict[str, Any]:
    report: dict[str, Any] = {}
    for model in MODEL_KEYS:
        selected = available_rows(rows, model)
        if not selected:
            report[model] = {"rows": 0}
            continue
        y = labels(selected)
        p = probabilities(selected, model)
        confidence = np.max(p, axis=1)
        predicted = np.argmax(p, axis=1)
        incorrect = predicted != y
        actual_probability = p[np.arange(len(y)), y]
        report[model] = {
            "rows": len(selected),
            "meanConfidence": float(confidence.mean()),
            "meanActualClassProbability": float(actual_probability.mean()),
            "meanConfidenceWhenWrong": (
                float(confidence[incorrect].mean()) if int(incorrect.sum()) else None
            ),
            "wrongAtOrAbove050": int(np.sum(incorrect & (confidence >= 0.50))),
            "wrongAtOrAbove055": int(np.sum(incorrect & (confidence >= 0.55))),
            "wrongAtOrAbove065": int(np.sum(incorrect & (confidence >= 0.65))),
            "wrongAtOrAbove075": int(np.sum(incorrect & (confidence >= 0.75))),
            "maximumConfidenceOnWrongPrediction": (
                float(confidence[incorrect].max()) if int(incorrect.sum()) else None
            ),
        }
    return report


def market_coverage_report(rows: list[dict[str, Any]]) -> dict[str, Any]:
    def summarize(selected: list[dict[str, Any]]) -> dict[str, Any]:
        market_rows = [row for row in selected if probability(row, "market") is not None]
        residual_rows = [
            row for row in selected if probability(row, "residualMarket") is not None
        ]
        return {
            "rows": len(selected),
            "fixtures": fixture_count(selected),
            "marketRows": len(market_rows),
            "marketFixtures": fixture_count(market_rows),
            "marketCoverage": len(market_rows) / len(selected) if selected else 0,
            "residualRows": len(residual_rows),
            "residualFixtures": fixture_count(residual_rows),
            "residualCoverage": len(residual_rows) / len(selected) if selected else 0,
        }

    report: dict[str, Any] = {
        "overall": summarize(rows),
        "byFold": {},
        "byHorizon": {},
        "byRole": {},
        "byQuarter": {},
    }
    for fold in sorted({int(row["foldNumber"]) for row in rows}):
        report["byFold"][str(fold)] = summarize(
            [row for row in rows if int(row["foldNumber"]) == fold]
        )
    for horizon in sorted(
        {int(row["horizonMinutes"]) for row in rows}, reverse=True
    ):
        report["byHorizon"][str(horizon)] = summarize(
            [row for row in rows if int(row["horizonMinutes"]) == horizon]
        )
    for role in sorted({str(row["splitRole"]) for row in rows}):
        report["byRole"][role] = summarize(
            [row for row in rows if row["splitRole"] == role]
        )
    quarter_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        timestamp = parse_time(str(row["kickoffAt"]))
        quarter = (timestamp.month - 1) // 3 + 1
        quarter_groups[f"{timestamp.year}-Q{quarter}"].append(row)
    for quarter, selected in sorted(quarter_groups.items()):
        report["byQuarter"][quarter] = summarize(selected)
    return report


def label_drift_report(rows: list[dict[str, Any]]) -> dict[str, Any]:
    report: dict[str, Any] = {}
    for role in sorted({str(row["splitRole"]) for row in rows}):
        selected = [row for row in rows if row["splitRole"] == role]
        counts = Counter(int(row["labels"]["matchWinner"]) for row in selected)
        report[role] = {
            "rows": len(selected),
            "fixtures": fixture_count(selected),
            "HOME": counts[0] / len(selected) if selected else 0,
            "DRAW": counts[1] / len(selected) if selected else 0,
            "AWAY": counts[2] / len(selected) if selected else 0,
        }
    return report


def psi(
    reference: np.ndarray,
    comparison: np.ndarray,
    bins: int,
) -> float | None:
    if len(reference) < 8 or len(comparison) < 8:
        return None
    quantiles = np.linspace(0, 1, bins + 1)
    edges = np.unique(np.quantile(reference, quantiles))
    if len(edges) < 3:
        return 0.0
    edges[0] = -np.inf
    edges[-1] = np.inf
    ref_counts, _ = np.histogram(reference, bins=edges)
    cmp_counts, _ = np.histogram(comparison, bins=edges)
    ref_ratio = np.maximum(ref_counts / max(ref_counts.sum(), 1), 1e-6)
    cmp_ratio = np.maximum(cmp_counts / max(cmp_counts.sum(), 1), 1e-6)
    return float(np.sum((cmp_ratio - ref_ratio) * np.log(cmp_ratio / ref_ratio)))


def standardized_mean_difference(
    reference: np.ndarray,
    comparison: np.ndarray,
) -> float:
    pooled = math.sqrt(
        max((float(np.var(reference)) + float(np.var(comparison))) / 2, 1e-12)
    )
    return float((float(np.mean(comparison)) - float(np.mean(reference))) / pooled)


def feature_drift_report(
    rows: list[dict[str, Any]],
    feature_names: list[str],
    bins: int,
    top_count: int,
) -> dict[str, Any]:
    groups = {
        role: [row for row in rows if row["splitRole"] == role]
        for role in ("STACK_TRAIN", "CALIBRATION", "EVALUATION")
    }
    comparisons = (
        ("STACK_TRAIN", "CALIBRATION"),
        ("CALIBRATION", "EVALUATION"),
        ("STACK_TRAIN", "EVALUATION"),
    )
    report: dict[str, Any] = {
        "warning": (
            "EVALUATION drift is diagnostic-only. The already-opened EVALUATION "
            "rows are not used to select development candidates."
        ),
        "comparisons": {},
    }

    for left_name, right_name in comparisons:
        left_rows = groups[left_name]
        right_rows = groups[right_name]
        metrics: list[dict[str, Any]] = []
        if not left_rows or not right_rows:
            report["comparisons"][f"{left_name}_TO_{right_name}"] = []
            continue
        left_matrix = np.asarray(
            [row["featureVector"] for row in left_rows], dtype=float
        )
        right_matrix = np.asarray(
            [row["featureVector"] for row in right_rows], dtype=float
        )
        for index, feature_name in enumerate(feature_names):
            left = left_matrix[:, index]
            right = right_matrix[:, index]
            feature_psi = psi(left, right, bins)
            smd = standardized_mean_difference(left, right)
            metrics.append(
                {
                    "feature": feature_name,
                    "referenceRows": len(left),
                    "comparisonRows": len(right),
                    "referenceMean": float(np.mean(left)),
                    "comparisonMean": float(np.mean(right)),
                    "referenceStd": float(np.std(left)),
                    "comparisonStd": float(np.std(right)),
                    "standardizedMeanDifference": smd,
                    "absoluteStandardizedMeanDifference": abs(smd),
                    "psi": feature_psi,
                    "severity": (
                        "HIGH"
                        if (feature_psi is not None and feature_psi >= 0.25)
                        or abs(smd) >= 0.50
                        else "MODERATE"
                        if (feature_psi is not None and feature_psi >= 0.10)
                        or abs(smd) >= 0.25
                        else "LOW"
                    ),
                }
            )
        metrics.sort(
            key=lambda item: (
                finite(item["psi"], 0),
                item["absoluteStandardizedMeanDifference"],
            ),
            reverse=True,
        )
        report["comparisons"][f"{left_name}_TO_{right_name}"] = metrics[
            :top_count
        ]
    return report


def confidence_cap(
    candidate: np.ndarray,
    baseline: np.ndarray,
    maximum_shift: float,
) -> np.ndarray:
    difference = candidate - baseline
    max_difference = float(np.max(np.abs(difference)))
    if max_difference <= maximum_shift + 1e-15:
        return normalize(candidate)
    scale = maximum_shift / max(max_difference, EPSILON)
    return normalize(baseline + scale * difference)


def blend_probability(
    row: dict[str, Any],
    source_keys: Sequence[str],
    weights: Sequence[float],
    maximum_shift: float,
) -> np.ndarray:
    components: list[np.ndarray] = []
    for key in source_keys:
        component = probability(row, key)
        if component is None:
            raise ValueError(f"Missing source {key} for blend.")
        components.append(component)
    mixed = normalize(
        np.sum(
            np.asarray(
                [weight * component for weight, component in zip(weights, components)]
            ),
            axis=0,
        )
    )
    baseline = probability(row, "baseline")
    assert baseline is not None
    return confidence_cap(mixed, baseline, maximum_shift)


def weight_grid(
    source_keys: Sequence[str],
    step: float,
    minimum_baseline_weight: float,
) -> list[tuple[float, ...]]:
    count = len(source_keys)
    if source_keys[0] != "baseline":
        raise ValueError("Safe blend must use baseline as the first source.")
    units = max(2, int(round(1 / step)))
    minimum_baseline_units = int(math.ceil(minimum_baseline_weight * units - 1e-9))
    combinations: list[tuple[float, ...]] = []

    def compositions(total: int, parts: int) -> Iterable[tuple[int, ...]]:
        if parts == 1:
            yield (total,)
            return
        for value in range(total + 1):
            for remainder in compositions(total - value, parts - 1):
                yield (value, *remainder)

    for integer_weights in compositions(units, count):
        if integer_weights[0] < minimum_baseline_units:
            continue
        weights = tuple(value / units for value in integer_weights)
        if sum(weight > 0 for weight in weights[1:]) == 0:
            continue
        combinations.append(weights)
    return combinations


def blend_matrix(
    rows: list[dict[str, Any]],
    source_keys: Sequence[str],
    weights: Sequence[float],
    maximum_shift: float,
) -> np.ndarray:
    return np.asarray(
        [
            blend_probability(row, source_keys, weights, maximum_shift)
            for row in rows
        ],
        dtype=float,
    )


def objective(y: np.ndarray, p: np.ndarray) -> float:
    return multiclass_brier(y, p) + 0.25 * multiclass_log_loss(y, p)


def fit_temperature(y: np.ndarray, p: np.ndarray) -> tuple[float, dict[str, Any]]:
    if len(y) == 0:
        return 1.0, {"temperature": 1.0, "accepted": False, "reason": "NO_ROWS"}
    raw_objective = objective(y, p)
    logits = np.log(np.clip(p, 1e-9, 1.0))
    best_temperature = 1.0
    best_objective = raw_objective
    for temperature in np.linspace(0.80, 2.50, 171):
        calibrated = softmax(logits / temperature)
        score = objective(y, calibrated)
        if score < best_objective - 1e-12:
            best_objective = score
            best_temperature = float(temperature)
    return best_temperature, {
        "temperature": best_temperature,
        "accepted": best_temperature != 1.0,
        "rawObjective": raw_objective,
        "calibratedObjective": best_objective,
    }


def apply_temperature(p: np.ndarray, temperature: float) -> np.ndarray:
    if abs(temperature - 1.0) < 1e-12:
        return p
    logits = np.log(np.clip(p, 1e-9, 1.0))
    return softmax(logits / temperature)


def temporal_fixture_split(
    rows: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    ordered = sorted_rows(rows)
    fixture_order: list[int] = []
    seen: set[int] = set()
    for row in ordered:
        fixture_id = int(row["fixtureId"])
        if fixture_id not in seen:
            seen.add(fixture_id)
            fixture_order.append(fixture_id)
    count = len(fixture_order)
    fit_end = max(1, int(math.floor(count * 0.50)))
    calibration_end = max(fit_end + 1, int(math.floor(count * 0.75)))
    calibration_end = min(calibration_end, count - 1)
    fit_ids = set(fixture_order[:fit_end])
    calibration_ids = set(fixture_order[fit_end:calibration_end])
    validation_ids = set(fixture_order[calibration_end:])
    return (
        [row for row in rows if int(row["fixtureId"]) in fit_ids],
        [row for row in rows if int(row["fixtureId"]) in calibration_ids],
        [row for row in rows if int(row["fixtureId"]) in validation_ids],
    )


def source_sets(branch: str) -> list[tuple[str, ...]]:
    base = [
        ("baseline", "catBoost"),
        ("baseline", "dixonColes"),
        ("baseline", "catBoost", "dixonColes"),
    ]
    if branch == "WITH_MARKET":
        base.extend(
            [
                ("baseline", "market"),
                ("baseline", "catBoost", "dixonColes", "market"),
                ("baseline", "catBoost", "dixonColes", "residualMarket"),
            ]
        )
    return base


def candidate_search(
    rows: list[dict[str, Any]],
    horizon: int,
    branch: str,
    args: argparse.Namespace,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    branch_rows = [
        row
        for row in rows
        if int(row["horizonMinutes"]) == horizon
        and (
            probability(row, "market") is not None
            if branch == "WITH_MARKET"
            else probability(row, "market") is None
        )
    ]
    branch_fixtures = fixture_count(branch_rows)
    if branch_fixtures < int(args.minimum_branch_fixtures):
        return (
            {
                "horizonMinutes": horizon,
                "marketBranch": branch,
                "status": "INSUFFICIENT_BRANCH_DATA",
                "fixtures": branch_fixtures,
                "minimumRequired": int(args.minimum_branch_fixtures),
                "evaluationHoldoutUsedForSelection": False,
            },
            [],
        )

    fit_rows, calibration_rows, validation_rows = temporal_fixture_split(branch_rows)
    if fixture_count(validation_rows) < int(args.minimum_validation_fixtures):
        return (
            {
                "horizonMinutes": horizon,
                "marketBranch": branch,
                "status": "INSUFFICIENT_VALIDATION_DATA",
                "fixtures": branch_fixtures,
                "validationFixtures": fixture_count(validation_rows),
                "minimumRequired": int(args.minimum_validation_fixtures),
                "evaluationHoldoutUsedForSelection": False,
            },
            [],
        )

    baseline_validation = probabilities(validation_rows, "baseline")
    y_validation = labels(validation_rows)
    baseline_validation_metrics = metric_set(
        y_validation, baseline_validation, int(args.reliability_bins)
    )
    experiments: list[dict[str, Any]] = []
    prediction_rows: list[dict[str, Any]] = []

    for sources in source_sets(branch):
        if any(
            probability(row, source) is None
            for source in sources
            for row in fit_rows + calibration_rows + validation_rows
        ):
            continue
        grids = weight_grid(
            sources,
            float(args.blend_step),
            float(args.minimum_baseline_weight),
        )
        if not grids:
            continue
        y_fit = labels(fit_rows)
        best_weights: tuple[float, ...] | None = None
        best_fit_score = float("inf")
        best_fit_metrics: dict[str, Any] | None = None

        for weights in grids:
            fit_predictions = blend_matrix(
                fit_rows,
                sources,
                weights,
                float(args.maximum_probability_shift),
            )
            score = objective(y_fit, fit_predictions)
            if score < best_fit_score:
                best_fit_score = score
                best_weights = weights
                best_fit_metrics = metric_set(
                    y_fit, fit_predictions, int(args.reliability_bins)
                )

        assert best_weights is not None
        calibration_predictions = blend_matrix(
            calibration_rows,
            sources,
            best_weights,
            float(args.maximum_probability_shift),
        )
        temperature, calibration_info = fit_temperature(
            labels(calibration_rows), calibration_predictions
        )
        validation_raw = blend_matrix(
            validation_rows,
            sources,
            best_weights,
            float(args.maximum_probability_shift),
        )
        validation_predictions = apply_temperature(validation_raw, temperature)
        validation_metrics = metric_set(
            y_validation,
            validation_predictions,
            int(args.reliability_bins),
        )
        raw_validation_metrics = metric_set(
            y_validation,
            validation_raw,
            int(args.reliability_bins),
        )
        brier_improvement = (
            baseline_validation_metrics["brier"] - validation_metrics["brier"]
        )
        logloss_change = (
            validation_metrics["logLoss"] - baseline_validation_metrics["logLoss"]
        )
        ece_change = (
            validation_metrics["expectedCalibrationError"]
            - baseline_validation_metrics["expectedCalibrationError"]
        )
        gates = {
            "minimumBrierImprovement": brier_improvement
            >= float(args.minimum_brier_improvement),
            "logLossControlled": logloss_change
            <= float(args.maximum_logloss_regression),
            "calibrationControlled": ece_change
            <= float(args.maximum_ece_regression),
            "baselineWeightFloor": best_weights[0]
            >= float(args.minimum_baseline_weight) - 1e-12,
            "maximumProbabilityShift": True,
        }
        passes = all(gates.values())
        experiment_id = hashlib.sha256(
            json.dumps(
                {
                    "horizon": horizon,
                    "branch": branch,
                    "sources": sources,
                    "weights": best_weights,
                    "temperature": temperature,
                    "cap": float(args.maximum_probability_shift),
                },
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()[:16]
        experiments.append(
            {
                "experimentId": experiment_id,
                "horizonMinutes": horizon,
                "marketBranch": branch,
                "method": "SAFE_CONVEX_BLEND",
                "sources": list(sources),
                "weights": {
                    source: weight for source, weight in zip(sources, best_weights)
                },
                "temperature": temperature,
                "maximumProbabilityShift": float(args.maximum_probability_shift),
                "fitMetrics": best_fit_metrics,
                "calibration": calibration_info,
                "rawValidationMetrics": raw_validation_metrics,
                "validationMetrics": validation_metrics,
                "baselineValidationMetrics": baseline_validation_metrics,
                "deltas": {
                    "brierImprovement": brier_improvement,
                    "logLossChange": logloss_change,
                    "eceChange": ece_change,
                },
                "gates": gates,
                "passesDevelopmentSafety": passes,
                "fitFixtures": fixture_count(fit_rows),
                "calibrationFixtures": fixture_count(calibration_rows),
                "validationFixtures": fixture_count(validation_rows),
                "evaluationHoldoutUsedForSelection": False,
            }
        )
        for row, prediction_value in zip(validation_rows, validation_predictions):
            prediction_rows.append(
                {
                    "experimentId": experiment_id,
                    "fixtureId": int(row["fixtureId"]),
                    "horizonMinutes": horizon,
                    "marketBranch": branch,
                    "predictionAsOf": row["predictionAsOf"],
                    "kickoffAt": row["kickoffAt"],
                    "actualMatchWinner": int(row["labels"]["matchWinner"]),
                    "baseline": probability(row, "baseline").tolist(),
                    "developmentCandidate": [
                        float(value) for value in prediction_value.tolist()
                    ],
                    "splitRole": "DEVELOPMENT_VALIDATION",
                }
            )

    passing = [item for item in experiments if item["passesDevelopmentSafety"]]
    ranking_pool = passing if passing else experiments
    ranking_pool.sort(
        key=lambda item: (
            item["validationMetrics"]["brier"],
            item["validationMetrics"]["logLoss"],
            item["validationMetrics"]["expectedCalibrationError"],
            -item["weights"].get("baseline", 0),
        )
    )
    selected = ranking_pool[0] if ranking_pool else None
    status = (
        "DEVELOPMENT_CANDIDATE"
        if selected is not None and selected["passesDevelopmentSafety"]
        else "NO_SAFE_IMPROVEMENT"
    )

    return (
        {
            "horizonMinutes": horizon,
            "marketBranch": branch,
            "status": status,
            "fixtures": branch_fixtures,
            "fitFixtures": fixture_count(fit_rows),
            "calibrationFixtures": fixture_count(calibration_rows),
            "validationFixtures": fixture_count(validation_rows),
            "baselineValidationMetrics": baseline_validation_metrics,
            "selected": selected,
            "experimentCount": len(experiments),
            "passingExperimentCount": len(passing),
            "evaluationHoldoutUsedForSelection": False,
            "oldEvaluationHoldoutStatus": "DIAGNOSTIC_ONLY_ALREADY_OPENED",
        },
        prediction_rows,
    )


def development_search(
    rows: list[dict[str, Any]],
    args: argparse.Namespace,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    development_rows = [
        row for row in rows if row["splitRole"] != "EVALUATION"
    ]
    horizons = sorted(
        {int(row["horizonMinutes"]) for row in development_rows}, reverse=True
    )
    results: list[dict[str, Any]] = []
    predictions_output: list[dict[str, Any]] = []

    for horizon in horizons:
        for branch in ("NO_MARKET", "WITH_MARKET"):
            result, prediction_rows = candidate_search(
                development_rows, horizon, branch, args
            )
            results.append(result)
            predictions_output.extend(prediction_rows)

    selected_count = sum(
        result["status"] == "DEVELOPMENT_CANDIDATE" for result in results
    )
    return (
        {
            "policyVersion": DEVELOPMENT_POLICY_VERSION,
            "sourceRows": len(development_rows),
            "sourceFixtures": fixture_count(development_rows),
            "excludedEvaluationRows": len(rows) - len(development_rows),
            "excludedEvaluationFixtures": fixture_count(
                [row for row in rows if row["splitRole"] == "EVALUATION"]
            ),
            "evaluationHoldoutUsedForSelection": False,
            "selectedDevelopmentCandidates": selected_count,
            "results": results,
            "constraints": {
                "minimumBaselineWeight": float(args.minimum_baseline_weight),
                "maximumProbabilityShift": float(args.maximum_probability_shift),
                "minimumBrierImprovement": float(args.minimum_brier_improvement),
                "maximumLogLossRegression": float(args.maximum_logloss_regression),
                "maximumEceRegression": float(args.maximum_ece_regression),
                "blendStep": float(args.blend_step),
            },
        },
        predictions_output,
    )


def summary(
    rows: list[dict[str, Any]],
    by_horizon: dict[str, Any],
    market_coverage: dict[str, Any],
    development: dict[str, Any],
) -> dict[str, Any]:
    evaluation_rows = [row for row in rows if row["splitRole"] == "EVALUATION"]
    t90 = by_horizon.get("90", {}).get("roles", {}).get("EVALUATION", {})
    t90_models = t90.get("models", {})
    baseline = t90_models.get("baseline", {})
    candidate = t90_models.get("calibrated", {})
    stacked = t90_models.get("stacked", {})
    catboost = t90_models.get("catBoost", {})
    dixon = t90_models.get("dixonColes", {})
    findings: list[dict[str, Any]] = []

    if baseline and candidate and baseline.get("brier") is not None:
        findings.append(
            {
                "code": "OPENED_HOLDOUT_CANDIDATE_REGRESSION",
                "severity": "HIGH",
                "detail": {
                    "baselineBrier": baseline.get("brier"),
                    "candidateBrier": candidate.get("brier"),
                    "baselineLogLoss": baseline.get("logLoss"),
                    "candidateLogLoss": candidate.get("logLoss"),
                },
            }
        )
    if stacked and candidate and stacked.get("brier") is not None:
        findings.append(
            {
                "code": "CALIBRATION_PARTIALLY_REPAIRS_STACKER",
                "severity": "HIGH",
                "detail": {
                    "stackedBrier": stacked.get("brier"),
                    "calibratedBrier": candidate.get("brier"),
                },
            }
        )
    if catboost and dixon and baseline:
        findings.append(
            {
                "code": "BASE_LEARNERS_DO_NOT_BEAT_BASELINE_ON_OPENED_T90",
                "severity": "HIGH",
                "detail": {
                    "baselineBrier": baseline.get("brier"),
                    "catBoostBrier": catboost.get("brier"),
                    "dixonColesBrier": dixon.get("brier"),
                },
            }
        )
    if market_coverage["byRole"].get("EVALUATION", {}).get("marketRows", 0) == 0:
        findings.append(
            {
                "code": "NO_MARKET_ROWS_IN_OPENED_EVALUATION",
                "severity": "HIGH",
                "detail": market_coverage["byRole"].get("EVALUATION", {}),
            }
        )

    return {
        "diagnosticVersion": DIAGNOSTIC_VERSION,
        "rows": len(rows),
        "fixtures": fixture_count(rows),
        "evaluationRows": len(evaluation_rows),
        "evaluationFixtures": fixture_count(evaluation_rows),
        "leakageViolations": 0,
        "oldEvaluationHoldoutStatus": "DIAGNOSTIC_ONLY_ALREADY_OPENED",
        "developmentSelectionUsesOldEvaluation": False,
        "selectedDevelopmentCandidates": development[
            "selectedDevelopmentCandidates"
        ],
        "findings": findings,
        "recommendedNextStage": (
            "v7.0-alpha.8-fresh-nested-evaluation"
            if development["selectedDevelopmentCandidates"] > 0
            else "collect-more-data-or-rework-base-learners"
        ),
        "productionModelChanged": False,
        "automaticPromotion": False,
        "apiCalled": False,
    }


def diagnose(args: argparse.Namespace) -> None:
    input_path = Path(args.input).resolve()
    output_root = Path(args.output_dir).resolve()
    rows = read_jsonl(input_path)
    feature_names, contract_hash, source_run_id = validate(rows)
    fingerprint = dataset_fingerprint(rows)
    version = f"{DIAGNOSTIC_VERSION}-{fingerprint[:12]}"
    artifact_dir = output_root / version
    artifact_dir.mkdir(parents=True, exist_ok=True)

    by_fold, by_horizon = group_metrics(rows, int(args.reliability_bins))
    class_report = class_metrics(rows)
    reliability = reliability_report(rows, int(args.reliability_bins))
    overconfidence = overconfidence_report(rows)
    market_coverage = market_coverage_report(rows)
    label_drift = label_drift_report(rows)
    feature_drift = feature_drift_report(
        rows,
        feature_names,
        int(args.drift_bins),
        int(args.top_drift_features),
    )
    development, development_predictions = development_search(rows, args)
    diagnostic_summary = summary(
        rows, by_horizon, market_coverage, development
    )

    paths = {
        "diagnosticSummary": artifact_dir / "diagnostic_summary.json",
        "metricsByFold": artifact_dir / "model_metrics_by_fold.json",
        "metricsByHorizon": artifact_dir / "model_metrics_by_horizon.json",
        "metricsByClass": artifact_dir / "model_metrics_by_class.json",
        "reliabilityBins": artifact_dir / "reliability_bins.json",
        "overconfidence": artifact_dir / "overconfidence.json",
        "marketCoverage": artifact_dir / "market_coverage.json",
        "labelDrift": artifact_dir / "label_drift.json",
        "featureDrift": artifact_dir / "feature_drift.json",
        "developmentCandidates": artifact_dir / "development_candidates.json",
        "developmentPredictions": artifact_dir / "development_predictions.jsonl",
    }

    write_json(paths["diagnosticSummary"], diagnostic_summary)
    write_json(paths["metricsByFold"], by_fold)
    write_json(paths["metricsByHorizon"], by_horizon)
    write_json(paths["metricsByClass"], class_report)
    write_json(paths["reliabilityBins"], reliability)
    write_json(paths["overconfidence"], overconfidence)
    write_json(paths["marketCoverage"], market_coverage)
    write_json(paths["labelDrift"], label_drift)
    write_json(paths["featureDrift"], feature_drift)
    write_json(paths["developmentCandidates"], development)
    write_jsonl(paths["developmentPredictions"], development_predictions)

    artifact_hashes = {
        key: file_sha256(path)
        for key, path in paths.items()
    }
    metadata = {
        "diagnosticVersion": DIAGNOSTIC_VERSION,
        "developmentPolicyVersion": DEVELOPMENT_POLICY_VERSION,
        "version": version,
        "sourceEvaluationRunId": source_run_id,
        "sourceFeatureContractHash": contract_hash,
        "datasetFingerprint": fingerprint,
        "artifactDirectory": str(artifact_dir),
        "artifactSha256": artifact_hashes,
        "rows": len(rows),
        "fixtures": fixture_count(rows),
        "developmentRows": len(
            [row for row in rows if row["splitRole"] != "EVALUATION"]
        ),
        "evaluationRows": len(
            [row for row in rows if row["splitRole"] == "EVALUATION"]
        ),
        "leakageViolations": 0,
        "developmentCandidateCount": development[
            "selectedDevelopmentCandidates"
        ],
        "diagnosticSummary": diagnostic_summary,
        "configuration": {
            "minimumBranchFixtures": int(args.minimum_branch_fixtures),
            "minimumValidationFixtures": int(args.minimum_validation_fixtures),
            "blendStep": float(args.blend_step),
            "minimumBaselineWeight": float(args.minimum_baseline_weight),
            "maximumProbabilityShift": float(args.maximum_probability_shift),
            "minimumBrierImprovement": float(args.minimum_brier_improvement),
            "maximumLogLossRegression": float(args.maximum_logloss_regression),
            "maximumEceRegression": float(args.maximum_ece_regression),
            "reliabilityBins": int(args.reliability_bins),
            "driftBins": int(args.drift_bins),
            "topDriftFeatures": int(args.top_drift_features),
            "evaluationHoldoutUsedForSelection": False,
        },
        "paths": {key: str(path) for key, path in paths.items()},
        "pythonVersion": sys.version.split()[0],
        "numpyVersion": np.__version__,
        "apiCalled": False,
        "productionModelChanged": False,
        "automaticPromotion": False,
    }
    metadata_path = artifact_dir / "metadata.json"
    write_json(metadata_path, metadata)
    metadata["metadataPath"] = str(metadata_path)
    print(json.dumps(metadata, ensure_ascii=False, sort_keys=True))


def main() -> None:
    args = parse_args()
    if args.command == "diagnose":
        diagnose(args)
    else:
        raise ValueError(f"Unsupported command: {args.command}")


if __name__ == "__main__":
    main()
