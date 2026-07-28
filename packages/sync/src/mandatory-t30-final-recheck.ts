import { prisma } from '@football-ai/database';
import { runLiveScientificPaperBetDecisions } from './real-odds-paper-bet-engine.js';

interface ProviderFixtureRow {
  providerFixtureId: number;
  kickoffAt: Date;
  homeTeamName: string;
  awayTeamName: string;
  observedAt: Date;
}

interface PaperDecisionRow {
  id: number;
  providerFixtureId: number;
  localFixtureId: number | null;
  horizonMinutes: number;
  decisionAsOf: Date;
  kickoffAt: Date;
  decisionType: string;
  selectedMarket: string | null;
  selectedSelection: string | null;
  lineValue: number | null;
  decimalOdds: number | null;
  modelProbability: number | null;
  fairMarketProbability: number | null;
  impliedProbability: number | null;
  edge: number | null;
  expectedValue: number | null;
  modelVersion: string;
  policyVersion: string;
  reliabilityStatus: string | null;
  sourceOddsSnapshotId: number | null;
  sourceOddsUpdatedAt: Date | null;
  sourceOddsObservedAt: Date | null;
  candidateCount: number;
  rejectedCandidateCount: number;
  decisionHash: string;
  createdAt: Date;
}

interface CandidateRow {
  id: number;
  decisionId: number;
  marketType: string;
  selection: string;
  lineValue: number | null;
  decimalOdds: number;
  bookmakerId: number;
  bookmakerName: string;
  modelProbability: number;
  fairMarketProbability: number;
  impliedProbability: number;
  edge: number;
  expectedValue: number;
  reliabilityStatus: string;
  eligible: boolean;
  rejectionReasons: unknown;
  sourceOddsSnapshotId: number | null;
}

interface OddsTimestampRow {
  sourceUpdatedAt: Date | null;
  observedAt: Date;
}

interface ContextTimestampRow {
  capturedAt: Date;
}

type FinalComparisonStatus =
  | 'FINAL_RECHECK_ONLY'
  | 'FINAL_CONFIRMED'
  | 'FINAL_CHANGED'
  | 'FINAL_REJECTED'
  | 'FINAL_EMERGED'
  | 'FINAL_NO_BET_STABLE';

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const inline = process.argv.find(
    (item: string): boolean => item.startsWith(prefix),
  );

  if (inline != null) {
    return inline.slice(prefix.length);
  }

  const index = process.argv.indexOf(`--${name}`);

  if (index >= 0) {
    return process.argv[index + 1] ?? null;
  }

  return null;
}

function providerFixtureIdFromArgs(): number {
  const raw =
    argValue('fixture') ??
    process.env.FINAL_RECHECK_PROVIDER_FIXTURE_ID ??
    '';

  const value = Number(raw);

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      'Provider fixture id is required. Example: --fixture=1548093',
    );
  }

  return value;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve): void => {
    setTimeout(resolve, milliseconds);
  });
}

function effectiveOddsTime(row: OddsTimestampRow): Date {
  return row.sourceUpdatedAt ?? row.observedAt;
}

function decisionEffectiveOddsTime(
  decision: PaperDecisionRow | null,
): Date | null {
  if (decision == null) {
    return null;
  }

  return (
    decision.sourceOddsUpdatedAt ??
    decision.sourceOddsObservedAt ??
    null
  );
}

function exactMinutesToKickoff(
  kickoffAt: Date,
  now: Date,
): number {
  return (
    kickoffAt.getTime() -
    now.getTime()
  ) / 60_000;
}

function currentFinalHorizon(
  minutesToKickoff: number,
): number {
  if (
    !Number.isFinite(minutesToKickoff) ||
    minutesToKickoff <= 0
  ) {
    throw new Error(
      'Fixture has already started or kickoff time is invalid.',
    );
  }

  if (minutesToKickoff > 30) {
    throw new Error(
      `FINAL_RECHECK_NOT_DUE: ${minutesToKickoff.toFixed(2)} minutes remain; mandatory final recheck starts at <=30 minutes.`,
    );
  }

  return Math.max(
    1,
    Math.min(
      30,
      Math.round(minutesToKickoff),
    ),
  );
}

