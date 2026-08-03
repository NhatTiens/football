import { prisma } from '@football-ai/database';

import {
  BETA_2A_1_DAILY_OUTCOME_REPORT_VERSION,
  beta2A1DailyWindow,
  beta2A1DefaultReportDay,
  buildBeta2A1DailyOutcomeReport,
} from './daily-outcome-report-core.js';
import { buildShadowSettlementRuntimeReport } from './shadow-settlement-report-cli.js';

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : (process.argv[index + 1] ?? null);
}

function providerFixtureArgument(): number | null {
  const raw = argument('--fixture');
  if (raw == null) return null;

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('--fixture must be a positive provider fixture id.');
  }

  return value;
}

function asOfArgument(): Date {
  const raw = argument('--as-of');
  if (raw == null) return new Date();

  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) {
    throw new Error('--as-of must be a valid ISO-8601 timestamp.');
  }

  return value;
}

async function main(): Promise<void> {
  const reportAsOf = asOfArgument();
  const reportDay = argument('--day') ?? beta2A1DefaultReportDay(reportAsOf);
  const providerFixtureId = providerFixtureArgument();
  const window = beta2A1DailyWindow(reportDay);

  if (reportAsOf.getTime() < window.start.getTime()) {
    throw new Error('--as-of cannot be earlier than the requested report day.');
  }

  const hours = Math.min(
    8760,
    Math.max(48, Math.ceil((reportAsOf.getTime() - window.start.getTime()) / 3_600_000) + 24),
  );
  const runtime = await buildShadowSettlementRuntimeReport({
    hours,
    providerFixtureId,
    reportAsOf,
  });
  const report = buildBeta2A1DailyOutcomeReport({
    reportDay,
    rows: runtime.rows,
  });
  const summaryOnly = process.argv.includes('--summary-only');

  console.log(
    JSON.stringify(
      {
        event: 'BETA_2A_1_DAILY_OUTCOME_REPORT',
        version: BETA_2A_1_DAILY_OUTCOME_REPORT_VERSION,
        generatedAt: reportAsOf.toISOString(),
        dayComplete: reportAsOf.getTime() >= window.endExclusive.getTime(),
        extraction: {
          lookbackHours: hours,
          providerFixtureId,
          sourceSnapshotRows: runtime.snapshots.length,
          persistedPaperCandidateRows: runtime.candidates.length,
          outcomeSnapshotRowsRead: runtime.outcomeSnapshots.length,
          closingOddsRowsRead: runtime.closingOddsSnapshots.length,
        },
        report: {
          ...report,
          rows: summaryOnly ? undefined : report.rows,
        },
        lineage: {
          decision: 'ScientificCurrentSignalSnapshot.analysisPayload.paperShadowRecommendation',
          outcome: 'ApiFootballFixtureSnapshot',
          closingProxy: 'ApiFootballOddsSnapshot@T-5',
          appendOnlyDerivedReadModel: true,
        },
      },
      null,
      2,
    ),
  );
}

let exitCode = 0;

try {
  await main();
} catch (error) {
  exitCode = 2;
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
} finally {
  await prisma.$disconnect();
  process.exitCode = exitCode;
}
