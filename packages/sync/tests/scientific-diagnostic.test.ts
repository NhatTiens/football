import { describe, expect, it } from 'vitest';

import {
  SCIENTIFIC_DEVELOPMENT_POLICY_VERSION,
  SCIENTIFIC_DIAGNOSTIC_VERSION,
  evaluateScientificDevelopmentSafety,
  scientificDiagnosticSeverity,
  type ScientificDevelopmentMetricSet,
} from '../src/scientific-diagnostic-contract.js';

function metrics(
  overrides: Partial<ScientificDevelopmentMetricSet> = {},
): ScientificDevelopmentMetricSet {
  return {
    rows: 40,
    brier: 0.66,
    logLoss: 1.08,
    accuracy: 0.4,
    expectedCalibrationError: 0.08,
    ...overrides,
  };
}

describe('alpha.7.1 diagnostic and improvement contract', () => {
  it('uses stable alpha.7.1 identifiers', () => {
    expect(SCIENTIFIC_DIAGNOSTIC_VERSION).toContain('alpha.7.1');
    expect(SCIENTIFIC_DEVELOPMENT_POLICY_VERSION).toBe('safe-convex-development-v1');
  });

  it('passes an improving safe candidate', () => {
    const result = evaluateScientificDevelopmentSafety({
      candidate: metrics({
        brier: 0.65,
        logLoss: 1.075,
        expectedCalibrationError: 0.07,
      }),
      baseline: metrics(),
    });

    expect(result.passed).toBe(true);
  });

  it('requires a minimum Brier improvement', () => {
    const result = evaluateScientificDevelopmentSafety({
      candidate: metrics({
        brier: 0.659,
      }),
      baseline: metrics(),
    });

    expect(result.gates.minimumBrierImprovement).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('accepts exactly the default Brier threshold', () => {
    const result = evaluateScientificDevelopmentSafety({
      candidate: metrics({
        brier: 0.658,
      }),
      baseline: metrics(),
    });

    expect(result.gates.minimumBrierImprovement).toBe(true);
  });

  it('rejects excessive log-loss regression', () => {
    const result = evaluateScientificDevelopmentSafety({
      candidate: metrics({
        brier: 0.65,
        logLoss: 1.086,
      }),
      baseline: metrics(),
    });

    expect(result.gates.logLossControlled).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('allows small configured log-loss regression', () => {
    const result = evaluateScientificDevelopmentSafety({
      candidate: metrics({
        brier: 0.65,
        logLoss: 1.084,
      }),
      baseline: metrics(),
    });

    expect(result.gates.logLossControlled).toBe(true);
  });

  it('rejects excessive calibration regression', () => {
    const result = evaluateScientificDevelopmentSafety({
      candidate: metrics({
        brier: 0.65,
        expectedCalibrationError: 0.101,
      }),
      baseline: metrics(),
    });

    expect(result.gates.calibrationControlled).toBe(false);
  });

  it('allows calibration improvement', () => {
    const result = evaluateScientificDevelopmentSafety({
      candidate: metrics({
        brier: 0.65,
        expectedCalibrationError: 0.05,
      }),
      baseline: metrics(),
    });

    expect(result.gates.calibrationControlled).toBe(true);
  });

  it('reports Brier improvement delta', () => {
    const result = evaluateScientificDevelopmentSafety({
      candidate: metrics({
        brier: 0.63,
      }),
      baseline: metrics({
        brier: 0.67,
      }),
    });

    expect(result.deltas.brierImprovement).toBeCloseTo(0.04);
  });

  it('reports log-loss change delta', () => {
    const result = evaluateScientificDevelopmentSafety({
      candidate: metrics({
        logLoss: 1.09,
      }),
      baseline: metrics({
        logLoss: 1.08,
      }),
    });

    expect(result.deltas.logLossChange).toBeCloseTo(0.01);
  });

  it('reports ECE change delta', () => {
    const result = evaluateScientificDevelopmentSafety({
      candidate: metrics({
        expectedCalibrationError: 0.07,
      }),
      baseline: metrics({
        expectedCalibrationError: 0.09,
      }),
    });

    expect(result.deltas.eceChange).toBeCloseTo(-0.02);
  });

  it('fails safely when Brier is unavailable', () => {
    const result = evaluateScientificDevelopmentSafety({
      candidate: metrics({
        brier: null,
      }),
      baseline: metrics(),
    });

    expect(result.gates.minimumBrierImprovement).toBe(false);
  });

  it('fails safely when baseline log-loss is unavailable', () => {
    const result = evaluateScientificDevelopmentSafety({
      candidate: metrics(),
      baseline: metrics({
        logLoss: null,
      }),
    });

    expect(result.gates.logLossControlled).toBe(false);
  });

  it('supports stricter custom thresholds', () => {
    const result = evaluateScientificDevelopmentSafety({
      candidate: metrics({
        brier: 0.655,
        logLoss: 1.08,
      }),
      baseline: metrics(),
      minimumBrierImprovement: 0.01,
    });

    expect(result.passed).toBe(false);
  });

  it('classifies low drift', () => {
    expect(scientificDiagnosticSeverity(0.05, 0.1)).toBe('LOW');
  });

  it('classifies moderate PSI drift', () => {
    expect(scientificDiagnosticSeverity(0.15, 0.1)).toBe('MODERATE');
  });

  it('classifies moderate standardized mean drift', () => {
    expect(scientificDiagnosticSeverity(0.02, 0.3)).toBe('MODERATE');
  });

  it('classifies high drift', () => {
    expect(scientificDiagnosticSeverity(0.3, 0.6)).toBe('HIGH');
  });
});