async function latestProviderFixture(
  providerFixtureId: number,
): Promise<ProviderFixtureRow> {
  const row =
    (await prisma.apiFootballFixtureSnapshot.findFirst({
      where: {
        providerFixtureId,
      },
      select: {
        providerFixtureId: true,
        kickoffAt: true,
        homeTeamName: true,
        awayTeamName: true,
        observedAt: true,
      },
      orderBy: [
        { observedAt: 'desc' },
        { id: 'desc' },
      ],
    })) as ProviderFixtureRow | null;

  if (row == null) {
    throw new Error(
      `Provider fixture ${providerFixtureId} was not found in local snapshots.`,
    );
  }

  return row;
}

async function allFixtureDecisions(
  providerFixtureId: number,
  kickoffAt: Date,
): Promise<PaperDecisionRow[]> {
  const rows =
    (await prisma.scientificPaperBetDecision.findMany({
      where: {
        providerFixtureId,
        kickoffAt,
      },
      select: {
        id: true,
        providerFixtureId: true,
        localFixtureId: true,
        horizonMinutes: true,
        decisionAsOf: true,
        kickoffAt: true,
        decisionType: true,
        selectedMarket: true,
        selectedSelection: true,
        lineValue: true,
        decimalOdds: true,
        modelProbability: true,
        fairMarketProbability: true,
        impliedProbability: true,
        edge: true,
        expectedValue: true,
        modelVersion: true,
        policyVersion: true,
        reliabilityStatus: true,
        sourceOddsSnapshotId: true,
        sourceOddsUpdatedAt: true,
        sourceOddsObservedAt: true,
        candidateCount: true,
        rejectedCandidateCount: true,
        decisionHash: true,
        createdAt: true,
      },
      orderBy: [
        { decisionAsOf: 'asc' },
        { id: 'asc' },
      ],
      take: 500,
    })) as PaperDecisionRow[];

  return rows;
}

function latestEarlierDecision(
  decisions: PaperDecisionRow[],
  finalDecision: PaperDecisionRow | null,
): PaperDecisionRow | null {
  const cutoff =
    finalDecision?.decisionAsOf.getTime() ??
    Number.POSITIVE_INFINITY;

  return (
    decisions
      .filter(
        (row: PaperDecisionRow): boolean =>
          row.decisionAsOf.getTime() <
            cutoff &&
          row.horizonMinutes > 30,
      )
      .sort(
        (
          left: PaperDecisionRow,
          right: PaperDecisionRow,
        ): number =>
          right.decisionAsOf.getTime() -
          left.decisionAsOf.getTime(),
      )[0] ??
    decisions
      .filter(
        (row: PaperDecisionRow): boolean =>
          row.decisionAsOf.getTime() <
          cutoff,
      )
      .sort(
        (
          left: PaperDecisionRow,
          right: PaperDecisionRow,
        ): number =>
          right.decisionAsOf.getTime() -
          left.decisionAsOf.getTime(),
      )[0] ??
    null
  );
}

function latestFinalRecheck(
  decisions: PaperDecisionRow[],
): PaperDecisionRow | null {
  return (
    decisions
      .filter(
        (row: PaperDecisionRow): boolean =>
          row.horizonMinutes <= 30 &&
          row.horizonMinutes >= 1,
      )
      .sort(
        (
          left: PaperDecisionRow,
          right: PaperDecisionRow,
        ): number =>
          right.decisionAsOf.getTime() -
          left.decisionAsOf.getTime(),
      )[0] ?? null
  );
}

function comparisonStatus(
  earlier: PaperDecisionRow | null,
  finalDecision: PaperDecisionRow,
): FinalComparisonStatus {
  if (earlier == null) {
    return 'FINAL_RECHECK_ONLY';
  }

  if (
    earlier.decisionType === 'NO_BET' &&
    finalDecision.decisionType === 'NO_BET'
  ) {
    return 'FINAL_NO_BET_STABLE';
  }

  if (
    earlier.decisionType === 'BEST_BET' &&
    finalDecision.decisionType === 'NO_BET'
  ) {
    return 'FINAL_REJECTED';
  }

  if (
    earlier.decisionType === 'NO_BET' &&
    finalDecision.decisionType === 'BEST_BET'
  ) {
    return 'FINAL_EMERGED';
  }

  if (
    earlier.decisionType === 'BEST_BET' &&
    finalDecision.decisionType === 'BEST_BET' &&
    earlier.selectedMarket ===
      finalDecision.selectedMarket &&
    earlier.selectedSelection ===
      finalDecision.selectedSelection &&
    earlier.lineValue ===
      finalDecision.lineValue
  ) {
    return 'FINAL_CONFIRMED';
  }

  return 'FINAL_CHANGED';
}

