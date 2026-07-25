# v7.0-beta.1B.1 — Real-Odds Multi-Market + Automatic Paper-Bet History

## Goal

Turn real API-Football snapshots into automatic, append-only scientific
paper-bet decisions without enabling real-money wagering or changing production
promotion.

Pipeline:

```text
ApiFootballFixtureSnapshot
        +
ApiFootballOddsSnapshot (pitUsable=true)
        ↓
provider fixture -> core Fixture mapping
        ↓
point-in-time scientific feature analysis
        +
Dynamic Dixon-Coles
        ↓
HDA + O/U 1.5 + O/U 2.5 + O/U 3.5 + BTTS
        ↓
latest complete coherent bookmaker states
        ↓
per-bookmaker no-vig probabilities
        ↓
market consensus + best real available odds
        ↓
beta.1A.4 reliability + best-bet policy
        ↓
BEST_BET or NO_BET
        ↓
ScientificPaperBetDecision
ScientificPaperBetCandidate
        ↓
ScientificPaperBetSettlement
```

## Scientific contract

Decision horizons:

```text
T-90
T-30
T-5
```

T-180 is deliberately not accepted by this stage.

Default timing tolerance:

```text
±2 minutes
```

Actual `decisionAsOf` is the real execution time. The engine never fabricates a
theoretical T-90/T-30/T-5 timestamp.

Default maximum source-odds age:

```text
360 minutes
```

Only rows with:

```text
ApiFootballOddsSnapshot.pitUsable = true
```

are allowed.

## Fixture mapping

A provider fixture is used only when it maps to a core fixture and the mapping
passes all checks:

```text
providerFixtureId == Fixture.apiFixtureId
providerLeagueId  == League.apiLeagueId
home provider id  == homeTeam.apiTeamId
away provider id  == awayTeam.apiTeamId
kickoff difference <= 10 minutes
```

Missing/mismatched mappings are skipped and reported. They never generate fake
bets.

## Model composition

### T-90 HDA

Uses the frozen Alpha.8 T-90 candidate when a valid frozen registry exists
before `decisionAsOf`:

```text
production baseline
+
Dynamic Dixon-Coles
+
frozen Alpha.8 weights / shift cap / temperature
```

The actual frozen candidate version is included in
`ScientificPaperBetDecision.modelVersion`.

### T-30 / T-5 HDA

Uses the point-in-time baseline for candidate generation, but the current
reliability contract does not mark these horizons as validated for live best
bet execution. They therefore remain reliability-blocked until evidence is
available.

### O/U and BTTS

Probabilities come from the Dynamic Dixon-Coles score grid:

```text
O/U 1.5
O/U 2.5
O/U 3.5
BTTS
```

They are recorded as candidates when real complete markets exist, but the
existing beta.1A.4 reliability contract continues to block markets without
proven diagnostic skill.

No threshold is weakened to create more bets.

## Real odds / no-vig

The engine does not mix selections from different bookmaker update states.

For each bookmaker and market:

```text
latest complete coherent state
        ↓
normalize 1 / odds
        ↓
no-vig probabilities
```

Then the fair market probability is the average across complete bookmakers.
The candidate price is the best real available odds among those coherent
states.

## Commands

After installation:

### Coverage — DB only

```powershell
npm run paper-bet:live-coverage -w @football-ai/sync
```

### Decide — DB only, no external API request

```powershell
npm run paper-bet:live-decide -w @football-ai/sync
```

### Decide + settle

```powershell
npm run paper-bet:live-cycle -w @football-ai/sync
```

Settlement may call API-Football for final fixture results.

## Environment

Optional:

```text
PAPER_BET_HORIZONS_MINUTES=90,30,5
PAPER_BET_DECISION_TOLERANCE_MINUTES=2
PAPER_BET_MAX_ODDS_AGE_MINUTES=360
```

`PAPER_BET_HORIZONS_MINUTES` accepts only 90,30,5 in beta.1B.1.

## Operational order

A useful live cycle is:

```text
API-Football live capture
        ↓
paper-bet live decide
        ↓
settle completed bets
        ↓
coverage
```

The included `05-one-cycle-with-capture.ps1` performs one explicit cycle. It is
not an uncontrolled scheduler.

The included `04-db-decision-loop.ps1` checks the DB once per minute for due
decision windows. It does not call API-Football and expects provider capture to
be running separately.

## Frontend

No additional FE schema is required for beta.1B.1. The existing:

```text
/bet-history
/scientific
```

pages read the same append-only ledger and will populate as decisions arrive.

## Important interpretation

A run that reports:

```text
UNMAPPED_PROVIDER_FIXTURE_TO_CORE_FIXTURE
NO_PIT_USABLE_REAL_ODDS_AT_DECISION_AS_OF
NO_DIXON_COLES_MODEL_AT_DECISION_AS_OF
NO_COMPLETE_REAL_ODDS_MARKET_FOR_NO_VIG_CONSENSUS
```

is not allowed to manufacture a decision to hide the gap.

That is evidence about data coverage that should be fixed at the ingestion /
mapping / history layer.

## Safety

```text
new Prisma migration             NO
historical decision mutation     NO
fake API data                    NO
fake decision timestamps         NO
synthetic odds                   NO
threshold weakening              NO
real-money execution             NO
production routing change        NO
automatic promotion              NO
alpha.8 fresh-shadow writes      NO
commit / push                    NO
```
