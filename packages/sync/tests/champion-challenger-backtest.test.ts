import { describe, expect, it } from 'vitest';

import {
  maximumDrawdown,
  profitForSettlement,
  settleBenchmarkCandidate,
} from '../src/champion-challenger-backtest-contract.js';
import type { DecisionCandidate } from '../src/multi-horizon-decision-contract.js';

const candidate: DecisionCandidate = {
  marketKey: 'TOTAL_GOALS:2',
  selection: 'OVER',
  line: 2,
  modelProbability: 0.5,
  pushProbability: 0.2,
  conditionalModelProbability: 0.625,
  fairMarketProbability: 0.5,
  odds: 2,
  oddsSnapshotId: 1,
  edge: 0.125,
  expectedValue: 0.2,
  reliability: 0.9,
  uncertainty: 0.1,
  uncertaintyPenalty: 0.1,
  eligible: true,
  reasonCodes: [],
  score: 0.1,
};

describe('Stage 7 champion/challenger backtest contract', () => {
  it('settles integer total pushes as VOID', () => {
    expect(settleBenchmarkCandidate(candidate, 'PUSH')).toBe('VOID');
    expect(profitForSettlement('VOID', 2)).toBe(0);
  });

  it('does not count a total push as a win or loss', () => {
    expect(settleBenchmarkCandidate(candidate, 'ABOVE')).toBe('WIN');
    expect(settleBenchmarkCandidate(candidate, 'BELOW')).toBe('LOSS');
  });

  it('computes peak-to-trough maximum drawdown', () => {
    expect(maximumDrawdown([1, -1, -1, 2, -0.5])).toBeCloseTo(2, 12);
  });
});