function delta(
  finalValue: number | null,
  earlierValue: number | null,
): number | null {
  if (
    finalValue == null ||
    earlierValue == null
  ) {
    return null;
  }

  return Number(
    (finalValue - earlierValue).toFixed(8),
  );
}

async function candidatesForDecision(
  decisionId: number,
): Promise<CandidateRow[]> {
  return (
    await prisma.scientificPaperBetCandidate.findMany({
      where: {
        decisionId,
      },
      select: {
        id: true,
        decisionId: true,
        marketType: true,
        selection: true,
        lineValue: true,
        decimalOdds: true,
        bookmakerId: true,
        bookmakerName: true,
        modelProbability: true,
        fairMarketProbability: true,
        impliedProbability: true,
        edge: true,
        expectedValue: true,
        reliabilityStatus: true,
        eligible: true,
        rejectionReasons: true,
        sourceOddsSnapshotId: true,
      },
      orderBy: [
        { eligible: 'desc' },
        { expectedValue: 'desc' },
        { edge: 'desc' },
        { modelProbability: 'desc' },
      ],
    })
  ) as CandidateRow[];
}

function topCandidate(
  rows: CandidateRow[],
): CandidateRow | null {
  return rows[0] ?? null;
}

async function latestInputFreshness(input: {
  providerFixtureId: number;
  localFixtureId: number | null;
  now: Date;
}): Promise<{
  latestOddsEffectiveAt: string | null;
  latestLineupCapturedAt: string | null;
  latestInjuryCapturedAt: string | null;
}> {
  const [
    latestOddsRaw,
    latestLineupRaw,
    latestInjuryRaw,
  ] = await Promise.all([
    prisma.apiFootballOddsSnapshot.findFirst({
      where: {
        providerFixtureId:
          input.providerFixtureId,
        pitUsable: true,
        observedAt: {
          lte: input.now,
        },
        kickoffAt: {
          gt: input.now,
        },
      },
      select: {
        sourceUpdatedAt: true,
        observedAt: true,
      },
      orderBy: [
        { observedAt: 'desc' },
        { id: 'desc' },
      ],
    }),
    input.localFixtureId == null
      ? Promise.resolve(null)
      : prisma.fixtureLineupSnapshot.findFirst({
          where: {
            fixtureId:
              input.localFixtureId,
            capturedAt: {
              lte: input.now,
            },
          },
          select: {
            capturedAt: true,
          },
          orderBy: {
            capturedAt: 'desc',
          },
        }),
    input.localFixtureId == null
      ? Promise.resolve(null)
      : prisma.fixtureInjurySnapshot.findFirst({
          where: {
            fixtureId:
              input.localFixtureId,
            capturedAt: {
              lte: input.now,
            },
          },
          select: {
            capturedAt: true,
          },
          orderBy: {
            capturedAt: 'desc',
          },
        }),
  ]);

  const latestOdds =
    latestOddsRaw as OddsTimestampRow | null;

  const latestLineup =
    latestLineupRaw as ContextTimestampRow | null;

  const latestInjury =
    latestInjuryRaw as ContextTimestampRow | null;

  return {
    latestOddsEffectiveAt:
      latestOdds == null
        ? null
        : effectiveOddsTime(
            latestOdds,
          ).toISOString(),
    latestLineupCapturedAt:
      latestLineup?.capturedAt.toISOString() ??
      null,
    latestInjuryCapturedAt:
      latestInjury?.capturedAt.toISOString() ??
      null,
  };
}

