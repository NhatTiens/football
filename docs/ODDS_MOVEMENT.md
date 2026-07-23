# Odds Movement Feature Engine — v7.0-alpha.3

Alpha.3 converts append-only `OddsSnapshot` history into point-in-time 1X2
market intelligence.

## Features

- opening fair HOME/DRAW/AWAY probabilities;
- current fair probabilities at `predictionAsOf`;
- opening-to-current movement;
- recent movement over a steam window;
- bookmaker consensus and per-selection dispersion;
- directional bookmaker agreement;
- steam direction and strength;
- late-move flag;
- market data quality;
- stable 18-value feature vector;
- odds provenance in `PointInTimeAudit`.

Every used quote satisfies:

```text
capturedAt <= predictionAsOf
```

Each bookmaker must have a coherent HOME/DRAW/AWAY market. Margin is removed
per bookmaker before the cross-bookmaker median consensus is calculated.

Alpha.3 does not change the dimensions of the existing stored ML artifact.
Instead, market quality and model-vs-market agreement conservatively influence
scientific data quality and confidence. The standalone feature vector is ready
for later CatBoost and OOF stacking.

## Configuration

```text
ODDS_MOVEMENT_MIN_BOOKMAKERS=3
ODDS_MOVEMENT_MAX_QUOTE_SPREAD_MINUTES=15
ODDS_MOVEMENT_STEAM_WINDOW_MINUTES=60
ODDS_MOVEMENT_STEAM_PROBABILITY_THRESHOLD=0.025
ODDS_MOVEMENT_STEAM_AGREEMENT_THRESHOLD=0.70
ODDS_MOVEMENT_MAX_DISPERSION=0.06
ODDS_MOVEMENT_LATE_WINDOW_MINUTES=90
```
