# Fundamentals Engine — v7.0-alpha.5

Alpha.5 combines two dependent layers:

1. point-in-time team fundamentals;
2. Dynamic Dixon–Coles goal modelling.

It is designed for offline development and historical backfill before the
real-time API provider is replaced.

## Point-in-time contract

A historical match is eligible only when:

```text
fixture.kickoffAt < targetFixture.kickoffAt
resultAvailableAt <= predictionAsOf
fixture.id != targetFixture.id
```

The default result availability lag is 180 minutes. Historical statistics/xG
are used only when their own `capturedAt <= predictionAsOf`; otherwise the
engine safely falls back to the known match result.

## Fundamentals

For each target fixture and team:

- rolling 5, 10 and 20 match form;
- points, goals and expected goals for/against;
- shots, shots on target, possession and corners;
- win/draw/loss, clean sheet, BTTS and over-2.5 rates;
- role-specific home/away form;
- rest days, sample size, metric coverage and data quality;
- latest contributing fixture and availability timestamps;
- append-only payload hash and source fixture list.

## Dynamic Dixon–Coles

The league model uses:

- exponential time decay;
- regularized attack and defence strengths;
- league intercept and home advantage;
- recency-weighted training;
- low-score Dixon–Coles correction (`rho`);
- 1X2, Over/Under 2.5 and BTTS probabilities;
- explicit `trainedFrom` and `trainedThrough` timestamps.

The model never uses a result whose availability time is after
`predictionAsOf`.

## Offline horizons

Default backfill horizons:

```text
T-90
T-30
T-5
```

They are intentionally independent from the live API. The backfill only reads
the local database and writes append-only scientific snapshots.

## Configuration

```text
RESULT_AVAILABILITY_LAG_MINUTES=180
FUNDAMENTALS_HISTORY_FIXTURE_LIMIT=2400
FUNDAMENTALS_BACKFILL_HORIZONS_MINUTES=90,30,5
FUNDAMENTALS_BACKFILL_LIMIT=0
FUNDAMENTALS_BACKFILL_FORCE=false
FUNDAMENTALS_BACKFILL_DATE_FROM=
FUNDAMENTALS_BACKFILL_DATE_TO=
DIXON_COLES_HALF_LIFE_DAYS=240
DIXON_COLES_ITERATIONS=220
DIXON_COLES_LEARNING_RATE=0.012
DIXON_COLES_L2=0.018
DIXON_COLES_MAXIMUM_GOALS=10
FUNDAMENTALS_BLEND_WEIGHT=0.65
```

## Commands

```powershell
npm run test:fundamentals -w @football-ai/sync
npm run worker -- fundamentals-backfill
npm run worker -- fundamentals-coverage
```

The updater and migration do not call the external API.