async function buildEvidence(input: {
  providerFixtureId: number;
  fixture: ProviderFixtureRow;
  now: Date;
}): Promise<unknown> {
  const decisions =
    await allFixtureDecisions(
      input.providerFixtureId,
      input.fixture.kickoffAt,
    );

  const finalDecision =
    latestFinalRecheck(decisions);

  if (finalDecision == null) {
    return {
      finalRecheck:
        null,
      status:
        'NO_FINAL_RECHECK_YET',
      decisionCount:
        decisions.length,
    };
  }

  const earlier =
    latestEarlierDecision(
      decisions,
      finalDecision,
    );

  const [
    finalCandidates,
    earlierCandidates,
    freshness,
  ] = await Promise.all([
    candidatesForDecision(
      finalDecision.id,
    ),
    earlier == null
      ? Promise.resolve(
          [] as CandidateRow[],
        )
      : candidatesForDecision(
          earlier.id,
        ),
    latestInputFreshness({
      providerFixtureId:
        input.providerFixtureId,
      localFixtureId:
        finalDecision.localFixtureId,
      now: input.now,
    }),
  ]);

  const finalTop =
    topCandidate(finalCandidates);

  const earlierTop =
    topCandidate(earlierCandidates);

  const earlierOddsAt =
    decisionEffectiveOddsTime(
      earlier,
    );

  const finalOddsAt =
    decisionEffectiveOddsTime(
      finalDecision,
    );

  return {
    finalRecheck: {
      decision:
        finalDecision,
      topCandidate:
        finalTop,
      candidateCount:
        finalCandidates.length,
      eligibleCandidates:
        finalCandidates.filter(
          (row: CandidateRow): boolean =>
            row.eligible,
        ).length,
      rejectedCandidates:
        finalCandidates.filter(
          (row: CandidateRow): boolean =>
            !row.eligible,
        ).length,
    },
    earlierSnapshot:
      earlier == null
        ? null
        : {
            decision:
              earlier,
            topCandidate:
              earlierTop,
          },
    comparison: {
      status:
        comparisonStatus(
          earlier,
          finalDecision,
        ),
      modelProbabilityDelta:
        delta(
          finalTop?.modelProbability ??
            finalDecision.modelProbability,
          earlierTop?.modelProbability ??
            earlier?.modelProbability ??
            null,
        ),
      fairMarketProbabilityDelta:
        delta(
          finalTop?.fairMarketProbability ??
            finalDecision.fairMarketProbability,
          earlierTop?.fairMarketProbability ??
            earlier?.fairMarketProbability ??
            null,
        ),
      edgeDelta:
        delta(
          finalTop?.edge ??
            finalDecision.edge,
          earlierTop?.edge ??
            earlier?.edge ??
            null,
        ),
      expectedValueDelta:
        delta(
          finalTop?.expectedValue ??
            finalDecision.expectedValue,
          earlierTop?.expectedValue ??
            earlier?.expectedValue ??
            null,
        ),
      previousOddsEffectiveAt:
        earlierOddsAt?.toISOString() ??
        null,
      finalDecisionOddsEffectiveAt:
        finalOddsAt?.toISOString() ??
        null,
      oddsAdvancedSinceEarlierDecision:
        earlierOddsAt != null &&
        finalOddsAt != null
          ? finalOddsAt.getTime() >
            earlierOddsAt.getTime()
          : null,
    },
    latestInputFreshness:
      freshness,
    scientificPolicy: {
      t90ValidatedBestBetGate:
        'PRESERVED',
      finalRecheckHorizon:
        finalDecision.horizonMinutes,
      nonT90BestBetPromotion:
        false,
      finalRecheckInterpretation:
        finalDecision.horizonMinutes === 90
          ? 'T90_VALIDATED_GATE'
          : 'SHADOW_FINAL_RECHECK_UNTIL_T30_RELIABILITY_IS_VALIDATED',
    },
  };
}

async function preview(): Promise<void> {
  const providerFixtureId =
    providerFixtureIdFromArgs();

  const now = new Date();
  const fixture =
    await latestProviderFixture(
      providerFixtureId,
    );

  const minutes =
    exactMinutesToKickoff(
      fixture.kickoffAt,
      now,
    );

  const decisions =
    await allFixtureDecisions(
      providerFixtureId,
      fixture.kickoffAt,
    );

  const existingFinal =
    latestFinalRecheck(
      decisions,
    );

  const earlier =
    latestEarlierDecision(
      decisions,
      existingFinal,
    );

  console.log(
    JSON.stringify(
      {
        version:
          'v7.0-r4.9.4-mandatory-t30-final-recheck',
        mode:
          'PREVIEW_READ_ONLY',
        providerFixtureId,
        fixture:
          `${fixture.homeTeamName} vs ${fixture.awayTeamName}`,
        now:
          now.toISOString(),
        kickoffAt:
          fixture.kickoffAt.toISOString(),
        exactMinutesToKickoff:
          Number(
            minutes.toFixed(3),
          ),
        finalRecheckDue:
          minutes > 0 &&
          minutes <= 30,
        existingFinalRecheck:
          existingFinal,
        latestEarlierDecision:
          earlier,
        action:
          existingFinal != null
            ? 'FINAL_RECHECK_ALREADY_CAPTURED'
            : minutes <= 0
              ? 'KICKOFF_PASSED'
              : minutes > 30
                ? 'WAIT_UNTIL_T30'
                : 'RUN_FINAL_RECHECK_NOW',
        externalApiCalled:
          false,
        databaseWritten:
          false,
        realMoneyExecution:
          false,
      },
      null,
      2,
    ),
  );
}

