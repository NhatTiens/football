import { prisma, type InputJsonValue } from '@football-ai/database';

import { deterministicHash } from './scientific-evaluation-contract.js';
import { assessBestBetCandidate } from './scientific-best-bet-policy-contract.js';
import { apiFootballGet } from './api-football-client.js';
import { normalizeApiFootballFixtures } from './api-football-contract.js';
import {
  SCIENTIFIC_PAPER_BET_LEDGER_VERSION,
  decidePaperBet,
  settlePaperBetSelection,
  type PaperBetDecisionInput,
} from './paper-bet-ledger-core.js';

function jsonValue(value: unknown): InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as InputJsonValue;
}

function selectedInput(
  input: PaperBetDecisionInput,
  selected: {
    market: string;
    selection: string;
    lineValue: number | null;
    decimalOdds: number;
    modelProbability: number;
    fairMarketProbability: number;
  } | null,
) {
  if (!selected) {
    return null;
  }

  return (
    input.candidates.find((candidate) => {
      const normalizedMarket = candidate.marketType.startsWith('TOTAL_GOALS_')
        ? 'TOTAL_GOALS'
        : candidate.marketType;
      const normalizedLine =
        candidate.marketType === 'TOTAL_GOALS_1_5'
          ? 1.5
          : candidate.marketType === 'TOTAL_GOALS_2_5'
            ? 2.5
            : candidate.marketType === 'TOTAL_GOALS_3_5'
              ? 3.5
              : candidate.lineValue;

      return (
        normalizedMarket === selected.market &&
        candidate.selection === selected.selection &&
        normalizedLine === selected.lineValue &&
        Math.abs(candidate.decimalOdds - selected.decimalOdds) < 1e-12 &&
        Math.abs(candidate.modelProbability - selected.modelProbability) < 1e-12 &&
        Math.abs(candidate.fairMarketProbability - selected.fairMarketProbability) < 1e-12
      );
    }) ?? null
  );
}

