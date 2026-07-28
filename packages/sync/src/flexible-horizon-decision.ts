import { prisma } from '@football-ai/database';
import { runLiveScientificPaperBetDecisions } from './real-odds-paper-bet-engine.js';

interface ProviderFixtureRow {
  providerFixtureId: number;
  kickoffAt: Date;
  homeTeamName: string;
  awayTeamName: string;
  observedAt: Date;
}

interface DecisionRow {
  id: number;
  horizonMinutes: number;
  decisionAsOf: Date;
  kickoffAt: Date;
  decisionType: string;
  selectedMarket: string | null;
  selectedSelection: string | null;
  decimalOdds: number | null;
  modelProbability: number | null;
  fairMarketProbability: number | null;
  edge: number | null;
  expectedValue: number | null;
  reliabilityStatus: string | null;
  candidateCount: number;
  rejectedCandidateCount: number;
}

interface CandidateRow {
  decisionId: number;
  marketType: string;
  selection: string;
  decimalOdds: number;
  modelProbability: number;
  fairMarketProbability: number;
  edge: number;
  expectedValue: number;
  reliabilityStatus: string;
  eligible: boolean;
  rejectionReasons: unknown;
}

function argValue(name: string): string | null {
  const inline = process.argv.find(
    (item: string): boolean => item.startsWith(`--${name}=`),
  );
  if (inline) return inline.slice(name.length + 3);

  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function providerFixtureId(): number {
  const raw = argValue('fixture') ?? process.env.FLEX_PROVIDER_FIXTURE_ID ?? '';
  const value = Number(raw);

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Use --fixture=<providerFixtureId>.');
  }

  return value;
}

async function loadFixture(id: number): Promise<ProviderFixtureRow> {
  const row = (await prisma.apiFootballFixtureSnapshot.findFirst({
    where: { providerFixtureId: id },
    select: {
      providerFixtureId: true,
      kickoffAt: true,
      homeTeamName: true,
      awayTeamName: true,
      observedAt: true,
    },
    orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
  })) as ProviderFixtureRow | null;

  if (!row) throw new Error(`Fixture ${id} not found in local provider snapshots.`);
  return row;
}

function currentHorizon(kickoffAt: Date, now: Date): {
  exact: number;
  rounded: number;
} {
  const exact = (kickoffAt.getTime() - now.getTime()) / 60_000;
  const rounded = Math.round(exact);

  if (!Number.isFinite(exact) || rounded < 1 || rounded > 1440) {
    throw new Error(
      `Fixture must be 1..1440 minutes before kickoff. Current=${exact.toFixed(2)}.`,
    );
  }

  return { exact, rounded };
}

async function preview(): Promise<void> {
  const id = providerFixtureId();
  const now = new Date();
  const fixture = await loadFixture(id);
  const horizon = currentHorizon(fixture.kickoffAt, now);

  const [pitOddsRows, existing] = await Promise.all([
    prisma.apiFootballOddsSnapshot.count({
      where: {
        providerFixtureId: id,
        pitUsable: true,
        observedAt: { lte: now },
        kickoffAt: { gt: now },
      },
    }),
    prisma.scientificPaperBetDecision.findFirst({
      where: {
        providerFixtureId: id,
        kickoffAt: fixture.kickoffAt,
        horizonMinutes: horizon.rounded,
      },
      select: {
        id: true,
        decisionType: true,
        decisionAsOf: true,
      },
      orderBy: { decisionAsOf: 'desc' },
    }),
  ]);

  console.log(JSON.stringify({
    version: 'v7.0-r4.9.3-flexible-horizon',
    mode: 'PREVIEW_READ_ONLY',
    providerFixtureId: id,
    fixture: `${fixture.homeTeamName} vs ${fixture.awayTeamName}`,
    now: now.toISOString(),
    kickoffAt: fixture.kickoffAt.toISOString(),
    exactMinutesToKickoff: Number(horizon.exact.toFixed(3)),
    snapshotHorizonMinutes: horizon.rounded,
    pitUsableOddsRows: pitOddsRows,
    existingDecisionAtSameRoundedHorizon: existing,
    scientificClass:
      horizon.rounded === 90
        ? 'T90_VALIDATED_GATE'
        : horizon.rounded <= 30
          ? 'FINAL_RECHECK_REQUIRED_R4_9_4_PENDING'
          : 'FLEXIBLE_SHADOW',
    externalApiCalled: false,
    databaseWritten: false,
    realMoneyExecution: false,
  }, null, 2));
}

