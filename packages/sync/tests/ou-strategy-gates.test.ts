import { describe, expect, it } from 'vitest';
import { OU_STRATEGY_MAX_ODDS, probabilityThresholdForOdds } from '@football-ai/engine';
import {
  assessBestBetCandidate,
  type MarketReliabilityAssessment,
  type ScientificBetCandidate,
} from '../src/scientific-best-bet-policy-contract.js';
import { assessRiskAdjustedCurrentCandidate } from '../src/current-recommendation-risk-ranking.js';

function reliable(market: ScientificBetCandidate['market']): MarketReliabilityAssessment {
  return {
    market,
    status: 'DIAGNOSTIC_ELIGIBLE',
    diagnosticEligible: true,
    model: { rows: 500, classCount: market === 'MATCH_WINNER' ? 3 : 2, accuracy: 0.62, brier: 0.18, logLoss: 0.52, ece: 0.02 },
    climatology: { rows: 500, classCount: market === 'MATCH_WINNER' ? 3 : 2, accuracy: 0.5, brier: 0.25, logLoss: 0.69, classProbabilities: {} },
    relativeBrierSkillVsClimatology: 0.28,
    logLossSkillVsClimatology: 0.24,
    eceWithinLimit: true,
    sufficientRows: true,
    reasons: [],
    evidenceClass: 'HISTORICAL_DIAGNOSTIC_NON_PROMOTIONAL',
    promotional: false,
  };
}

describe('O/U strategy gates', () => {
  it('blocks official O/U bets above 2.50 even when raw value looks positive', () => {
    const modelProbability = 0.55;
    const decimalOdds = 2.51;
    const fairMarketProbability = 0.48;
    const candidate: ScientificBetCandidate = {
      fixtureId: 1,
      market: 'TOTAL_GOALS_2_5',
      selection: 'UNDER',
      lineValue: 2.5,
      modelProbability,
      fairMarketProbability,
      decimalOdds,
      edge: modelProbability - fairMarketProbability,
      expectedValue: modelProbability * decimalOdds - 1,
      reliability: reliable('TOTAL_GOALS_2_5'),
    };
    const assessment = assessBestBetCandidate(candidate);
    expect(assessment.eligible).toBe(false);
    expect(assessment.rejectionReasons).toContain('OU_ODDS_ABOVE_MAXIMUM');
  });

  it('blocks current O/U signals outside odds range and below odds-band probability threshold', () => {
    const probability = 0.54;
    const decimalOdds = 2.30;
    const assessment = assessRiskAdjustedCurrentCandidate({
      marketType: 'TOTAL_GOALS_2_5',
      selection: 'UNDER',
      lineValue: 2.5,
      decimalOdds,
      modelProbability: probability,
      fairMarketProbability: 0.47,
      rawEdge: 0.07,
      rawExpectedValue: probability * decimalOdds - 1,
      reliabilityStatus: 'DIAGNOSTIC_ELIGIBLE',
      modelSource: 'DYNAMIC_DIXON_COLES',
      confidenceTier: 'HIGH',
      historySampleSize: 20,
      dataQualityScore: 0.9,
      minimumOdds: 1.4,
      minimumEdge: 0.04,
      minimumExpectedValue: 0.03,
      maximumOdds: OU_STRATEGY_MAX_ODDS,
      minimumModelProbability: probabilityThresholdForOdds(decimalOdds),
      minimumDataQualityScore: 0.4,
      quoteConsensus: { quoteCount: 5, medianOdds: decimalOdds, agreementRatio: 1, candidateDeviationRatio: 0, candidateIsHighOutlier: false },
    });
    expect(assessment.eligible).toBe(false);
    expect(assessment.rejectionReasons).toContain('CURRENT_MODEL_PROBABILITY_BELOW_MINIMUM');
  });

  it('does not apply the O/U maximum odds gate to non-O/U candidates when no maximum is supplied', () => {
    const assessment = assessRiskAdjustedCurrentCandidate({
      marketType: 'MATCH_WINNER', selection: 'HOME', lineValue: null, decimalOdds: 2.8,
      modelProbability: 0.6, fairMarketProbability: 0.45, rawEdge: 0.15, rawExpectedValue: 0.68,
      reliabilityStatus: 'DIAGNOSTIC_ELIGIBLE', modelSource: 'DYNAMIC_DIXON_COLES', confidenceTier: 'HIGH',
      historySampleSize: 20, dataQualityScore: 0.9, minimumOdds: 1.4, minimumEdge: 0.04, minimumExpectedValue: 0.03,
      quoteConsensus: { quoteCount: 5, medianOdds: 2.8, agreementRatio: 1, candidateDeviationRatio: 0, candidateIsHighOutlier: false },
    });
    expect(assessment.rejectionReasons).not.toContain('CURRENT_ODDS_ABOVE_MAXIMUM');
  });
});

it('allows an official O/U candidate inside the strategy band when reliability and value gates pass', () => {
  const modelProbability = 0.65;
  const decimalOdds = 1.8;
  const fairMarketProbability = 0.55;
  const candidate: ScientificBetCandidate = {
    fixtureId: 4,
    market: 'TOTAL_GOALS_2_5',
    selection: 'UNDER',
    lineValue: 2.5,
    modelProbability,
    fairMarketProbability,
    decimalOdds,
    edge: modelProbability - fairMarketProbability,
    expectedValue: modelProbability * decimalOdds - 1,
    reliability: reliable('TOTAL_GOALS_2_5'),
  };
  const assessment = assessBestBetCandidate(candidate);
  expect(assessment.eligible).toBe(true);
  expect(assessment.rejectionReasons).toEqual([]);
});