export async function recordScientificPaperBetDecision(input: PaperBetDecisionInput): Promise<{
  ledgerVersion: string;
  decisionId: number;
  decisionType: 'BEST_BET' | 'NO_BET';
  candidateCount: number;
  rejectedCandidateCount: number;
  decisionHash: string;
}> {
  const { normalizedCandidates, decision } = decidePaperBet(input);
  const assessments = normalizedCandidates.map((candidate) => ({
    normalized: candidate,
    assessment: assessBestBetCandidate(candidate.scientificCandidate),
  }));
  const rejectedCandidateCount = assessments.filter((row) => !row.assessment.eligible).length;
  const selected = decision.decision === 'BEST_BET' ? decision.selected : null;
  const selectedOriginal = selectedInput(input, selected);

  if (selected != null && selectedOriginal == null) {
    throw new Error('Unable to resolve selected paper-bet candidate back to its odds source.');
  }

  const decisionPayload = {
    ledgerVersion: SCIENTIFIC_PAPER_BET_LEDGER_VERSION,
    providerFixtureId: input.providerFixtureId,
    localFixtureId: input.localFixtureId ?? null,
    horizonMinutes: input.horizonMinutes,
    decisionAsOf: input.decisionAsOf.toISOString(),
    kickoffAt: input.kickoffAt.toISOString(),
    modelVersion: input.modelVersion,
    policyVersion: input.policyVersion,
    decision,
    candidates: assessments.map((row) => ({
      input: row.normalized.input,
      scientificCandidate: row.normalized.scientificCandidate,
      assessment: row.assessment,
    })),
    paperOnly: true,
    realMoneyExecution: false,
  };
  const decisionHash = deterministicHash('SCIENTIFIC_PAPER_BET_DECISION', decisionPayload);

  const existing = await prisma.scientificPaperBetDecision.findUnique({
    where: {
      decisionHash,
    },
    select: {
      id: true,
      decisionType: true,
      candidateCount: true,
      rejectedCandidateCount: true,
    },
  });

  if (existing) {
    return {
      ledgerVersion: SCIENTIFIC_PAPER_BET_LEDGER_VERSION,
      decisionId: existing.id,
      decisionType: existing.decisionType as 'BEST_BET' | 'NO_BET',
      candidateCount: existing.candidateCount,
      rejectedCandidateCount: existing.rejectedCandidateCount,
      decisionHash,
    };
  }

  const impliedProbability = selectedOriginal ? 1 / selectedOriginal.decimalOdds : null;
  const edge = selected?.edge ?? null;
  const expectedValue = selected?.expectedValue ?? null;

  const created = await prisma.$transaction(async (transaction: typeof prisma) => {
    const decisionRow = await transaction.scientificPaperBetDecision.create({
      data: {
        providerFixtureId: input.providerFixtureId,
        localFixtureId: input.localFixtureId ?? null,
        horizonMinutes: input.horizonMinutes,
        decisionAsOf: input.decisionAsOf,
        kickoffAt: input.kickoffAt,
        decisionType: decision.decision,
        selectedMarket: selectedOriginal?.marketType ?? null,
        selectedSelection: selectedOriginal?.selection ?? null,
        lineValue: selected?.lineValue ?? null,
        decimalOdds: selectedOriginal?.decimalOdds ?? null,
        bookmakerId: selectedOriginal?.bookmakerId ?? null,
        bookmakerName: selectedOriginal?.bookmakerName ?? null,
        modelProbability: selected?.modelProbability ?? null,
        fairMarketProbability: selected?.fairMarketProbability ?? null,
        impliedProbability,
        edge,
        expectedValue,
        modelVersion: input.modelVersion,
        policyVersion: input.policyVersion,
        reliabilityStatus: selectedOriginal?.reliabilityStatus ?? null,
        sourceOddsSnapshotId: selectedOriginal?.sourceOddsSnapshotId ?? null,
        sourceOddsUpdatedAt: selectedOriginal?.sourceOddsUpdatedAt ?? null,
        sourceOddsObservedAt: selectedOriginal?.sourceOddsObservedAt ?? null,
        candidateCount: assessments.length,
        rejectedCandidateCount,
        decisionPayload: jsonValue(decisionPayload),
        decisionHash,
      },
    });

    if (assessments.length > 0) {
      await transaction.scientificPaperBetCandidate.createMany({
        data: assessments.map((row, index) => {
          const original = row.normalized.input;
          const scientific = row.normalized.scientificCandidate;
          const assessment = row.assessment;
          const candidatePayload = {
            index,
            original,
            scientific,
            assessment,
          };

          return {
            decisionId: decisionRow.id,
            providerFixtureId: input.providerFixtureId,
            marketType: original.marketType,
            selection: original.selection,
            lineValue: scientific.lineValue,
            decimalOdds: original.decimalOdds,
            bookmakerId: original.bookmakerId,
            bookmakerName: original.bookmakerName,
            modelProbability: original.modelProbability,
            fairMarketProbability: original.fairMarketProbability,
            impliedProbability: 1 / original.decimalOdds,
            edge: scientific.edge,
            expectedValue: scientific.expectedValue,
            reliabilityStatus: original.reliabilityStatus,
            eligible: assessment.eligible,
            rejectionReasons: jsonValue(assessment.rejectionReasons),
            sourceOddsSnapshotId: original.sourceOddsSnapshotId,
            candidatePayload: jsonValue(candidatePayload),
            candidateHash: deterministicHash('SCIENTIFIC_PAPER_BET_CANDIDATE', {
              decisionHash,
              index,
              candidatePayload,
            }),
          };
        }),
        skipDuplicates: true,
      });
    }

    return decisionRow;
  });

  return {
    ledgerVersion: SCIENTIFIC_PAPER_BET_LEDGER_VERSION,
    decisionId: created.id,
    decisionType: decision.decision,
    candidateCount: assessments.length,
    rejectedCandidateCount,
    decisionHash,
  };
}

