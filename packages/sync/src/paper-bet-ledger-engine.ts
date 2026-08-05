import { prisma, type InputJsonValue } from '@football-ai/database';

import { deterministicHash } from './scientific-evaluation-contract.js';
import { assessBestBetCandidate } from './scientific-best-bet-policy-contract.js';
import { syncApiFootballFixturesByIds } from './api-football-provider-engine.js';
import {
  SCIENTIFIC_PAPER_BET_LEDGER_VERSION,
  decidePaperBet,
  settlePaperBetSelection,
  type PaperBetDecisionInput,
} from './paper-bet-ledger-core.js';

function jsonValue(value: unknown): InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as InputJsonValue;
}

type UnknownRecord = Record<string, unknown>;

function unknownRecord(value: unknown): UnknownRecord | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function isTrackedPaperShadowRecommendation(payload: unknown): boolean {
  const root = unknownRecord(payload);
  const analysis = unknownRecord(root?.analysis);
  const decision = unknownRecord(
    root?.paperShadowRecommendation ?? analysis?.paperShadowRecommendation,
  );
  const selected = unknownRecord(decision?.selected);
  const policy = unknownRecord(decision?.policy);

  return (
    decision != null &&
    selected != null &&
    selected.paperTrackEligible === true &&
    selected.stakeEligible === false &&
    policy?.paperOnly === true &&
    decision.pitSafe === true &&
    decision.automaticPromotion === false &&
    decision.automaticBetPlacement === false &&
    decision.realMoneyExecution === false
  );
}

function boundedPositiveInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(value)));
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
        candidate.lineValue ??
        (candidate.marketType === 'TOTAL_GOALS_1_5'
          ? 1.5
          : candidate.marketType === 'TOTAL_GOALS_2_5'
            ? 2.5
            : candidate.marketType === 'TOTAL_GOALS_3_5'
              ? 3.5
              : null);
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

