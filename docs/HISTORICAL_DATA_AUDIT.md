# Football AI v7.0-beta.1A.1 — Historical Data Coverage & Timestamp Audit

This stage audits the historical data lineage discovered by beta.1A without
changing any point-in-time rule or fabricating old timestamps.

## Questions answered

1. Where do the historical odds timestamps sit relative to kickoff?
2. How many fixtures have odds genuinely usable at T-90?
3. Is `FixtureTeamMetricSnapshot = 0` equivalent to having no metric signal?
4. Which fundamental snapshots are referenced by the replay features?
5. Are source timestamps point-in-time safe?
6. What historical/live capabilities should the beta.1B provider purchase?

## Important correction to beta.1A interpretation

`teamMetricCoverage = 0` in the beta.1A replay checks raw metrics on the target
fixture at T-90.

For match statistics such as shots, possession and corners, zero target-fixture
prematch coverage can be expected because those statistics describe a played
match.

Alpha.5 fundamentals instead use historical source fixtures and read:

```text
FixtureTeamMetricSnapshot
with fallback to
FixtureTeamMetric
```

Beta.1A.1 therefore audits both tables and traces `TeamFundamentalSnapshot`
lineage instead of treating the empty snapshot table as automatic loss of team
signal.

## Odds timestamp buckets

Every non-live odds row in the replay fixture range is classified as:

```text
PRE_T180
T180_TO_T90
T90_TO_T30
T30_TO_T5
T5_TO_KICKOFF
POST_KICKOFF
```

T-90 usable means exactly:

```text
capturedAt <= kickoffAt - 90 minutes
```

This rule is not weakened.

## Feature lineage

For every beta.1A replay feature, the audit reads the alpha.6 `sourcePayload`:

```text
homeFundamentalSnapshotId
awayFundamentalSnapshotId
dixonSnapshotId

market.available
market.observedFrom
market.observedTo
```

Referenced `TeamFundamentalSnapshot` rows are resolved and checked for:

```text
latestSourceAvailableAt <= predictionAsOf
```

The audit also reports:

```text
metricCoverage10
dataQualityScore
historical source fixture ids
source-fixture metric coverage
```

## Safety

Beta.1A.1 never:

```text
updates OddsSnapshot.capturedAt
updates historical source timestamps
backfills fabricated timestamps
calls a live API
writes ScientificShadowPrediction
promotes a candidate
changes v6.2.3 production routing
```

## Migration 0013

Creates only audit storage:

```text
HistoricalDataAuditRun
HistoricalDataAuditFinding
```

## Commands

```powershell
npm run worker -- historical-data-audit-run
npm run worker -- historical-data-audit-coverage
npm run worker -- historical-data-audit-report
```

Tests:

```powershell
npm run test:historical-data-audit -w @football-ai/sync
```

## Artifacts

A successful audit writes:

```text
artifacts/provider/v7-beta1a1-audit/<audit-version-hash>/
├── audit-summary.json
├── odds-timestamp-distribution.json
├── fixture-odds-coverage.csv
├── feature-lineage.json
└── recommendation.json
```

## Recommendation states

```text
READY_FOR_LIVE_ONLY

REQUIRE_HISTORICAL_BACKFILL_AND_LIVE

REQUIRE_TIMESTAMPED_ODDS_AND_STATS

BLOCKED_BY_PIT_VIOLATIONS
```

The recommendation is diagnostic. It does not purchase, enable or call any API.

## Expected outcome for the current database

The existing beta.1A evidence suggests:

```text
replay predictions = 171
PIT violations = 0
T-90 raw target odds coverage = 0
FixtureTeamMetricSnapshot rows = 0
```

Beta.1A.1 will establish whether the zero odds coverage is due to historical
timestamps being too late and whether team fundamentals still have valid metric
lineage through `FixtureTeamMetric`.
