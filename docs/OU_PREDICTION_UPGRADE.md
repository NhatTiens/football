# PredictionAI O/U Upgrade — Goal Distribution Contract

## Scope

This upgrade makes O/U 1.5, 2.5 and 3.5 a single probabilistic system. It does not replace the existing scientific model, Dixon–Coles, no-vig consensus, reliability reporting, point-in-time guards, CLV settlement or bankroll controls. It makes those components consume one consistent O/U distribution and adds explicit strategy gates and reporting.

## Root cause fixed

The previous fallback recommendation path mixed two probability sources: O/U 2.5 came from the calibrated scientific baseline while O/U 1.5 and 3.5 came from an independent Poisson score grid. Even if each source was individually valid, mixing them could create a non-monotone sequence such as U1.5 > U2.5.

The new contract is:

```
Expected Home Goals + Expected Away Goals
        -> Poisson joint score grid
        -> Dixon-Coles low-score correction
        -> normalized Total Goals PMF
        -> common CDF/logit calibration shift
        -> O/U 1.5, 2.5, 3.5 from the same calibrated CDF
        -> consistency validator
        -> no-vig market comparison
        -> edge / EV
        -> O/U qualification gates
```

The common calibration shift is anchored to the already-calibrated baseline U2.5 probability when the live recommendation engine has it. A single shift is applied to the CDF, so calibration cannot independently reorder U1.5/U2.5/U3.5.

## Invariants

Every official/current O/U probability set must satisfy, within `OU_PROBABILITY_EPSILON`:

- `U1.5 <= U2.5 <= U3.5`
- `O1.5 >= O2.5 >= O3.5`
- `O(line) + U(line) = 1`
- every probability is in `[0, 1]`
- the normalized total-goal PMF sums to `1`

A violated distribution is a `MODEL_CONSISTENCY_ERROR` and is not eligible for recommendation.

## O/U strategy gate

The qualification range is intentionally a strategy layer, not a model layer:

- minimum odds: `1.40`
- maximum odds: `2.50`

The model still computes and may store probabilities outside the range for research/backtesting, but those candidates are not eligible for Best Bet/current signal.

Starting probability bands are versioned as `ou-odds-probability-bands-starting-v1` and are configurable in the current-signal runtime through environment variables:

- `CURRENT_OU_MIN_PROB_140_150`
- `CURRENT_OU_MIN_PROB_150_160`
- `CURRENT_OU_MIN_PROB_160_180`
- `CURRENT_OU_MIN_PROB_180_200`
- `CURRENT_OU_MIN_PROB_200_220`
- `CURRENT_OU_MIN_PROB_220_250`
- `CURRENT_OU_MIN_DATA_QUALITY_SCORE` (default `0.40`)

The defaults are starting points only. They must be changed only from chronological/out-of-sample evidence, not in-sample win rate.

## Existing components deliberately reused

The repository already contains venue-specific fundamentals, 5/10/20-match windows, xG/shots coverage, lineup/injury context, Elo/opponent-strength evidence, Dixon–Coles recency controls, no-vig bookmaker consensus, model reliability gates, closing odds/CLV fields and fractional-Kelly bankroll policies. This upgrade does not create duplicate versions of those systems.

## Market circularity

Current odds remain market evidence. The O/U goal distribution is built from expected goals / fundamentals; current odds are compared only after model probability generation. The no-vig fair probability is therefore preserved as a distinct market probability used for Edge/EV, not used as a replacement for the fundamental goal distribution.

## Backtest and calibration report

Run:

```bash
npm --workspace @football-ai/sync run ou:backtest-report
```

The command reads only settled paper decisions and reports:

- sample size
- win rate
- ROI / yield
- Brier score
- log loss
- expected calibration error
- average expected value
- average CLV
- maximum drawdown
- slices by O/U market
- slices by odds range
- slices by league
- slices by season
- slices by month and quarter
- slices by persisted model version
- composite market × odds × league × season
- calibration report per O/U market

Every reported metric retains `sampleSize`.

## No leakage / immutability

The upgrade does not alter the existing point-in-time training contract. Goal distributions consume the expected-goal values available at `predictionAsOf`. Reports use settled historical decisions; they do not recalculate or overwrite the original pre-kickoff prediction.

## Asian totals

The engine includes settlement/EV primitives for integer, half and quarter Asian totals (`2.0`, `2.25`, `2.75`, `3.0`, etc.) with full win, half win, push, half loss and full loss. These primitives are research-ready but are not automatically promoted into the current Best Bet market list by this patch. Promotion remains a later strategy decision after the standard 1.5/2.5/3.5 pipeline has enough out-of-sample evidence.

## Acceptance commands

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm --workspace @football-ai/sync run ou:backtest-report
```

The deployment patch installer runs `npm run verify` and automatically reverses the source patch if verification fails.


## Official / Best Bet promotion contract

O/U is not promoted merely because the goal distribution is mathematically valid. The paper-decision path must pass all of the following before `BEST_BET` is possible:

1. the O/U probabilities come from one calibrated goal distribution and pass the consistency validator;
2. the historical market reliability report is `DIAGNOSTIC_ELIGIBLE` (sample size, Brier skill, log-loss skill and ECE gates);
3. the fundamentals data-quality score is at least `PAPER_OU_MIN_DATA_QUALITY_SCORE` (default `0.40` on the repository's 0..1 fundamentals scale);
4. the candidate passes the O/U odds range and versioned probability-band policy;
5. Edge and EV are recomputed from the calibrated model probability and no-vig fair market probability and pass the existing policy thresholds.

The current/shadow UI may still retain non-qualified model output for research, but it must label consistency failures as `INVALID_MODEL_CONSISTENCY` and may not present them as an official recommendation.