async function snapshot(): Promise<void> {
  const id = providerFixtureId();
  const now = new Date();
  const fixture = await loadFixture(id);
  const horizon = currentHorizon(fixture.kickoffAt, now);

  const oldHorizons = process.env.PAPER_BET_HORIZONS_MINUTES;
  const oldFlexible = process.env.PAPER_BET_ALLOW_FLEXIBLE_HORIZONS;
  const oldTolerance = process.env.PAPER_BET_DECISION_TOLERANCE_MINUTES;

  process.env.PAPER_BET_HORIZONS_MINUTES = String(horizon.rounded);
  process.env.PAPER_BET_ALLOW_FLEXIBLE_HORIZONS = '1';
  process.env.PAPER_BET_DECISION_TOLERANCE_MINUTES = '0.55';

  try {
    const result = await runLiveScientificPaperBetDecisions({
      now,
      providerFixtureIds: [id],
    });

    console.log(JSON.stringify({
      version: 'v7.0-r4.9.3-flexible-horizon',
      mode: 'APPEND_ONLY_SNAPSHOT',
      providerFixtureId: id,
      fixture: `${fixture.homeTeamName} vs ${fixture.awayTeamName}`,
      exactMinutesToKickoff: Number(horizon.exact.toFixed(3)),
      snapshotHorizonMinutes: horizon.rounded,
      result,
      nonT90IsShadowOnly: horizon.rounded !== 90,
      mandatoryFinalRecheckRequired: horizon.rounded <= 30,
      r494FinalRecheckEnabled: false,
      externalApiCalled: result.apiCalled,
      paperDatabaseWritePossible: true,
      realMoneyExecution: false,
    }, null, 2));
  } finally {
    if (oldHorizons == null) delete process.env.PAPER_BET_HORIZONS_MINUTES;
    else process.env.PAPER_BET_HORIZONS_MINUTES = oldHorizons;

    if (oldFlexible == null) delete process.env.PAPER_BET_ALLOW_FLEXIBLE_HORIZONS;
    else process.env.PAPER_BET_ALLOW_FLEXIBLE_HORIZONS = oldFlexible;

    if (oldTolerance == null) delete process.env.PAPER_BET_DECISION_TOLERANCE_MINUTES;
    else process.env.PAPER_BET_DECISION_TOLERANCE_MINUTES = oldTolerance;
  }
}

async function evidence(): Promise<void> {
  const id = providerFixtureId();

  const decisionsRaw = await prisma.scientificPaperBetDecision.findMany({
    where: { providerFixtureId: id },
    select: {
      id: true,
      horizonMinutes: true,
      decisionAsOf: true,
      kickoffAt: true,
      decisionType: true,
      selectedMarket: true,
      selectedSelection: true,
      decimalOdds: true,
      modelProbability: true,
      fairMarketProbability: true,
      edge: true,
      expectedValue: true,
      reliabilityStatus: true,
      candidateCount: true,
      rejectedCandidateCount: true,
    },
    orderBy: [{ decisionAsOf: 'asc' }, { id: 'asc' }],
    take: 200,
  });

  const decisions = decisionsRaw as DecisionRow[];
  const ids = decisions.map((row: DecisionRow): number => row.id);

  const candidatesRaw = ids.length === 0
    ? []
    : await prisma.scientificPaperBetCandidate.findMany({
        where: { decisionId: { in: ids } },
        select: {
          decisionId: true,
          marketType: true,
          selection: true,
          decimalOdds: true,
          modelProbability: true,
          fairMarketProbability: true,
          edge: true,
          expectedValue: true,
          reliabilityStatus: true,
          eligible: true,
          rejectionReasons: true,
        },
        orderBy: [{ decisionId: 'asc' }, { eligible: 'desc' }],
      });

  const candidates = candidatesRaw as CandidateRow[];

  const timeline = decisions.map((decision: DecisionRow) => {
    const rows = candidates.filter(
      (candidate: CandidateRow): boolean => candidate.decisionId === decision.id,
    );

    return {
      ...decision,
      decisionAsOf: decision.decisionAsOf.toISOString(),
      kickoffAt: decision.kickoffAt.toISOString(),
      class:
        decision.horizonMinutes === 90
          ? 'T90_VALIDATED_GATE'
          : decision.horizonMinutes <= 30
            ? 'FINAL_RECHECK_REQUIRED_R4_9_4_PENDING'
            : 'FLEXIBLE_SHADOW',
      candidates: rows,
    };
  });

  console.log(JSON.stringify({
    version: 'v7.0-r4.9.3-flexible-horizon',
    providerFixtureId: id,
    decisionCount: timeline.length,
    timeline,
    appendOnly: true,
    t90BestBetGateUnchanged: true,
    nonT90ReliabilityPromotion: false,
    externalApiCalled: false,
    databaseWritten: false,
    realMoneyExecution: false,
  }, null, 2));
}

async function main(): Promise<void> {
  const command = (process.argv[2] ?? 'preview').toLowerCase();
  if (command === 'preview') return preview();
  if (command === 'snapshot') return snapshot();
  if (command === 'evidence') return evidence();
  throw new Error('Use preview, snapshot, or evidence.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
