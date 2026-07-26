import { prisma, type InputJsonValue } from '@football-ai/database';
import { deterministicHash } from './scientific-evaluation-contract.js';
import {
  SCIENTIFIC_BANKROLL_RISK_VERSION,
  getScientificRiskPolicyConfig,
  planScientificPaperStake,
  settleScientificPaperStake,
  type ScientificRiskPolicyConfig,
  type ScientificRiskState,
} from './bankroll-risk-core.js';

interface RiskPolicyRow {
  id: number;
  accountKey: string;
  policyVersion: string;
  stakingMode: string;
  startingBankrollUnits: number;
  flatStakeUnits: number;
  kellyFraction: number;
  minimumStakeUnits: number;
  maximumStakeUnits: number;
  maximumStakeFraction: number;
  maximumOpenExposureFraction: number;
  maximumDailyExposureFraction: number;
  maximumLeagueExposureFraction: number;
  maximumDailyLossFraction: number;
  drawdownSoftLimit: number;
  drawdownHardLimit: number;
  minimumBankrollUnits: number;
  roundingUnits: number;
  payloadHash: string;
  createdAt: Date;
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
  bookmakerId: number | null;
  bookmakerName: string | null;
  modelProbability: number | null;
  fairMarketProbability: number | null;
  impliedProbability: number | null;
  edge: number | null;
  expectedValue: number | null;
  modelVersion: string;
  policyVersion: string;
  decisionHash: string;
  createdAt: Date;
}

interface RiskStakeRow {
  id: number;
  riskPolicyId: number;
  paperDecisionId: number;
  providerFixtureId: number;
  leagueId: number | null;
  decisionAsOf: Date;
  evaluatedAt: Date;
  stakeDecisionType: string;
  stakeUnits: number;
  decimalOdds: number | null;
  stakeHash: string;
}

interface RiskSettlementRow {
  id: number;
  stakeDecisionId: number;
  settledAt: Date;
  profitUnits: number;
  stakeUnits: number;
  result: string;
}

interface PaperSettlementRow {
  id: number;
  decisionId: number;
  providerFixtureId: number;
  settledAt: Date;
  result: string;
}

function jsonValue(value: unknown): InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as InputJsonValue;
}

