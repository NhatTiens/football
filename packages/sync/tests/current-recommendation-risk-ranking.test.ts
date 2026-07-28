import {
  assessRiskAdjustedCurrentCandidate,
  buildCurrentQuoteConsensusMap,
  compareRiskAdjustedCurrentCandidates,
  resolveCurrentQuoteConsensus,
} from '../src/current-recommendation-risk-ranking.js';

describe('R4.10.2.6 current recommendation risk ranking', () => {
  it('blocks a high-odds zero-history baseline fallback despite positive raw EV', () => {
    const groupedOdds = buildCurrentQuoteConsensusMap([
      { marketType: 'MATCH_WINNER', selection: 'AWAY', lineValue: null, decimalOdds: 7.5 },
      { marketType: 'MATCH_WINNER', selection: 'AWAY', lineValue: null, decimalOdds: 8 },
      { marketType: 'MATCH_WINNER', selection: 'AWAY', lineValue: null, decimalOdds: 7.8 },
    ]);
    const quote = { marketType: 'MATCH_WINNER', selection: 'AWAY', lineValue: null, decimalOdds: 8 };
    const assessment = assessRiskAdjustedCurrentCandidate({
      ...quote,
      modelProbability: 0.3334,
      fairMarketProbability: 0.1277,
      rawEdge: 0.2057,
      rawExpectedValue: 1.667,
      reliabilityStatus: 'HORIZON_NOT_VALIDATED:DIAGNOSTIC_ELIGIBLE',
      modelSource: 'SCIENTIFIC_BASELINE_FALLBACK',
      confidenceTier: 'LIMITED',
      historySampleSize: 0,
      dataQualityScore: 0.4,
      minimumOdds: 1.4,
      minimumEdge: 0.04,
      minimumExpectedValue: 0.03,
      quoteConsensus: resolveCurrentQuoteConsensus({ groupedOdds, quote }),
    });
    expect(assessment.eligible).toBe(false);
    expect(assessment.signalTier).toBe('LOW_CONFIDENCE_DIAGNOSTIC');
    expect(assessment.conservativeExpectedValue).toBeLessThan(1.667);
    expect(assessment.rejectionReasons).toContain('CURRENT_BASELINE_FALLBACK_RESEARCH_ONLY');
    expect(assessment.rejectionReasons).toContain('CURRENT_LIMITED_CONFIDENCE_LONGSHOT_BLOCKED');
  });

  it('allows a validated high-confidence dynamic candidate when conservative value remains positive', () => {
    const quote = { marketType: 'MATCH_WINNER', selection: 'HOME', lineValue: null, decimalOdds: 2.1 };
    const groupedOdds = buildCurrentQuoteConsensusMap([
      quote,
      { ...quote, decimalOdds: 2.05 },
      { ...quote, decimalOdds: 2.08 },
      { ...quote, decimalOdds: 2.12 },
    ]);
    const assessment = assessRiskAdjustedCurrentCandidate({
      ...quote,
      modelProbability: 0.6,
      fairMarketProbability: 0.5,
      rawEdge: 0.1,
      rawExpectedValue: 0.26,
      reliabilityStatus: 'PROVEN_SKILL',
      modelSource: 'DYNAMIC_DIXON_COLES',
      confidenceTier: 'HIGH',
      historySampleSize: 20,
      dataQualityScore: 0.8,
      minimumOdds: 1.4,
      minimumEdge: 0.04,
      minimumExpectedValue: 0.03,
      quoteConsensus: resolveCurrentQuoteConsensus({ groupedOdds, quote }),
    });
    expect(assessment.eligible).toBe(true);
    expect(assessment.signalTier).toBe('RISK_ADJUSTED_RESEARCH');
    expect(assessment.conservativeExpectedValue).toBeGreaterThanOrEqual(0.03);
  });

  it('rejects a bookmaker quote materially above a three-bookmaker consensus', () => {
    const quote = { marketType: 'BTTS', selection: 'YES', lineValue: null, decimalOdds: 3 };
    const groupedOdds = buildCurrentQuoteConsensusMap([
      { ...quote, decimalOdds: 2 },
      { ...quote, decimalOdds: 2.02 },
      quote,
    ]);
    const consensus = resolveCurrentQuoteConsensus({ groupedOdds, quote });
    expect(consensus.candidateIsHighOutlier).toBe(true);
    const assessment = assessRiskAdjustedCurrentCandidate({
      ...quote,
      modelProbability: 0.5,
      fairMarketProbability: 0.42,
      rawEdge: 0.08,
      rawExpectedValue: 0.5,
      reliabilityStatus: 'PROVEN_SKILL',
      modelSource: 'DYNAMIC_DIXON_COLES',
      confidenceTier: 'HIGH',
      historySampleSize: 20,
      dataQualityScore: 0.8,
      minimumOdds: 1.4,
      minimumEdge: 0.04,
      minimumExpectedValue: 0.03,
      quoteConsensus: consensus,
    });
    expect(assessment.eligible).toBe(false);
    expect(assessment.rejectionReasons).toContain('CURRENT_BOOKMAKER_QUOTE_HIGH_OUTLIER');
  });

  it('ranks by risk-adjusted score instead of raw high-odds EV', () => {
    const safer = {
      currentSignalEligible: true,
      riskAdjustedScore: 0.18,
      conservativeExpectedValue: 0.12,
      conservativeEdge: 0.06,
      quoteAgreementRatio: 1,
      adjustedModelProbability: 0.56,
      decimalOdds: 2,
      marketType: 'MATCH_WINNER',
      selection: 'HOME',
    };
    const longshot = {
      currentSignalEligible: false,
      riskAdjustedScore: -0.4,
      conservativeExpectedValue: -0.2,
      conservativeEdge: -0.03,
      quoteAgreementRatio: 0.33,
      adjustedModelProbability: 0.14,
      decimalOdds: 8,
      marketType: 'MATCH_WINNER',
      selection: 'AWAY',
    };
    expect([longshot, safer].sort(compareRiskAdjustedCurrentCandidates)[0]).toBe(safer);
  });

  it('uses the median quote and agreement ratio for consensus', () => {
    const quote = { marketType: 'TOTAL_GOALS_2_5', selection: 'OVER', lineValue: 2.5, decimalOdds: 1.95 };
    const groupedOdds = buildCurrentQuoteConsensusMap([
      { ...quote, decimalOdds: 1.9 }, quote, { ...quote, decimalOdds: 2 },
    ]);
    const consensus = resolveCurrentQuoteConsensus({ groupedOdds, quote });
    expect(consensus.medianOdds).toBe(1.95);
    expect(consensus.agreementRatio).toBe(1);
  });
});