async function runFinalRecheck(): Promise<void> {
  const providerFixtureId =
    providerFixtureIdFromArgs();

  const now = new Date();
  const fixture =
    await latestProviderFixture(
      providerFixtureId,
    );

  const minutes =
    exactMinutesToKickoff(
      fixture.kickoffAt,
      now,
    );

  const horizon =
    currentFinalHorizon(
      minutes,
    );

  const before =
    await allFixtureDecisions(
      providerFixtureId,
      fixture.kickoffAt,
    );

  const alreadyFinal =
    latestFinalRecheck(
      before,
    );

  if (alreadyFinal != null) {
    console.log(
      JSON.stringify(
        {
          version:
            'v7.0-r4.9.4-mandatory-t30-final-recheck',
          event:
            'final-recheck-already-captured',
          providerFixtureId,
          exactMinutesToKickoff:
            Number(
              minutes.toFixed(3),
            ),
          existingFinalRecheck:
            alreadyFinal,
          evidence:
            await buildEvidence({
              providerFixtureId,
              fixture,
              now,
            }),
          externalApiCalled:
            false,
          databaseWritten:
            false,
          realMoneyExecution:
            false,
        },
        null,
        2,
      ),
    );

    return;
  }

  const previousHorizons =
    process.env.PAPER_BET_HORIZONS_MINUTES;

  const previousFlexible =
    process.env.PAPER_BET_ALLOW_FLEXIBLE_HORIZONS;

  const previousTolerance =
    process.env.PAPER_BET_DECISION_TOLERANCE_MINUTES;

  process.env.PAPER_BET_HORIZONS_MINUTES =
    String(horizon);

  process.env.PAPER_BET_ALLOW_FLEXIBLE_HORIZONS =
    '1';

  process.env.PAPER_BET_DECISION_TOLERANCE_MINUTES =
    '0.55';

  let result;

  try {
    result =
      await runLiveScientificPaperBetDecisions({
        now,
        providerFixtureIds: [
          providerFixtureId,
        ],
      });
  } finally {
    if (
      previousHorizons == null
    ) {
      delete process.env
        .PAPER_BET_HORIZONS_MINUTES;
    } else {
      process.env.PAPER_BET_HORIZONS_MINUTES =
        previousHorizons;
    }

    if (
      previousFlexible == null
    ) {
      delete process.env
        .PAPER_BET_ALLOW_FLEXIBLE_HORIZONS;
    } else {
      process.env.PAPER_BET_ALLOW_FLEXIBLE_HORIZONS =
        previousFlexible;
    }

    if (
      previousTolerance == null
    ) {
      delete process.env
        .PAPER_BET_DECISION_TOLERANCE_MINUTES;
    } else {
      process.env.PAPER_BET_DECISION_TOLERANCE_MINUTES =
        previousTolerance;
    }
  }

  const after =
    await allFixtureDecisions(
      providerFixtureId,
      fixture.kickoffAt,
    );

  const finalDecision =
    latestFinalRecheck(
      after,
    );

  if (finalDecision == null) {
    console.error(
      JSON.stringify(
        {
          version:
            'v7.0-r4.9.4-mandatory-t30-final-recheck',
          event:
            'final-recheck-not-recorded',
          providerFixtureId,
          exactMinutesToKickoff:
            Number(
              minutes.toFixed(3),
            ),
          requestedHorizon:
            horizon,
          runResult:
            result,
          reason:
            'Existing scientific engine did not record a <=T30 decision. Inspect skip/error reasons; do not fabricate evidence.',
          externalApiCalled:
            result?.apiCalled ??
            false,
          databaseWritten:
            false,
          realMoneyExecution:
            false,
        },
        null,
        2,
      ),
    );

    process.exitCode = 3;
    return;
  }

  console.log(
    JSON.stringify(
      {
        version:
          'v7.0-r4.9.4-mandatory-t30-final-recheck',
        event:
          'final-recheck-captured',
        providerFixtureId,
        fixture:
          `${fixture.homeTeamName} vs ${fixture.awayTeamName}`,
        exactMinutesToKickoff:
          Number(
            minutes.toFixed(3),
          ),
        requestedHorizon:
          horizon,
        runResult:
          result,
        evidence:
          await buildEvidence({
            providerFixtureId,
            fixture,
            now: new Date(),
          }),
        invariants: {
          appendOnly:
            true,
          previousDecisionOverwritten:
            false,
          t90ReliabilityGateChanged:
            false,
          nonT90BestBetPromotion:
            false,
          externalApiCalled:
            result.apiCalled,
          realMoneyExecution:
            false,
        },
      },
      null,
      2,
    ),
  );
}

