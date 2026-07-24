#!/usr/bin/env python3
"""Offline CatBoost training and inference for Football AI v7.0-alpha.6."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from catboost import CatBoostClassifier, CatBoostRegressor

MODEL_KEY = "CATBOOST_FUNDAMENTALS_MARKET_RESIDUAL_V1"
MODEL_BASE_VERSION = "v7.0-alpha.6-catboost-market-residual-v1"
EXPECTED_CLASSES = [0, 1, 2]
EPSILON = 1e-12


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    train = subparsers.add_parser("train")
    train.add_argument("--input", required=True)
    train.add_argument("--output-dir", required=True)
    train.add_argument("--validation-fraction", type=float, default=0.2)
    train.add_argument("--iterations", type=int, default=450)
    train.add_argument("--depth", type=int, default=6)
    train.add_argument("--learning-rate", type=float, default=0.035)
    train.add_argument("--l2-leaf-reg", type=float, default=5.0)
    train.add_argument("--random-seed", type=int, default=20260723)
    train.add_argument("--early-stopping-rounds", type=int, default=70)

    predict = subparsers.add_parser("predict")
    predict.add_argument("--input", required=True)
    predict.add_argument("--model-dir", required=True)
    predict.add_argument("--output", required=True)
    predict.add_argument(
        "--role",
        choices=["VALIDATION", "FUTURE", "ALL"],
        default="VALIDATION",
    )
    predict.add_argument("--catboost-weight", type=float, default=0.6)
    predict.add_argument("--residual-strength", type=float, default=1.0)

    return parser.parse_args()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            value = line.strip()
            if not value:
                continue
            try:
                row = json.loads(value)
            except json.JSONDecodeError as exc:
                raise ValueError(
                    f"Invalid JSONL at line {line_number}: {exc}"
                ) from exc
            rows.append(row)
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


def iso(value: str) -> datetime:
    normalized = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, float(value)))


def normalize(values: Iterable[float]) -> list[float]:
    array = np.maximum(np.asarray(list(values), dtype=float), 0.0)
    total = float(array.sum())
    if total <= EPSILON:
        return [1.0 / len(array)] * len(array)
    return [float(value / total) for value in array]


def binary_log_loss(labels: np.ndarray, probabilities: np.ndarray) -> float:
    p = np.clip(probabilities.astype(float), 1e-9, 1 - 1e-9)
    y = labels.astype(float)
    return float(np.mean(-(y * np.log(p) + (1 - y) * np.log(1 - p))))


def binary_brier(labels: np.ndarray, probabilities: np.ndarray) -> float:
    return float(np.mean((probabilities.astype(float) - labels.astype(float)) ** 2))


def multiclass_log_loss(labels: np.ndarray, probabilities: np.ndarray) -> float:
    clipped = np.clip(probabilities.astype(float), 1e-9, 1.0)
    clipped = clipped / clipped.sum(axis=1, keepdims=True)
    indexes = np.arange(labels.shape[0])
    return float(np.mean(-np.log(clipped[indexes, labels.astype(int)])))


def multiclass_brier(labels: np.ndarray, probabilities: np.ndarray) -> float:
    one_hot = np.eye(3, dtype=float)[labels.astype(int)]
    return float(np.mean(np.sum((probabilities.astype(float) - one_hot) ** 2, axis=1)))


def model_file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def dataset_fingerprint(rows: list[dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    for row in sorted(
        rows,
        key=lambda item: (
            str(item["kickoffAt"]),
            int(item["fixtureId"]),
            int(item["horizonMinutes"]),
        ),
    ):
        digest.update(
            json.dumps(
                {
                    "fixtureId": row["fixtureId"],
                    "predictionAsOf": row["predictionAsOf"],
                    "horizonMinutes": row["horizonMinutes"],
                    "featureContractHash": row["featureContractHash"],
                    "payloadHash": row["payloadHash"],
                },
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        )
        digest.update(b"\n")
    return digest.hexdigest()


def validate_rows(rows: list[dict[str, Any]]) -> tuple[list[str], str]:
    if not rows:
        raise ValueError("ML training dataset is empty.")

    feature_names = list(rows[0]["featureNames"])
    feature_contract_hash = str(rows[0]["featureContractHash"])
    width = len(feature_names)

    if width == 0:
        raise ValueError("Feature contract is empty.")

    for row in rows:
        if list(row["featureNames"]) != feature_names:
            raise ValueError("Feature-name contract changed inside one dataset.")
        if str(row["featureContractHash"]) != feature_contract_hash:
            raise ValueError("Feature-contract hash changed inside one dataset.")
        iso(str(row["predictionAsOf"]))
        iso(str(row["kickoffAt"]))
        iso(str(row["labelAvailableAt"]))
        vector = row["featureVector"]
        if len(vector) != width:
            raise ValueError(
                f"Feature width mismatch for fixture {row['fixtureId']}: "
                f"{len(vector)} != {width}"
            )
        if not all(math.isfinite(float(value)) for value in vector):
            raise ValueError(
                f"Non-finite feature for fixture {row['fixtureId']}."
            )

    return feature_names, feature_contract_hash


def fixture_split(
    rows: list[dict[str, Any]],
    validation_fraction: float,
) -> tuple[list[int], list[int]]:
    fixture_kickoffs: dict[int, datetime] = {}
    fixture_prediction_as_of: dict[int, datetime] = {}
    fixture_label_available_at: dict[int, datetime] = {}

    for row in rows:
        fixture_id = int(row["fixtureId"])
        kickoff = iso(str(row["kickoffAt"]))
        prediction_as_of = iso(str(row["predictionAsOf"]))
        label_available_at = iso(str(row["labelAvailableAt"]))

        existing_kickoff = fixture_kickoffs.get(fixture_id)
        if existing_kickoff is None or kickoff < existing_kickoff:
            fixture_kickoffs[fixture_id] = kickoff

        existing_prediction = fixture_prediction_as_of.get(fixture_id)
        if (
            existing_prediction is None
            or prediction_as_of < existing_prediction
        ):
            fixture_prediction_as_of[fixture_id] = prediction_as_of

        existing_label = fixture_label_available_at.get(fixture_id)
        if existing_label is None or label_available_at > existing_label:
            fixture_label_available_at[fixture_id] = label_available_at

    ordered = sorted(
        fixture_kickoffs,
        key=lambda fixture_id: (
            fixture_kickoffs[fixture_id],
            fixture_id,
        ),
    )

    if len(ordered) < 28:
        raise ValueError(
            "CatBoost training requires at least 28 unique fixtures "
            "for a temporal train/validation split."
        )

    validation_count = max(
        8,
        int(round(len(ordered) * clamp(validation_fraction, 0.1, 0.35))),
    )
    validation_count = min(validation_count, len(ordered) - 20)

    while True:
        train_ids = ordered[:-validation_count]
        validation_ids = ordered[-validation_count:]

        if len(train_ids) < 20:
            raise ValueError(
                "Could not create a leakage-safe temporal split "
                "while retaining at least 20 training fixtures."
            )

        trained_through = max(
            fixture_label_available_at[fixture_id]
            for fixture_id in train_ids
        )
        validation_from = min(
            fixture_prediction_as_of[fixture_id]
            for fixture_id in validation_ids
        )

        if trained_through < validation_from:
            return train_ids, validation_ids

        validation_count += 1
        if validation_count >= len(ordered):
            raise ValueError(
                "No leakage-safe temporal train/validation boundary exists."
            )


def rows_for_fixtures(
    rows: list[dict[str, Any]],
    fixture_ids: set[int],
) -> list[dict[str, Any]]:
    return [
        row
        for row in rows
        if int(row["fixtureId"]) in fixture_ids
    ]


def matrix(rows: list[dict[str, Any]]) -> np.ndarray:
    return np.asarray(
        [row["featureVector"] for row in rows],
        dtype=np.float32,
    )


def row_weights(rows: list[dict[str, Any]]) -> np.ndarray:
    counts = Counter(int(row["fixtureId"]) for row in rows)
    return np.asarray(
        [1.0 / counts[int(row["fixtureId"])] for row in rows],
        dtype=np.float32,
    )


def classifier_parameters(args: argparse.Namespace, loss_function: str) -> dict[str, Any]:
    return {
        "iterations": max(50, int(args.iterations)),
        "depth": int(clamp(args.depth, 4, 10)),
        "learning_rate": clamp(args.learning_rate, 0.005, 0.2),
        "l2_leaf_reg": clamp(args.l2_leaf_reg, 0.0, 50.0),
        "loss_function": loss_function,
        "random_seed": int(args.random_seed),
        "allow_writing_files": False,
        "verbose": False,
        "thread_count": -1,
        "random_strength": 0.6,
        "border_count": 128,
    }


def fit_classifier(
    model: CatBoostClassifier,
    x_train: np.ndarray,
    y_train: np.ndarray,
    x_validation: np.ndarray,
    y_validation: np.ndarray,
    weights: np.ndarray,
    early_stopping_rounds: int,
) -> CatBoostClassifier:
    model.fit(
        x_train,
        y_train,
        sample_weight=weights,
        eval_set=(x_validation, y_validation),
        use_best_model=True,
        early_stopping_rounds=max(20, int(early_stopping_rounds)),
        verbose=False,
    )
    return model


def model_probabilities(
    model: CatBoostClassifier,
    x: np.ndarray,
    expected_classes: list[int],
) -> np.ndarray:
    raw = np.asarray(model.predict_proba(x), dtype=float)
    model_classes = [int(value) for value in model.classes_]
    output = np.zeros((raw.shape[0], len(expected_classes)), dtype=float)

    for source_index, class_value in enumerate(model_classes):
        if class_value in expected_classes:
            output[:, expected_classes.index(class_value)] = raw[:, source_index]

    totals = output.sum(axis=1, keepdims=True)
    totals[totals <= EPSILON] = 1.0
    return output / totals


def residual_market_probabilities(
    market: list[float],
    residual: list[float],
    strength: float,
) -> list[float]:
    return normalize(
        [
            float(market[index]) + float(residual[index]) * strength
            for index in range(3)
        ]
    )


def train(args: argparse.Namespace) -> None:
    input_path = Path(args.input).resolve()
    output_root = Path(args.output_dir).resolve()
    rows = read_jsonl(input_path)
    feature_names, feature_contract_hash = validate_rows(rows)
    train_fixture_ids, validation_fixture_ids = fixture_split(
        rows,
        args.validation_fraction,
    )
    train_rows = rows_for_fixtures(rows, set(train_fixture_ids))
    validation_rows = rows_for_fixtures(rows, set(validation_fixture_ids))

    x_train = matrix(train_rows)
    x_validation = matrix(validation_rows)
    weights = row_weights(train_rows)

    y_match_train = np.asarray(
        [int(row["labels"]["matchWinner"]) for row in train_rows],
        dtype=np.int64,
    )
    y_match_validation = np.asarray(
        [int(row["labels"]["matchWinner"]) for row in validation_rows],
        dtype=np.int64,
    )
    y_over_train = np.asarray(
        [int(row["labels"]["over25"]) for row in train_rows],
        dtype=np.int64,
    )
    y_over_validation = np.asarray(
        [int(row["labels"]["over25"]) for row in validation_rows],
        dtype=np.int64,
    )
    y_btts_train = np.asarray(
        [int(row["labels"]["btts"]) for row in train_rows],
        dtype=np.int64,
    )
    y_btts_validation = np.asarray(
        [int(row["labels"]["btts"]) for row in validation_rows],
        dtype=np.int64,
    )

    trained_from = min(
        iso(str(row["labelAvailableAt"])) for row in train_rows
    )
    trained_through = max(
        iso(str(row["labelAvailableAt"])) for row in train_rows
    )
    validation_from = min(
        iso(str(row["predictionAsOf"])) for row in validation_rows
    )
    validation_through = max(
        iso(str(row["predictionAsOf"])) for row in validation_rows
    )

    if trained_through >= validation_from:
        raise ValueError(
            "Temporal split leakage: trainedThrough must be earlier than validationFrom."
        )

    fingerprint = dataset_fingerprint(rows)
    version = (
        f"{MODEL_BASE_VERSION}-"
        f"{trained_through.strftime('%Y%m%d')}-"
        f"{fingerprint[:10]}"
    )
    model_dir = output_root / version
    model_dir.mkdir(parents=True, exist_ok=True)

    match_model = fit_classifier(
        CatBoostClassifier(
            **classifier_parameters(args, "MultiClass"),
            auto_class_weights="Balanced",
            eval_metric="MultiClass",
        ),
        x_train,
        y_match_train,
        x_validation,
        y_match_validation,
        weights,
        args.early_stopping_rounds,
    )
    over_model = fit_classifier(
        CatBoostClassifier(
            **classifier_parameters(args, "Logloss"),
            auto_class_weights="Balanced",
            eval_metric="Logloss",
        ),
        x_train,
        y_over_train,
        x_validation,
        y_over_validation,
        weights,
        args.early_stopping_rounds,
    )
    btts_model = fit_classifier(
        CatBoostClassifier(
            **classifier_parameters(args, "Logloss"),
            auto_class_weights="Balanced",
            eval_metric="Logloss",
        ),
        x_train,
        y_btts_train,
        x_validation,
        y_btts_validation,
        weights,
        args.early_stopping_rounds,
    )

    residual_train_rows = [
        row for row in train_rows if row.get("marketConsensus") is not None
    ]
    residual_validation_rows = [
        row for row in validation_rows if row.get("marketConsensus") is not None
    ]
    residual_model: CatBoostRegressor | None = None

    if len({int(row["fixtureId"]) for row in residual_train_rows}) >= 20:
        x_residual_train = matrix(residual_train_rows)
        x_residual_validation = (
            matrix(residual_validation_rows)
            if residual_validation_rows
            else x_residual_train[-min(10, len(x_residual_train)) :]
        )
        target_residual_train = np.asarray(
            [
                np.eye(3, dtype=float)[int(row["labels"]["matchWinner"])]
                - np.asarray(row["marketConsensus"], dtype=float)
                for row in residual_train_rows
            ],
            dtype=np.float32,
        )
        target_residual_validation = (
            np.asarray(
                [
                    np.eye(3, dtype=float)[int(row["labels"]["matchWinner"])]
                    - np.asarray(row["marketConsensus"], dtype=float)
                    for row in residual_validation_rows
                ],
                dtype=np.float32,
            )
            if residual_validation_rows
            else target_residual_train[
                -min(10, len(target_residual_train)) :
            ]
        )
        residual_model = CatBoostRegressor(
            **classifier_parameters(args, "MultiRMSE"),
            eval_metric="MultiRMSE",
        )
        residual_model.fit(
            x_residual_train,
            target_residual_train,
            sample_weight=row_weights(residual_train_rows),
            eval_set=(
                x_residual_validation,
                target_residual_validation,
            ),
            use_best_model=True,
            early_stopping_rounds=max(
                20, int(args.early_stopping_rounds)
            ),
            verbose=False,
        )

    model_files = {
        "matchWinner": model_dir / "match_winner.cbm",
        "over25": model_dir / "over_25.cbm",
        "btts": model_dir / "btts.cbm",
    }
    model_json_files = {
        "matchWinner": model_dir / "match_winner.json",
        "over25": model_dir / "over_25.json",
        "btts": model_dir / "btts.json",
    }

    match_model.save_model(str(model_files["matchWinner"]), format="cbm")
    over_model.save_model(str(model_files["over25"]), format="cbm")
    btts_model.save_model(str(model_files["btts"]), format="cbm")
    match_model.save_model(str(model_json_files["matchWinner"]), format="json")
    over_model.save_model(str(model_json_files["over25"]), format="json")
    btts_model.save_model(str(model_json_files["btts"]), format="json")

    if residual_model is not None:
        model_files["marketResidual"] = model_dir / "market_residual.cbm"
        model_json_files["marketResidual"] = model_dir / "market_residual.json"
        residual_model.save_model(
            str(model_files["marketResidual"]),
            format="cbm",
        )
        residual_model.save_model(
            str(model_json_files["marketResidual"]),
            format="json",
        )

    match_probabilities = model_probabilities(
        match_model,
        x_validation,
        EXPECTED_CLASSES,
    )
    over_probabilities = np.asarray(
        over_model.predict_proba(x_validation),
        dtype=float,
    )[:, 1]
    btts_probabilities = np.asarray(
        btts_model.predict_proba(x_validation),
        dtype=float,
    )[:, 1]

    metrics: dict[str, Any] = {
        "matchWinner": {
            "logLoss": multiclass_log_loss(
                y_match_validation,
                match_probabilities,
            ),
            "brier": multiclass_brier(
                y_match_validation,
                match_probabilities,
            ),
        },
        "over25": {
            "logLoss": binary_log_loss(
                y_over_validation,
                over_probabilities,
            ),
            "brier": binary_brier(
                y_over_validation,
                over_probabilities,
            ),
        },
        "btts": {
            "logLoss": binary_log_loss(
                y_btts_validation,
                btts_probabilities,
            ),
            "brier": binary_brier(
                y_btts_validation,
                btts_probabilities,
            ),
        },
    }

    residual_metrics: dict[str, float | int | None] = {
        "validationRows": len(residual_validation_rows),
        "marketBrier": None,
        "residualMarketBrier": None,
        "finalBlendBrier": None,
    }

    if residual_validation_rows:
        market_matrix = np.asarray(
            [row["marketConsensus"] for row in residual_validation_rows],
            dtype=float,
        )
        labels = np.asarray(
            [int(row["labels"]["matchWinner"]) for row in residual_validation_rows],
            dtype=np.int64,
        )
        residual_metrics["marketBrier"] = multiclass_brier(
            labels,
            market_matrix,
        )

        if residual_model is not None:
            residual_values = np.asarray(
                residual_model.predict(matrix(residual_validation_rows)),
                dtype=float,
            )
            corrected = np.asarray(
                [
                    residual_market_probabilities(
                        market_matrix[index].tolist(),
                        residual_values[index].tolist(),
                        1.0,
                    )
                    for index in range(len(residual_validation_rows))
                ],
                dtype=float,
            )
            row_index_by_key = {
                (
                    int(row["fixtureId"]),
                    int(row["horizonMinutes"]),
                ): index
                for index, row in enumerate(validation_rows)
            }
            final_values: list[list[float]] = []
            for index, row in enumerate(residual_validation_rows):
                cat_index = row_index_by_key[
                    (
                        int(row["fixtureId"]),
                        int(row["horizonMinutes"]),
                    )
                ]
                final_values.append(
                    normalize(
                        match_probabilities[cat_index] * 0.6
                        + corrected[index] * 0.4
                    )
                )
            residual_metrics["residualMarketBrier"] = multiclass_brier(
                labels,
                corrected,
            )
            residual_metrics["finalBlendBrier"] = multiclass_brier(
                labels,
                np.asarray(final_values, dtype=float),
            )

    metrics["marketResidual"] = residual_metrics

    feature_importance_values = match_model.get_feature_importance(
        type="PredictionValuesChange"
    )
    feature_importance = sorted(
        [
            {
                "feature": feature_names[index],
                "importance": float(feature_importance_values[index]),
            }
            for index in range(len(feature_names))
        ],
        key=lambda item: item["importance"],
        reverse=True,
    )

    hashes = {
        key: model_file_sha256(path)
        for key, path in model_files.items()
    }
    hashes.update(
        {
            f"{key}Json": model_file_sha256(path)
            for key, path in model_json_files.items()
        }
    )

    metadata = {
        "modelKey": MODEL_KEY,
        "version": version,
        "status": "CHALLENGER",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "trainedFrom": trained_from.isoformat(),
        "trainedThrough": trained_through.isoformat(),
        "validationFrom": validation_from.isoformat(),
        "validationThrough": validation_through.isoformat(),
        "trainingRows": len(train_rows),
        "trainingFixtures": len(train_fixture_ids),
        "validationRows": len(validation_rows),
        "validationFixtures": len(validation_fixture_ids),
        "validationFixtureIds": validation_fixture_ids,
        "featureNames": feature_names,
        "featureContractHash": feature_contract_hash,
        "datasetFingerprint": fingerprint,
        "modelDirectory": str(model_dir),
        "modelFiles": {
            key: str(path) for key, path in model_files.items()
        },
        "modelJsonFiles": {
            key: str(path) for key, path in model_json_files.items()
        },
        "modelSha256": hashes,
        "metrics": metrics,
        "featureImportance": feature_importance,
        "parameters": {
            "iterations": max(50, int(args.iterations)),
            "depth": int(clamp(args.depth, 4, 10)),
            "learningRate": clamp(args.learning_rate, 0.005, 0.2),
            "l2LeafReg": clamp(args.l2_leaf_reg, 0.0, 50.0),
            "randomSeed": int(args.random_seed),
            "earlyStoppingRounds": max(
                20, int(args.early_stopping_rounds)
            ),
            "validationFraction": clamp(
                args.validation_fraction, 0.1, 0.35
            ),
            "groupedTemporalSplit": True,
            "fixtureWeightNormalization": True,
            "autoClassWeights": "Balanced",
        },
        "catBoostVersion": __import__("catboost").__version__,
        "pythonVersion": sys.version.split()[0],
    }
    metadata_path = model_dir / "metadata.json"
    write_json(metadata_path, metadata)

    result = {
        "metadataPath": str(metadata_path),
        **metadata,
    }
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


def load_models(model_dir: Path) -> tuple[
    dict[str, Any],
    CatBoostClassifier,
    CatBoostClassifier,
    CatBoostClassifier,
    CatBoostRegressor | None,
]:
    metadata = json.loads(
        (model_dir / "metadata.json").read_text(encoding="utf-8")
    )

    match_model = CatBoostClassifier()
    match_model.load_model(
        metadata["modelFiles"]["matchWinner"],
        format="cbm",
    )
    over_model = CatBoostClassifier()
    over_model.load_model(
        metadata["modelFiles"]["over25"],
        format="cbm",
    )
    btts_model = CatBoostClassifier()
    btts_model.load_model(
        metadata["modelFiles"]["btts"],
        format="cbm",
    )

    residual_model: CatBoostRegressor | None = None
    residual_path = metadata["modelFiles"].get("marketResidual")
    if residual_path:
        residual_model = CatBoostRegressor()
        residual_model.load_model(residual_path, format="cbm")

    return metadata, match_model, over_model, btts_model, residual_model


def predict(args: argparse.Namespace) -> None:
    input_path = Path(args.input).resolve()
    model_dir = Path(args.model_dir).resolve()
    output_path = Path(args.output).resolve()
    rows = read_jsonl(input_path)
    feature_names, feature_contract_hash = validate_rows(rows)

    (
        metadata,
        match_model,
        over_model,
        btts_model,
        residual_model,
    ) = load_models(model_dir)

    if list(metadata["featureNames"]) != feature_names:
        raise ValueError("Model feature names do not match dataset.")
    if metadata["featureContractHash"] != feature_contract_hash:
        raise ValueError("Model feature-contract hash does not match dataset.")

    validation_ids = {
        int(value) for value in metadata["validationFixtureIds"]
    }
    trained_through = iso(str(metadata["trainedThrough"]))

    selected: list[dict[str, Any]] = []
    for row in rows:
        fixture_id = int(row["fixtureId"])
        prediction_as_of = iso(str(row["predictionAsOf"]))

        if args.role == "VALIDATION" and fixture_id not in validation_ids:
            continue
        if args.role == "FUTURE" and prediction_as_of <= trained_through:
            continue
        if prediction_as_of <= trained_through:
            continue

        selected.append(row)

    if not selected:
        write_jsonl(output_path, [])
        print(
            json.dumps(
                {
                    "output": str(output_path),
                    "predictions": 0,
                    "role": args.role,
                },
                sort_keys=True,
            )
        )
        return

    x = matrix(selected)
    match_probabilities = model_probabilities(
        match_model,
        x,
        EXPECTED_CLASSES,
    )
    over_probabilities = np.asarray(
        over_model.predict_proba(x),
        dtype=float,
    )[:, 1]
    btts_probabilities = np.asarray(
        btts_model.predict_proba(x),
        dtype=float,
    )[:, 1]
    residual_values = (
        np.asarray(residual_model.predict(x), dtype=float)
        if residual_model is not None
        else None
    )

    output_rows: list[dict[str, Any]] = []

    for index, row in enumerate(selected):
        catboost = normalize(match_probabilities[index])
        market = row.get("marketConsensus")
        residual_market: list[float] | None = None

        if market is not None and residual_values is not None:
            residual_market = residual_market_probabilities(
                [float(value) for value in market],
                residual_values[index].tolist(),
                clamp(args.residual_strength, 0.0, 1.5),
            )

        if residual_market is None:
            final = catboost
        else:
            weight = clamp(args.catboost_weight, 0.0, 1.0)
            final = normalize(
                np.asarray(catboost) * weight
                + np.asarray(residual_market) * (1.0 - weight)
            )

        over = clamp(float(over_probabilities[index]), 1e-6, 1 - 1e-6)
        btts = clamp(float(btts_probabilities[index]), 1e-6, 1 - 1e-6)

        output_rows.append(
            {
                "fixtureId": int(row["fixtureId"]),
                "leagueId": int(row["leagueId"]),
                "predictionAsOf": row["predictionAsOf"],
                "kickoffAt": row["kickoffAt"],
                "horizonMinutes": int(row["horizonMinutes"]),
                "modelKey": metadata["modelKey"],
                "modelVersion": metadata["version"],
                "trainedThrough": metadata["trainedThrough"],
                "role": args.role,
                "marketAvailable": market is not None,
                "catBoost": {
                    "HOME": catboost[0],
                    "DRAW": catboost[1],
                    "AWAY": catboost[2],
                },
                "residualMarket": (
                    {
                        "HOME": residual_market[0],
                        "DRAW": residual_market[1],
                        "AWAY": residual_market[2],
                    }
                    if residual_market is not None
                    else None
                ),
                "final": {
                    "HOME": final[0],
                    "DRAW": final[1],
                    "AWAY": final[2],
                },
                "over25": {
                    "OVER": over,
                    "UNDER": 1.0 - over,
                },
                "btts": {
                    "YES": btts,
                    "NO": 1.0 - btts,
                },
                "featureContractHash": feature_contract_hash,
                "sourceFeaturePayloadHash": row["payloadHash"],
            }
        )

    write_jsonl(output_path, output_rows)
    print(
        json.dumps(
            {
                "output": str(output_path),
                "predictions": len(output_rows),
                "role": args.role,
                "modelVersion": metadata["version"],
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )


def main() -> None:
    args = parse_args()
    if args.command == "train":
        train(args)
    elif args.command == "predict":
        predict(args)
    else:
        raise ValueError(f"Unsupported command: {args.command}")


if __name__ == "__main__":
    main()