export async function settleOpenScientificPaperBets(input: {
  now?: Date;
  minimumMinutesAfterKickoff?: number;
  shadowLookbackDays?: number;
  maximumDecisions?: number;
  maximumShadowSnapshots?: number;
  maximumFixtureFetches?: number;
} = {}): Promise<{
  ledgerVersion: string;
  considered: number;
  shadowCandidates: number;
  fixtureCandidates: number;
  fixtureFetchCount: number;
  requestCount: number;
  insertedFixtureSnapshots: number;
  settled: number;
  skippedNotFinal: number;
  skippedNoFulltimeScore: number;
}> {
  const now = input.now ?? new Date();
  const minimumMinutesAfterKickoff = boundedPositiveInteger(
    input.minimumMinutesAfterKickoff,
    105,
    360,
  );
  const shadowLookbackDays = boundedPositiveInteger(input.shadowLookbackDays, 365, 730);
  const maximumDecisions = boundedPositiveInteger(input.maximumDecisions, 500, 5000);
  const maximumShadowSnapshots = boundedPositiveInteger(
    input.maximumShadowSnapshots,
    5000,
    20_000,
  );
  const maximumFixtureFetches = boundedPositiveInteger(input.maximumFixtureFetches, 80, 500);
  const resultDueBefore = new Date(now.getTime() - minimumMinutesAfterKickoff * 60_000);
  const shadowSince = new Date(now.getTime() - shadowLookbackDays * 86_400_000);

  const [decisions, shadowSnapshots] = await Promise.all([
    prisma.scientificPaperBetDecision.findMany({
      where: {
        decisionType: 'BEST_BET',
        settlement: null,
        kickoffAt: { lte: resultDueBefore },
      },
      orderBy: {
        kickoffAt: 'asc',
      },
      take: maximumDecisions,
    }),
    prisma.scientificCurrentSignalSnapshot.findMany({
      where: {
        kickoffAt: { lte: resultDueBefore },
        createdAt: { gte: shadowSince, lte: now },
      },
      select: {
        providerFixtureId: true,
        analysisPayload: true,
      },
      orderBy: [{ kickoffAt: 'asc' }, { id: 'asc' }],
      take: maximumShadowSnapshots,
    }),
  ]);

  const decisionFixtureIds: number[] = [
    ...new Set<number>(
      decisions.map((row: { providerFixtureId: number }) => row.providerFixtureId),
    ),
  ];
  const shadowFixtureIds: number[] = [
    ...new Set<number>(
      shadowSnapshots
        .filter((row: { analysisPayload: unknown; providerFixtureId: number }) =>
          isTrackedPaperShadowRecommendation(row.analysisPayload),
        )
        .map(
          (row: { analysisPayload: unknown; providerFixtureId: number }) =>
            row.providerFixtureId,
        ),
    ),
  ];
  const fixtureCandidates: number[] = [
    ...new Set<number>([...decisionFixtureIds, ...shadowFixtureIds]),
  ];

  const terminalStatuses = ['FT', 'AET', 'PEN', 'CANC', 'ABD', 'AWD', 'WO'];
  const existingTerminalRows =
    fixtureCandidates.length === 0
      ? []
      : await prisma.apiFootballFixtureSnapshot.findMany({
          where: {
            providerFixtureId: { in: fixtureCandidates },
            statusShort: { in: terminalStatuses },
          },
          select: {
            providerFixtureId: true,
          },
          orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
          take: Math.min(20_000, fixtureCandidates.length * 12),
        });
  const alreadyTerminal = new Set<number>(
    existingTerminalRows.map(
      (row: { providerFixtureId: number }) => row.providerFixtureId,
    ),
  );
  const fixtureIdsToFetch: number[] = fixtureCandidates
    .filter((providerFixtureId: number) => !alreadyTerminal.has(providerFixtureId))
    .slice(0, maximumFixtureFetches);

  const fixtureSync =
    fixtureIdsToFetch.length === 0
      ? { requestCount: 0, inserted: 0 }
      : await syncApiFootballFixturesByIds(fixtureIdsToFetch);

  const outcomeRows =
    decisionFixtureIds.length === 0
      ? []
      : await prisma.apiFootballFixtureSnapshot.findMany({
          where: {
            providerFixtureId: { in: decisionFixtureIds },
          },
          select: {
            id: true,
            providerFixtureId: true,
            statusShort: true,
            fulltimeHomeGoals: true,
            fulltimeAwayGoals: true,
            observedAt: true,
          },
          orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
          take: Math.min(20_000, decisionFixtureIds.length * 12),
        });
  const latestOutcomeByFixture = new Map<number, (typeof outcomeRows)[number]>();
  for (const outcome of outcomeRows) {
    if (!latestOutcomeByFixture.has(outcome.providerFixtureId)) {
      latestOutcomeByFixture.set(outcome.providerFixtureId, outcome);
    }
  }

  let settled = 0;
  let skippedNotFinal = 0;
  let skippedNoFulltimeScore = 0;

  for (const decision of decisions) {
    const fixture = latestOutcomeByFixture.get(decision.providerFixtureId);
    if (fixture == null || !['FT', 'AET', 'PEN'].includes(fixture.statusShort.toUpperCase())) {
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
      fixture: {
        sourceFixtureSnapshotId: fixture.id,
        statusShort: fixture.statusShort,
        fulltimeHomeGoals: fixture.fulltimeHomeGoals,
        fulltimeAwayGoals: fixture.fulltimeAwayGoals,
      },
      settlement,
      sourceObservedAt: fixture.observedAt.toISOString(),
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
          sourceFixtureObservedAt: fixture.observedAt,
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
    shadowCandidates: shadowFixtureIds.length,
    fixtureCandidates: fixtureCandidates.length,
    fixtureFetchCount: fixtureIdsToFetch.length,
    requestCount: fixtureSync.requestCount,
    insertedFixtureSnapshots: fixtureSync.inserted,
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