function policyRowToConfig(row: RiskPolicyRow): ScientificRiskPolicyConfig {
  return {
    accountKey: row.accountKey,
    policyVersion: row.policyVersion,
    stakingMode: row.stakingMode === 'FRACTIONAL_KELLY' ? 'FRACTIONAL_KELLY' : 'FLAT',
    startingBankrollUnits: row.startingBankrollUnits,
    flatStakeUnits: row.flatStakeUnits,
    kellyFraction: row.kellyFraction,
    minimumStakeUnits: row.minimumStakeUnits,
    maximumStakeUnits: row.maximumStakeUnits,
    maximumStakeFraction: row.maximumStakeFraction,
    maximumOpenExposureFraction: row.maximumOpenExposureFraction,
    maximumDailyExposureFraction: row.maximumDailyExposureFraction,
    maximumLeagueExposureFraction: row.maximumLeagueExposureFraction,
    maximumDailyLossFraction: row.maximumDailyLossFraction,
    drawdownSoftLimit: row.drawdownSoftLimit,
    drawdownHardLimit: row.drawdownHardLimit,
    minimumBankrollUnits: row.minimumBankrollUnits,
    roundingUnits: row.roundingUnits,
  };
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function latestRiskPolicy(): Promise<RiskPolicyRow | null> {
  const explicit = Number(process.env.SCIENTIFIC_RISK_POLICY_ID);
  const where = Number.isInteger(explicit) && explicit > 0 ? { id: explicit } : undefined;
  const row = (await prisma.scientificBankrollRiskPolicy.findFirst({
    where,
    orderBy: { createdAt: 'desc' },
  })) as RiskPolicyRow | null;
  return row;
}

export async function freezeScientificBankrollRiskPolicy(): Promise<{
  riskVersion: string;
  policyId: number;
  policyVersion: string;
  payloadHash: string;
  created: boolean;
  configuration: ScientificRiskPolicyConfig;
  paperOnly: true;
  realMoneyExecution: false;
}> {
  const configuration = getScientificRiskPolicyConfig();
  const payload = {
    riskVersion: SCIENTIFIC_BANKROLL_RISK_VERSION,
    configuration,
    paperOnly: true,
    automaticBetPlacement: false,
    realMoneyExecution: false,
  };
  const payloadHash = deterministicHash('SCIENTIFIC_BANKROLL_RISK_POLICY', payload);
  const existing = (await prisma.scientificBankrollRiskPolicy.findUnique({
    where: { payloadHash },
  })) as RiskPolicyRow | null;
  if (existing) {
    return {
      riskVersion: SCIENTIFIC_BANKROLL_RISK_VERSION,
      policyId: existing.id,
      policyVersion: existing.policyVersion,
      payloadHash,
      created: false,
      configuration: policyRowToConfig(existing),
      paperOnly: true,
      realMoneyExecution: false,
    };
  }
  const created = (await prisma.scientificBankrollRiskPolicy.create({
    data: {
      accountKey: configuration.accountKey,
      policyVersion: configuration.policyVersion,
      stakingMode: configuration.stakingMode,
      startingBankrollUnits: configuration.startingBankrollUnits,
      flatStakeUnits: configuration.flatStakeUnits,
      kellyFraction: configuration.kellyFraction,
      minimumStakeUnits: configuration.minimumStakeUnits,
      maximumStakeUnits: configuration.maximumStakeUnits,
      maximumStakeFraction: configuration.maximumStakeFraction,
      maximumOpenExposureFraction: configuration.maximumOpenExposureFraction,
      maximumDailyExposureFraction: configuration.maximumDailyExposureFraction,
      maximumLeagueExposureFraction: configuration.maximumLeagueExposureFraction,
      maximumDailyLossFraction: configuration.maximumDailyLossFraction,
      drawdownSoftLimit: configuration.drawdownSoftLimit,
      drawdownHardLimit: configuration.drawdownHardLimit,
      minimumBankrollUnits: configuration.minimumBankrollUnits,
      roundingUnits: configuration.roundingUnits,
      configuration: jsonValue(payload),
      payloadHash,
    },
  })) as RiskPolicyRow;
  return {
    riskVersion: SCIENTIFIC_BANKROLL_RISK_VERSION,
    policyId: created.id,
    policyVersion: created.policyVersion,
    payloadHash,
    created: true,
    configuration,
    paperOnly: true,
    realMoneyExecution: false,
  };
}

export async function getScientificRiskState(input: {
  policy: RiskPolicyRow;
  asOf: Date;
  leagueId?: number | null;
}): Promise<ScientificRiskState> {
  const config = policyRowToConfig(input.policy);
  const [stakesRaw, settlementsRaw] = await Promise.all([
    prisma.scientificPaperStakeDecision.findMany({
      where: {
        riskPolicyId: input.policy.id,
        stakeDecisionType: 'STAKE',
        evaluatedAt: { lte: input.asOf },
      },
      orderBy: [{ evaluatedAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        riskPolicyId: true,
        paperDecisionId: true,
        providerFixtureId: true,
        leagueId: true,
        decisionAsOf: true,
        evaluatedAt: true,
        stakeDecisionType: true,
        stakeUnits: true,
        decimalOdds: true,
        stakeHash: true,
      },
    }),
    prisma.scientificBankrollStakeSettlement.findMany({
      where: {
        riskPolicyId: input.policy.id,
        settledAt: { lte: input.asOf },
      },
      orderBy: [{ settledAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        stakeDecisionId: true,
        settledAt: true,
        profitUnits: true,
        stakeUnits: true,
        result: true,
      },
    }),
  ]);
  const stakes = stakesRaw as RiskStakeRow[];
  const settlements = settlementsRaw as RiskSettlementRow[];
  let current = config.startingBankrollUnits;
  let peak = current;
  let maximumDrawdownFraction = 0;
  for (const row of settlements) {
    current = Math.max(0, current + row.profitUnits);
    peak = Math.max(peak, current);
    const drawdown = peak > 0 ? Math.max(0, (peak - current) / peak) : 0;
    maximumDrawdownFraction = Math.max(maximumDrawdownFraction, drawdown);
  }
  const currentDrawdownFraction = peak > 0 ? Math.max(0, (peak - current) / peak) : 0;
  const settledStakeIds = new Set(settlements.map((row) => row.stakeDecisionId));
  const openStakes = stakes.filter((row) => !settledStakeIds.has(row.id));
  const activeDay = dayKey(input.asOf);
  const dailyStakes = stakes.filter((row) => dayKey(row.evaluatedAt) === activeDay);
  const dailySettlements = settlements.filter((row) => dayKey(row.settledAt) === activeDay);
  const leagueExposureUnits =
    input.leagueId == null
      ? 0
      : openStakes
          .filter((row) => row.leagueId === input.leagueId)
          .reduce((sum, row) => sum + row.stakeUnits, 0);
  return {
    currentBankrollUnits: current,
    peakBankrollUnits: peak,
    currentDrawdownFraction,
    maximumDrawdownFraction,
    openExposureUnits: openStakes.reduce((sum, row) => sum + row.stakeUnits, 0),
    dailyExposureUnits: dailyStakes.reduce((sum, row) => sum + row.stakeUnits, 0),
    leagueExposureUnits,
    dailyRealizedPnlUnits: dailySettlements.reduce((sum, row) => sum + row.profitUnits, 0),
  };
}

async function leagueIdForDecision(decision: PaperDecisionRow): Promise<number | null> {
  if (decision.localFixtureId == null) return null;
  const fixture = (await prisma.fixture.findUnique({
    where: { id: decision.localFixtureId },
    select: { leagueId: true },
  })) as { leagueId: number } | null;
  return fixture?.leagueId ?? null;
}

export async function planUnallocatedScientificPaperStakes(input: { limit?: number } = {}): Promise<{
  riskVersion: string;
  policyId: number;
  policyFrozenAt: string;
  considered: number;
  stakes: number;
  noStakes: number;
  skippedAlreadyPlanned: number;
  lateRiskEvaluations: number;
  errors: Array<{ paperDecisionId: number; reason: string }>;
  externalApiCalled: false;
  realMoneyExecution: false;
}> {
  const policy = await latestRiskPolicy();
  if (!policy) throw new Error('NO_FROZEN_RISK_POLICY: run bankroll:risk-freeze-policy first.');
  const limit = Math.max(1, Math.min(1000, input.limit ?? Number(process.env.SCIENTIFIC_RISK_PLAN_LIMIT ?? 100)));
  const decisionsRaw = await prisma.scientificPaperBetDecision.findMany({
    where: { createdAt: { gte: policy.createdAt } },
    orderBy: [{ decisionAsOf: 'asc' }, { id: 'asc' }],
    take: limit,
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
      bookmakerId: true,
      bookmakerName: true,
      modelProbability: true,
      fairMarketProbability: true,
      impliedProbability: true,
      edge: true,
      expectedValue: true,
      modelVersion: true,
      policyVersion: true,
      decisionHash: true,
      createdAt: true,
    },
  });
  const decisions = decisionsRaw as PaperDecisionRow[];
  const existingRaw = await prisma.scientificPaperStakeDecision.findMany({
    where: { riskPolicyId: policy.id, paperDecisionId: { in: decisions.map((row) => row.id) } },
    select: { paperDecisionId: true },
  });
  const existing = new Set((existingRaw as Array<{ paperDecisionId: number }>).map((row) => row.paperDecisionId));
  let stakes = 0;
  let noStakes = 0;
  let skippedAlreadyPlanned = 0;
  let lateRiskEvaluations = 0;
  const errors: Array<{ paperDecisionId: number; reason: string }> = [];
  const config = policyRowToConfig(policy);

  for (const decision of decisions) {
    if (existing.has(decision.id)) {
      skippedAlreadyPlanned += 1;
      continue;
    }
    try {
      const evaluatedAt = new Date();
      const leagueId = await leagueIdForDecision(decision);
      const state = await getScientificRiskState({ policy, asOf: evaluatedAt, leagueId });
      const late = evaluatedAt.getTime() >= decision.kickoffAt.getTime();
      const candidate =
        decision.decisionType === 'BEST_BET' &&
        decision.decimalOdds != null &&
        decision.modelProbability != null &&
        decision.fairMarketProbability != null &&
        decision.edge != null &&
        decision.expectedValue != null
          ? {
              decimalOdds: decision.decimalOdds,
              modelProbability: decision.modelProbability,
              fairMarketProbability: decision.fairMarketProbability,
              edge: decision.edge,
              expectedValue: decision.expectedValue,
            }
          : null;
      const plan = late
        ? {
            riskVersion: SCIENTIFIC_BANKROLL_RISK_VERSION,
            policyVersion: config.policyVersion,
            decisionType: 'NO_STAKE' as const,
            stakingMode: config.stakingMode,
            stakeUnits: 0,
            stakeFraction: 0,
            requestedStakeUnits: 0,
            fullKellyFraction: null,
            appliedKellyFraction: config.stakingMode === 'FRACTIONAL_KELLY' ? config.kellyFraction : null,
            drawdownMultiplier: 0,
            riskBand: 'NO_STAKE' as const,
            cappedBy: [],
            reasons: ['RISK_EVALUATION_AFTER_KICKOFF'],
          }
        : planScientificPaperStake({
            paperDecisionType: decision.decisionType === 'BEST_BET' ? 'BEST_BET' : 'NO_BET',
            candidate,
            policy: config,
            state,
          });
      if (late) lateRiskEvaluations += 1;
      if (decision.decisionType === 'BEST_BET' && !late && candidate == null) {
        plan.reasons.unshift('INCOMPLETE_BEST_BET_FIELDS');
      }
      const calculationPayload = {
        riskVersion: SCIENTIFIC_BANKROLL_RISK_VERSION,
        riskPolicyId: policy.id,
        riskPolicyHash: policy.payloadHash,
        paperDecisionHash: decision.decisionHash,
        evaluatedAt: evaluatedAt.toISOString(),
        paperDecision: decision,
        leagueId,
        state,
        plan,
        paperOnly: true,
        automaticBetPlacement: false,
        realMoneyExecution: false,
      };
      const stakeHash = deterministicHash('SCIENTIFIC_PAPER_STAKE_DECISION', calculationPayload);
      const created = await prisma.scientificPaperStakeDecision.createMany({
        data: [
          {
            riskPolicyId: policy.id,
            riskPolicyHash: policy.payloadHash,
            paperDecisionId: decision.id,
            paperDecisionHash: decision.decisionHash,
            providerFixtureId: decision.providerFixtureId,
            localFixtureId: decision.localFixtureId,
            leagueId,
            horizonMinutes: decision.horizonMinutes,
            decisionAsOf: decision.decisionAsOf,
            evaluatedAt,
            kickoffAt: decision.kickoffAt,
            paperDecisionType: decision.decisionType,
            stakeDecisionType: plan.decisionType,
            stakingMode: plan.stakingMode,
            selectedMarket: decision.selectedMarket,
            selectedSelection: decision.selectedSelection,
            lineValue: decision.lineValue,
            decimalOdds: decision.decimalOdds,
            modelProbability: decision.modelProbability,
            fairMarketProbability: decision.fairMarketProbability,
            edge: decision.edge,
            expectedValue: decision.expectedValue,
            stakeUnits: plan.stakeUnits,
            stakeFraction: plan.stakeFraction,
            requestedStakeUnits: plan.requestedStakeUnits,
            fullKellyFraction: plan.fullKellyFraction,
            appliedKellyFraction: plan.appliedKellyFraction,
            drawdownMultiplier: plan.drawdownMultiplier,
            riskBand: plan.riskBand,
            bankrollBeforeUnits: state.currentBankrollUnits,
            peakBankrollBeforeUnits: state.peakBankrollUnits,
            openExposureBeforeUnits: state.openExposureUnits,
            dailyExposureBeforeUnits: state.dailyExposureUnits,
            leagueExposureBeforeUnits: state.leagueExposureUnits,
            dailyRealizedPnlBeforeUnits: state.dailyRealizedPnlUnits,
            drawdownBeforeFraction: state.currentDrawdownFraction,
            riskReasons: jsonValue(plan.reasons),
            cappedBy: jsonValue(plan.cappedBy),
            calculationPayload: jsonValue(calculationPayload),
            stakeHash,
          },
        ],
        skipDuplicates: true,
      });
      if (created.count > 0) {
        if (plan.decisionType === 'STAKE') stakes += 1;
        else noStakes += 1;
      } else {
        skippedAlreadyPlanned += 1;
      }
    } catch (error) {
      errors.push({
        paperDecisionId: decision.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    riskVersion: SCIENTIFIC_BANKROLL_RISK_VERSION,
    policyId: policy.id,
    policyFrozenAt: policy.createdAt.toISOString(),
    considered: decisions.length,
    stakes,
    noStakes,
    skippedAlreadyPlanned,
    lateRiskEvaluations,
    errors,
    externalApiCalled: false,
    realMoneyExecution: false,
  };
}

export async function syncScientificBankrollSettlements(input: { limit?: number } = {}): Promise<{
  riskVersion: string;
  policyId: number;
  considered: number;
  settled: number;
  waitingForPaperSettlement: number;
  skippedAlreadySettled: number;
  errors: Array<{ stakeDecisionId: number; reason: string }>;
  externalApiCalled: false;
  realMoneyExecution: false;
}> {
  const policy = await latestRiskPolicy();
  if (!policy) throw new Error('NO_FROZEN_RISK_POLICY: run bankroll:risk-freeze-policy first.');
  const limit = Math.max(1, Math.min(1000, input.limit ?? Number(process.env.SCIENTIFIC_RISK_SETTLE_LIMIT ?? 100)));
  const stakesRaw = await prisma.scientificPaperStakeDecision.findMany({
    where: { riskPolicyId: policy.id, stakeDecisionType: 'STAKE' },
    orderBy: [{ kickoffAt: 'asc' }, { id: 'asc' }],
    take: limit,
    select: {
      id: true,
      riskPolicyId: true,
      paperDecisionId: true,
      providerFixtureId: true,
      leagueId: true,
      decisionAsOf: true,
      evaluatedAt: true,
      stakeDecisionType: true,
      stakeUnits: true,
      decimalOdds: true,
      stakeHash: true,
    },
  });
  const stakes = stakesRaw as RiskStakeRow[];
  const existingRaw = await prisma.scientificBankrollStakeSettlement.findMany({
    where: { riskPolicyId: policy.id, stakeDecisionId: { in: stakes.map((row) => row.id) } },
    select: { stakeDecisionId: true },
  });
  const existing = new Set((existingRaw as Array<{ stakeDecisionId: number }>).map((row) => row.stakeDecisionId));
  const paperRaw = await prisma.scientificPaperBetSettlement.findMany({
    where: { decisionId: { in: stakes.map((row) => row.paperDecisionId) } },
    orderBy: [{ settledAt: 'asc' }, { id: 'asc' }],
    select: { id: true, decisionId: true, providerFixtureId: true, settledAt: true, result: true },
  });
  const paperSettlements = paperRaw as PaperSettlementRow[];
  const byDecision = new Map(paperSettlements.map((row) => [row.decisionId, row]));
  let settled = 0;
  let waitingForPaperSettlement = 0;
  let skippedAlreadySettled = 0;
  const errors: Array<{ stakeDecisionId: number; reason: string }> = [];

  for (const stake of stakes) {
    if (existing.has(stake.id)) {
      skippedAlreadySettled += 1;
      continue;
    }
    const paper = byDecision.get(stake.paperDecisionId);
    if (!paper) {
      waitingForPaperSettlement += 1;
      continue;
    }
    try {
      if (stake.decimalOdds == null) throw new Error('STAKE_DECISION_MISSING_DECIMAL_ODDS');
      const normalizedResult =
        paper.result === 'WIN' || paper.result === 'LOSS' || paper.result === 'PUSH' || paper.result === 'VOID'
          ? paper.result
          : null;
      if (!normalizedResult) throw new Error(`UNSUPPORTED_PAPER_SETTLEMENT_RESULT:${paper.result}`);
      const before = await getScientificRiskState({ policy, asOf: paper.settledAt, leagueId: stake.leagueId });
      const outcome = settleScientificPaperStake({
        result: normalizedResult,
        stakeUnits: stake.stakeUnits,
        decimalOdds: stake.decimalOdds,
      });
      const bankrollAfterUnits = Math.max(0, before.currentBankrollUnits + outcome.profitUnits);
      const peakBankrollAfterUnits = Math.max(before.peakBankrollUnits, bankrollAfterUnits);
      const drawdownAfterFraction =
        peakBankrollAfterUnits > 0
          ? Math.max(0, (peakBankrollAfterUnits - bankrollAfterUnits) / peakBankrollAfterUnits)
          : 0;
      const settlementPayload = {
        riskVersion: SCIENTIFIC_BANKROLL_RISK_VERSION,
        riskPolicyId: policy.id,
        riskPolicyHash: policy.payloadHash,
        stakeDecisionId: stake.id,
        stakeHash: stake.stakeHash,
        paperSettlementId: paper.id,
        paperSettlement: paper,
        outcome,
        bankrollBeforeUnits: before.currentBankrollUnits,
        bankrollAfterUnits,
        peakBankrollAfterUnits,
        drawdownAfterFraction,
        paperOnly: true,
        realMoneyExecution: false,
      };
      const settlementHash = deterministicHash('SCIENTIFIC_BANKROLL_STAKE_SETTLEMENT', settlementPayload);
      const created = await prisma.scientificBankrollStakeSettlement.createMany({
        data: [
          {
            riskPolicyId: policy.id,
            riskPolicyHash: policy.payloadHash,
            stakeDecisionId: stake.id,
            paperDecisionId: stake.paperDecisionId,
            paperSettlementId: paper.id,
            providerFixtureId: stake.providerFixtureId,
            settledAt: paper.settledAt,
            result: outcome.result,
            stakeUnits: outcome.stakeUnits,
            decimalOdds: stake.decimalOdds,
            profitUnits: outcome.profitUnits,
            bankrollBeforeUnits: before.currentBankrollUnits,
            bankrollAfterUnits,
            peakBankrollAfterUnits,
            drawdownAfterFraction,
            settlementPayload: jsonValue(settlementPayload),
            settlementHash,
          },
        ],
        skipDuplicates: true,
      });
      settled += created.count;
      if (created.count === 0) skippedAlreadySettled += 1;
    } catch (error) {
      errors.push({ stakeDecisionId: stake.id, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    riskVersion: SCIENTIFIC_BANKROLL_RISK_VERSION,
    policyId: policy.id,
    considered: stakes.length,
    settled,
    waitingForPaperSettlement,
    skippedAlreadySettled,
    errors,
    externalApiCalled: false,
    realMoneyExecution: false,
  };
}

export async function getScientificBankrollRiskReadiness(): Promise<Record<string, unknown>> {
  const policy = await latestRiskPolicy();
  const [paperDecisions, bestBets, paperSettlements, riskPolicies, stakeDecisions, riskSettlements] =
    await Promise.all([
      prisma.scientificPaperBetDecision.count(),
      prisma.scientificPaperBetDecision.count({ where: { decisionType: 'BEST_BET' } }),
      prisma.scientificPaperBetSettlement.count(),
      prisma.scientificBankrollRiskPolicy.count(),
      prisma.scientificPaperStakeDecision.count(),
      prisma.scientificBankrollStakeSettlement.count(),
    ]);
  let eligibleSincePolicy = 0;
  let unplannedSincePolicy = 0;
  if (policy) {
    eligibleSincePolicy = await prisma.scientificPaperBetDecision.count({
      where: { createdAt: { gte: policy.createdAt } },
    });
    const plannedRaw = await prisma.scientificPaperStakeDecision.findMany({
      where: { riskPolicyId: policy.id },
      select: { paperDecisionId: true },
    });
    const planned = new Set((plannedRaw as Array<{ paperDecisionId: number }>).map((row) => row.paperDecisionId));
    const decisionsRaw = await prisma.scientificPaperBetDecision.findMany({
      where: { createdAt: { gte: policy.createdAt } },
      select: { id: true },
    });
    unplannedSincePolicy = (decisionsRaw as Array<{ id: number }>).filter((row) => !planned.has(row.id)).length;
  }
  return {
    riskVersion: SCIENTIFIC_BANKROLL_RISK_VERSION,
    command: 'readiness',
    riskPolicyFrozen: policy != null,
    activeRiskPolicy: policy
      ? {
          id: policy.id,
          accountKey: policy.accountKey,
          policyVersion: policy.policyVersion,
          stakingMode: policy.stakingMode,
          startingBankrollUnits: policy.startingBankrollUnits,
          createdAt: policy.createdAt.toISOString(),
          payloadHash: policy.payloadHash,
        }
      : null,
    sourceLedger: { paperDecisions, bestBets, paperSettlements },
    riskLedger: { riskPolicies, stakeDecisions, riskSettlements },
    sinceActivePolicy: { eligibleDecisions: eligibleSincePolicy, unplannedDecisions: unplannedSincePolicy },
    nextAction: policy ? 'PLAN_NEW_PAPER_DECISIONS' : 'FREEZE_RISK_POLICY',
    externalApiCalled: false,
    databaseWritten: false,
    syntheticOddsUsed: false,
    automaticBetPlacement: false,
    realMoneyExecution: false,
  };
}

export async function getScientificBankrollRiskCoverage(): Promise<Record<string, unknown>> {
  const policy = await latestRiskPolicy();
  if (!policy) {
    return {
      riskVersion: SCIENTIFIC_BANKROLL_RISK_VERSION,
      command: 'coverage',
      status: 'NO_FROZEN_RISK_POLICY',
      externalApiCalled: false,
      realMoneyExecution: false,
    };
  }
  const [stakesRaw, settlementsRaw, stakeTypeGroupsRaw, resultGroupsRaw] = await Promise.all([
    prisma.scientificPaperStakeDecision.findMany({
      where: { riskPolicyId: policy.id, stakeDecisionType: 'STAKE' },
      select: { id: true, stakeUnits: true },
    }),
    prisma.scientificBankrollStakeSettlement.findMany({
      where: { riskPolicyId: policy.id },
      select: { id: true, stakeUnits: true, profitUnits: true },
    }),
    prisma.scientificPaperStakeDecision.groupBy({
      by: ['stakeDecisionType'],
      where: { riskPolicyId: policy.id },
      _count: { _all: true },
    }),
    prisma.scientificBankrollStakeSettlement.groupBy({
      by: ['result'],
      where: { riskPolicyId: policy.id },
      _count: { _all: true },
    }),
  ]);
  const stakes = stakesRaw as Array<{ id: number; stakeUnits: number }>;
  const settlements = settlementsRaw as Array<{ id: number; stakeUnits: number; profitUnits: number }>;
  const stakeTypeGroups = stakeTypeGroupsRaw as Array<{ stakeDecisionType: string; _count: { _all: number } }>;
  const resultGroups = resultGroupsRaw as Array<{ result: string; _count: { _all: number } }>;
  const state = await getScientificRiskState({ policy, asOf: new Date(), leagueId: null });
  const settledStakeUnits = settlements.reduce((sum, row) => sum + row.stakeUnits, 0);
  const profitUnits = settlements.reduce((sum, row) => sum + row.profitUnits, 0);
  return {
    riskVersion: SCIENTIFIC_BANKROLL_RISK_VERSION,
    command: 'coverage',
    policy: {
      id: policy.id,
      accountKey: policy.accountKey,
      policyVersion: policy.policyVersion,
      stakingMode: policy.stakingMode,
      createdAt: policy.createdAt.toISOString(),
      payloadHash: policy.payloadHash,
    },
    stakeDecisions: Object.fromEntries(stakeTypeGroups.map((row) => [row.stakeDecisionType, row._count._all])),
    settlements: Object.fromEntries(resultGroups.map((row) => [row.result, row._count._all])),
    metrics: {
      startingBankrollUnits: policy.startingBankrollUnits,
      currentBankrollUnits: state.currentBankrollUnits,
      peakBankrollUnits: state.peakBankrollUnits,
      profitUnits,
      bankrollReturn: profitUnits / policy.startingBankrollUnits,
      totalStakeDecisions: stakes.length,
      totalStakedUnits: stakes.reduce((sum, row) => sum + row.stakeUnits, 0),
      settledStakeUnits,
      yieldRate: settledStakeUnits > 0 ? profitUnits / settledStakeUnits : null,
      openExposureUnits: state.openExposureUnits,
      dailyExposureUnits: state.dailyExposureUnits,
      dailyRealizedPnlUnits: state.dailyRealizedPnlUnits,
      currentDrawdownFraction: state.currentDrawdownFraction,
      maximumDrawdownFraction: state.maximumDrawdownFraction,
    },
    integrity: {
      paperOnly: true,
      externalApiCalled: false,
      syntheticOddsUsed: false,
      automaticBetPlacement: false,
      realMoneyExecution: false,
      singleWriterRequired: true,
      sourceBestBetPolicyChanged: false,
    },
  };
}

export async function runScientificBankrollRiskCycle(): Promise<Record<string, unknown>> {
  const plan = await planUnallocatedScientificPaperStakes();
  const settlement = await syncScientificBankrollSettlements();
  return {
    riskVersion: SCIENTIFIC_BANKROLL_RISK_VERSION,
    command: 'cycle',
    plan,
    settlement,
    externalApiCalled: false,
    realMoneyExecution: false,
  };
}