export async function settleOpenScientificPaperBets(): Promise<{
  ledgerVersion: string;
  considered: number;
  settled: number;
  skippedNotFinal: number;
  skippedNoFulltimeScore: number;
}> {
  const decisions = await prisma.scientificPaperBetDecision.findMany({
    where: {
      decisionType: 'BEST_BET',
      settlement: null,
    },
    orderBy: {
      kickoffAt: 'asc',
    },
    take: 100,
  });

  let settled = 0;
  let skippedNotFinal = 0;
  let skippedNoFulltimeScore = 0;

  for (const decision of decisions) {
    const request = await apiFootballGet('/fixtures', {
      id: decision.providerFixtureId,
      timezone: 'UTC',
    });
    const fixtures = normalizeApiFootballFixtures(request.payload);
    const fixture = fixtures[0];

    if (!fixture) {
      skippedNotFinal += 1;
      continue;
    }

    if (!['FT', 'AET', 'PEN'].includes(fixture.statusShort)) {
      skippedNotFinal += 1;
      continue;
    }

    if (fixture.fulltimeHomeGoals == null || fixture.fulltimeAwayGoals == null) {
      skippedNoFulltimeScore += 1;
      continue;
    }

    if (
      decision.selectedMarket == null ||
      decision.selectedSelection == null ||
      decision.decimalOdds == null
    ) {
      throw new Error(`BEST_BET decision ${decision.id} is missing selected bet fields.`);
    }

    const settlement = settlePaperBetSelection({
      marketType: decision.selectedMarket,
      selection: decision.selectedSelection,
      lineValue: decision.lineValue,
      homeGoals: fixture.fulltimeHomeGoals,
      awayGoals: fixture.fulltimeAwayGoals,
      decimalOdds: decision.decimalOdds,
      stakeUnits: 1,
    });
    const settlementPayload = {
      ledgerVersion: SCIENTIFIC_PAPER_BET_LEDGER_VERSION,
      decisionId: decision.id,
      providerFixtureId: decision.providerFixtureId,
      fixture,
      settlement,
      sourceObservedAt: request.observedAt.toISOString(),
      closingOdds: null,
      clv: null,
    };
    const settlementHash = deterministicHash('SCIENTIFIC_PAPER_BET_SETTLEMENT', settlementPayload);

    const result = await prisma.scientificPaperBetSettlement.createMany({
      data: [
        {
          decisionId: decision.id,
          providerFixtureId: decision.providerFixtureId,
          settledAt: new Date(),
          sourceFixtureObservedAt: request.observedAt,
          statusShort: fixture.statusShort,
          fulltimeHomeGoals: fixture.fulltimeHomeGoals,
          fulltimeAwayGoals: fixture.fulltimeAwayGoals,
          result: settlement.result,
          stakeUnits: settlement.stakeUnits,
          profitUnits: settlement.profitUnits,
          closingDecimalOdds: null,
          closingFairProbability: null,
          clv: null,
          settlementPayload: jsonValue(settlementPayload),
          settlementHash,
        },
      ],
      skipDuplicates: true,
    });

    settled += result.count;
  }

  return {
    ledgerVersion: SCIENTIFIC_PAPER_BET_LEDGER_VERSION,
    considered: decisions.length,
    settled,
    skippedNotFinal,
    skippedNoFulltimeScore,
  };
}

export async function getScientificPaperBetLedgerCoverage(): Promise<{
  ledgerVersion: string;
  decisions: number;
  bestBets: number;
  noBets: number;
  candidates: number;
  eligibleCandidates: number;
  settlements: number;
  wins: number;
  losses: number;
  totalStakeUnits: number;
  profitUnits: number;
  roi: number | null;
  openBestBets: number;
}> {
  const [
    decisions,
    bestBets,
    noBets,
    candidates,
    eligibleCandidates,
    settlements,
    wins,
    losses,
    stakeAggregate,
    profitAggregate,
  ] = await Promise.all([
    prisma.scientificPaperBetDecision.count(),
    prisma.scientificPaperBetDecision.count({
      where: {
        decisionType: 'BEST_BET',
      },
    }),
    prisma.scientificPaperBetDecision.count({
      where: {
        decisionType: 'NO_BET',
      },
    }),
    prisma.scientificPaperBetCandidate.count(),
    prisma.scientificPaperBetCandidate.count({
      where: {
        eligible: true,
      },
    }),
    prisma.scientificPaperBetSettlement.count(),
    prisma.scientificPaperBetSettlement.count({
      where: {
        result: 'WIN',
      },
    }),
    prisma.scientificPaperBetSettlement.count({
      where: {
        result: 'LOSS',
      },
    }),
    prisma.scientificPaperBetSettlement.aggregate({
      _sum: {
        stakeUnits: true,
      },
    }),
    prisma.scientificPaperBetSettlement.aggregate({
      _sum: {
        profitUnits: true,
      },
    }),
  ]);

  const totalStakeUnits = stakeAggregate._sum.stakeUnits ?? 0;
  const profitUnits = profitAggregate._sum.profitUnits ?? 0;

  return {
    ledgerVersion: SCIENTIFIC_PAPER_BET_LEDGER_VERSION,
    decisions,
    bestBets,
    noBets,
    candidates,
    eligibleCandidates,
    settlements,
    wins,
    losses,
    totalStakeUnits,
    profitUnits,
    roi: totalStakeUnits > 0 ? profitUnits / totalStakeUnits : null,
    openBestBets: bestBets - settlements,
  };
}
