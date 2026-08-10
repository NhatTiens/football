import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { prisma } from '@football-ai/database';
import {
  V8_PAPER_RUNTIME_VERSION,
  getV8PaperRuntimeCoverage,
  loadV8CalibrationRegistry,
} from './v8-paper-runtime-engine.js';
import { MULTI_HORIZON_POLICY } from './multi-horizon-decision-contract.js';

export const V8_MONITORING_VERSION = 'v8.0-stage9-dashboard-monitoring-v1';

type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface V8MonitoringAlert {
  code: string;
  severity: AlertSeverity;
  count: number;
  message: string;
}

interface RecentDecisionRow {
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
  edge: number | null;
  expectedValue: number | null;
  modelVersion: string;
  policyVersion: string;
  decisionHash: string;
  candidateCount: number;
  rejectedCandidateCount: number;
  decisionPayload: unknown;
  settlement: unknown;
}

interface RecentSettlementRow {
  decisionId: number;
  providerFixtureId: number;
  result: string;
  profitUnits: number;
  clv: number | null;
  settledAt: Date;
}

function latestArtifactManifest(directory: string): unknown | null {
  try {
    const path = readdirSync(resolve(directory), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => resolve(directory, entry.name, 'manifest.json'))
      .sort()
      .reverse()[0];
    return path ? JSON.parse(readFileSync(path, 'utf8')) : null;
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function getV8MonitoringDashboard(now = new Date()) {
  const since24h = new Date(now.getTime() - 24 * 60 * 60_000);
  const staleOddsBefore = new Date(now.getTime() - 30 * 60_000);
  const settlementDueBefore = new Date(now.getTime() - 3 * 60 * 60_000);
  const calibration = loadV8CalibrationRegistry();
  const [
    coverage,
    recentDecisions,
    recentSettlements,
    failedProviderJobs,
    latestProviderRun,
    latestOdds,
    missingSettlements,
    latestLineup,
    latestInjury,
  ] = await Promise.all([
    getV8PaperRuntimeCoverage(),
    prisma.scientificPaperBetDecision.findMany({
      where: { modelVersion: { startsWith: V8_PAPER_RUNTIME_VERSION } },
      include: { candidates: { orderBy: { id: 'asc' } }, settlement: true },
      orderBy: [{ decisionAsOf: 'desc' }, { id: 'desc' }],
      take: 100,
    }),
    prisma.scientificPaperBetSettlement.findMany({
      where: { decision: { modelVersion: { startsWith: V8_PAPER_RUNTIME_VERSION } } },
      include: { decision: true },
      orderBy: [{ settledAt: 'desc' }, { id: 'desc' }],
      take: 100,
    }),
    prisma.apiFootballProviderRun.count({
      where: { startedAt: { gte: since24h }, status: { not: 'SUCCESS' } },
    }),
    prisma.apiFootballProviderRun.findFirst({ orderBy: [{ startedAt: 'desc' }, { id: 'desc' }] }),
    prisma.apiFootballOddsSnapshot.findFirst({ orderBy: [{ observedAt: 'desc' }, { id: 'desc' }] }),
    prisma.scientificPaperBetDecision.count({
      where: {
        modelVersion: { startsWith: V8_PAPER_RUNTIME_VERSION },
        decisionType: 'BEST_BET',
        kickoffAt: { lte: settlementDueBefore },
        settlement: null,
      },
    }),
    prisma.fixtureLineupSnapshot.findFirst({ orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }] }),
    prisma.fixtureInjurySnapshot.findFirst({ orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }] }),
  ]);
  const decisionRows = recentDecisions as RecentDecisionRow[];
  const settlementRows = recentSettlements as RecentSettlementRow[];

  const semanticKeys = decisionRows.map(
    (row) => `${row.providerFixtureId}:${row.kickoffAt.toISOString()}:${row.horizonMinutes}`,
  );
  const duplicateDecisionCount = semanticKeys.length - new Set(semanticKeys).size;
  const horizonCounts = Object.fromEntries(
    MULTI_HORIZON_POLICY.horizonsMinutes.map((horizon) => [
      `T-${horizon}`,
      decisionRows.filter((row) => row.horizonMinutes === horizon).length,
    ]),
  );
  const alerts: V8MonitoringAlert[] = [];
  if (failedProviderJobs > 0) {
    alerts.push({
      code: 'PROVIDER_JOB_FAILURE_24H',
      severity: 'CRITICAL',
      count: failedProviderJobs,
      message: 'Provider jobs failed or did not finish successfully during the last 24 hours.',
    });
  }
  if (!latestOdds || latestOdds.observedAt < staleOddsBefore) {
    alerts.push({
      code: 'STALE_ODDS',
      severity: 'WARNING',
      count: 1,
      message: 'The newest provider odds snapshot is older than 30 minutes.',
    });
  }
  if (duplicateDecisionCount > 0) {
    alerts.push({
      code: 'DUPLICATE_DECISION',
      severity: 'CRITICAL',
      count: duplicateDecisionCount,
      message: 'Multiple v8 decisions share the same fixture, kickoff and horizon.',
    });
  }
  if (missingSettlements > 0) {
    alerts.push({
      code: 'MISSING_SETTLEMENT',
      severity: 'WARNING',
      count: missingSettlements,
      message: 'Finished or overdue BEST_BET decisions do not yet have a settlement.',
    });
  }
  if (coverage.decisions === 0) {
    alerts.push({
      code: 'PAPER_SAMPLE_EMPTY',
      severity: 'INFO',
      count: 1,
      message: 'v8 paper runtime is ready but has not recorded a live decision yet.',
    });
  }

  const rejectionCounts: Record<string, number> = {};
  for (const decision of decisionRows) {
    const payload = record(decision.decisionPayload);
    const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
    for (const candidateValue of candidates) {
      const candidate = record(record(candidateValue)?.candidate);
      const reasons = Array.isArray(candidate?.reasonCodes) ? candidate.reasonCodes : [];
      for (const reason of reasons.filter((item): item is string => typeof item === 'string')) {
        rejectionCounts[reason] = (rejectionCounts[reason] ?? 0) + 1;
      }
    }
  }

  const backtestManifest = latestArtifactManifest(
    'artifacts/hybrid/v8-stage7-champion-challenger',
  );
  const calibrationManifest = latestArtifactManifest(
    'artifacts/hybrid/v8-stage5-calibration-uncertainty',
  );
  return {
    version: V8_MONITORING_VERSION,
    generatedAt: now.toISOString(),
    status: alerts.some((row) => row.severity === 'CRITICAL') ? 'ATTENTION_REQUIRED' : 'MONITORING',
    alerts,
    coverage,
    horizonCounts,
    rejectionCounts,
    upcomingAndRecentDecisions: decisionRows.map((row) => ({
      id: row.id,
      providerFixtureId: row.providerFixtureId,
      localFixtureId: row.localFixtureId,
      horizonMinutes: row.horizonMinutes,
      decisionAsOf: row.decisionAsOf,
      kickoffAt: row.kickoffAt,
      decisionType: row.decisionType,
      selectedMarket: row.selectedMarket,
      selectedSelection: row.selectedSelection,
      lineValue: row.lineValue,
      decimalOdds: row.decimalOdds,
      modelProbability: row.modelProbability,
      fairMarketProbability: row.fairMarketProbability,
      edge: row.edge,
      expectedValue: row.expectedValue,
      modelVersion: row.modelVersion,
      policyVersion: row.policyVersion,
      decisionHash: row.decisionHash,
      candidateCount: row.candidateCount,
      rejectedCandidateCount: row.rejectedCandidateCount,
      settlement: row.settlement,
    })),
    recentSettlements: settlementRows.map((row) => ({
      decisionId: row.decisionId,
      providerFixtureId: row.providerFixtureId,
      result: row.result,
      profitUnits: row.profitUnits,
      clv: row.clv,
      settledAt: row.settledAt,
    })),
    freshness: {
      latestProviderRunAt: latestProviderRun?.startedAt ?? null,
      latestProviderRunStatus: latestProviderRun?.status ?? null,
      latestOddsObservedAt: latestOdds?.observedAt ?? null,
      latestLineupCapturedAt: latestLineup?.capturedAt ?? null,
      latestInjuryCapturedAt: latestInjury?.capturedAt ?? null,
    },
    lineage: {
      calibrationArtifactPath: calibration.path,
      calibrationArtifactHash: calibration.hash,
      calibrationManifest,
      backtestManifest,
      modelVersion: V8_PAPER_RUNTIME_VERSION,
      policyVersion: 'v8.0-stage6-best-bet-policy-v1',
    },
    drift: {
      calibration: coverage.settlements >= 100 ? 'EVALUATION_DUE' : 'INSUFFICIENT_PAPER_SAMPLE',
      model: coverage.decisions >= 100 ? 'EVALUATION_DUE' : 'INSUFFICIENT_PAPER_SAMPLE',
    },
    safety: {
      appendOnly: true,
      pointInTime: true,
      paperOnly: true,
      automaticPromotion: false,
      automaticBetPlacement: false,
      realMoneyExecution: false,
      externalApiCalled: false,
      currentChampionChanged: false,
    },
  };
}