async function watch(): Promise<void> {
  const providerFixtureId =
    providerFixtureIdFromArgs();

  const pollSeconds =
    Math.max(
      10,
      Math.min(
        60,
        Number(
          process.env
            .FINAL_RECHECK_POLL_SECONDS ??
          20,
        ),
      ),
    );

  const fixture =
    await latestProviderFixture(
      providerFixtureId,
    );

  console.log(
    JSON.stringify(
      {
        version:
          'v7.0-r4.9.4-mandatory-t30-final-recheck',
        event:
          'final-recheck-watch-start',
        providerFixtureId,
        fixture:
          `${fixture.homeTeamName} vs ${fixture.awayTeamName}`,
        kickoffAt:
          fixture.kickoffAt.toISOString(),
        thresholdMinutes:
          30,
        pollSeconds,
        externalApiCalled:
          false,
        realMoneyExecution:
          false,
      },
      null,
      2,
    ),
  );

  while (true) {
    const now = new Date();

    const minutes =
      exactMinutesToKickoff(
        fixture.kickoffAt,
        now,
      );

    const decisions =
      await allFixtureDecisions(
        providerFixtureId,
        fixture.kickoffAt,
      );

    const existingFinal =
      latestFinalRecheck(
        decisions,
      );

    if (existingFinal != null) {
      console.log(
        JSON.stringify(
          {
            event:
              'final-recheck-watch-complete-existing',
            exactMinutesToKickoff:
              Number(
                minutes.toFixed(3),
              ),
            existingFinalRecheck:
              existingFinal,
            evidence:
              await buildEvidence({
                providerFixtureId,
                fixture,
                now,
              }),
          },
          null,
          2,
        ),
      );
      return;
    }

    if (minutes <= 0) {
      throw new Error(
        'KICKOFF_PASSED_WITHOUT_FINAL_RECHECK',
      );
    }

    if (minutes <= 30) {
      await runFinalRecheck();
      return;
    }

    console.log(
      JSON.stringify(
        {
          event:
            'waiting-for-t30-final-recheck',
          now:
            now.toISOString(),
          exactMinutesToKickoff:
            Number(
              minutes.toFixed(2),
            ),
        },
      ),
    );

    await sleep(
      pollSeconds * 1000,
    );
  }
}

async function evidence(): Promise<void> {
  const providerFixtureId =
    providerFixtureIdFromArgs();

  const now = new Date();

  const fixture =
    await latestProviderFixture(
      providerFixtureId,
    );

  console.log(
    JSON.stringify(
      {
        version:
          'v7.0-r4.9.4-mandatory-t30-final-recheck',
        mode:
          'EVIDENCE_READ_ONLY',
        providerFixtureId,
        fixture:
          `${fixture.homeTeamName} vs ${fixture.awayTeamName}`,
        evidence:
          await buildEvidence({
            providerFixtureId,
            fixture,
            now,
          }),
        externalApiCalled:
          false,
        databaseWritten:
          false,
        realMoneyExecution:
          false,
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const command =
    (
      process.argv[2] ??
      'preview'
    ).toLowerCase();

  if (command === 'preview') {
    await preview();
    return;
  }

  if (command === 'recheck') {
    await runFinalRecheck();
    return;
  }

  if (command === 'watch') {
    await watch();
    return;
  }

  if (command === 'evidence') {
    await evidence();
    return;
  }

  throw new Error(
    'Use preview, recheck, watch, or evidence.',
  );
}

main()
  .catch(
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    },
  )
  .finally(async () => {
    await prisma.$disconnect();
  });
