import {
  aggregateShadowSettlements,
  type ShadowReliabilityReport,
  type ShadowSettlementRow,
} from './shadow-settlement-core.js';

export const BETA_2A_1_DAILY_OUTCOME_REPORT_VERSION = 'v7.0-beta.2a.1-daily-outcome-report-v1';

export const BETA_2A_1_REPORT_TIME_ZONE = 'Asia/Ho_Chi_Minh' as const;

export interface DailyProbabilityMetrics {
  eligibleRows: number;
  averageProbability: number | null;
  brierScore: number | null;
  logLoss: number | null;
  meanCalibrationError: number | null;
}

export interface Beta2A1DailyOutcomeReport {
  version: string;
  reportDay: string;
  timeZone: typeof BETA_2A_1_REPORT_TIME_ZONE;
  window: {
    startUtc: string;
    endUtcExclusive: string;
  };
  coverage: {
    sourceRows: number;
    rowsInDailyWindow: number;
    settledRows: number;
    pendingRows: number;
    invalidLineageRows: number;
    outcomeCoverageRate: number | null;
    clvEligibleRows: number;
    clvCoverageRate: number | null;
  };
  probability: {
    raw: DailyProbabilityMetrics;
    paper: DailyProbabilityMetrics;
    brierDeltaPaperMinusRaw: number | null;
    logLossDeltaPaperMinusRaw: number | null;
    paperCalibrationImproved: boolean | null;
  };
  reliability: ShadowReliabilityReport;
  rows: ShadowSettlementRow[];
  readiness: {
    settledRows: number;
    diagnosticTargetRows: 30;
    promotionTargetRows: 150;
    diagnosticProgressRate: number;
    promotionProgressRate: number;
    status: 'NO_SETTLED_SAMPLE' | 'ACCUMULATING_DIAGNOSTIC_SAMPLE' | 'DIAGNOSTIC_SAMPLE_AVAILABLE';
    automaticPromotion: false;
  };
  safety: {
    appendOnlySource: true;
    derivedReadModel: true;
    pitSafe: true;
    paperOnly: true;
    historicalRowsRewritten: false;
    databaseWritten: false;
    externalApiCalled: false;
    officialBestBetChanged: false;
    automaticPromotion: false;
    automaticBetPlacement: false;
    realMoneyExecution: false;
  };
}

function mean(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value): number => sum + value, 0) / values.length;
}

function clampProbability(value: number): number {
  return Math.max(1e-9, Math.min(1 - 1e-9, value));
}

function validProbability(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function probabilityMetrics(
  rows: readonly ShadowSettlementRow[],
  probability: (row: ShadowSettlementRow) => number | null | undefined,
): DailyProbabilityMetrics {
  const eligible = rows
    .filter(
      (row): boolean =>
        row.status === 'SETTLED' &&
        (row.settlementResult === 'WIN' || row.settlementResult === 'LOSS'),
    )
    .map((row) => ({
      probability: probability(row),
      actual: row.settlementResult === 'WIN' ? 1 : 0,
    }))
    .filter((row): row is { probability: number; actual: number } =>
      validProbability(row.probability),
    );

  const averageProbability = mean(eligible.map((row) => row.probability));
  const brierScore = mean(eligible.map((row) => (row.probability - row.actual) ** 2));
  const logLoss = mean(
    eligible.map((row) => {
      const bounded = clampProbability(row.probability);
      return -(row.actual * Math.log(bounded) + (1 - row.actual) * Math.log(1 - bounded));
    }),
  );
  const meanCalibrationError = mean(eligible.map((row) => row.probability - row.actual));

  return {
    eligibleRows: eligible.length,
    averageProbability,
    brierScore,
    logLoss,
    meanCalibrationError,
  };
}

export function beta2A1DailyWindow(reportDay: string): {
  start: Date;
  endExclusive: Date;
} {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDay)) {
    throw new Error('reportDay must use YYYY-MM-DD.');
  }

  const start = new Date(`${reportDay}T00:00:00+07:00`);
  if (Number.isNaN(start.getTime())) {
    throw new Error('reportDay is not a valid calendar day.');
  }

  const normalized = new Intl.DateTimeFormat('en-CA', {
    timeZone: BETA_2A_1_REPORT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(start);

  if (normalized !== reportDay) {
    throw new Error('reportDay is not a valid calendar day.');
  }

  return {
    start,
    endExclusive: new Date(start.getTime() + 24 * 3_600_000),
  };
}

export function beta2A1DefaultReportDay(asOf: Date): string {
  const previousDay = new Date(asOf.getTime() - 24 * 3_600_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BETA_2A_1_REPORT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(previousDay);
}

export function buildBeta2A1DailyOutcomeReport(input: {
  reportDay: string;
  rows: readonly ShadowSettlementRow[];
}): Beta2A1DailyOutcomeReport {
  const window = beta2A1DailyWindow(input.reportDay);
  const rows = input.rows
    .filter((row) => {
      const kickoff = new Date(row.kickoffAt).getTime();
      return kickoff >= window.start.getTime() && kickoff < window.endExclusive.getTime();
    })
    .slice()
    .sort(
      (left, right): number =>
        new Date(left.kickoffAt).getTime() - new Date(right.kickoffAt).getTime() ||
        left.providerFixtureId - right.providerFixtureId ||
        right.checkpointMinutes - left.checkpointMinutes ||
        left.snapshotId - right.snapshotId,
    );
  const reliability = aggregateShadowSettlements(rows);
  const settledRows = reliability.overall.settled;
  const pendingRows = reliability.overall.pending;
  const validRows = rows.length - reliability.overall.invalidLineage;
  const raw = probabilityMetrics(rows, (row) => row.rawModelProbability);
  const paper = probabilityMetrics(rows, (row) => row.paperModelProbability);
  const brierDeltaPaperMinusRaw =
    raw.brierScore == null || paper.brierScore == null ? null : paper.brierScore - raw.brierScore;
  const logLossDeltaPaperMinusRaw =
    raw.logLoss == null || paper.logLoss == null ? null : paper.logLoss - raw.logLoss;

  return {
    version: BETA_2A_1_DAILY_OUTCOME_REPORT_VERSION,
    reportDay: input.reportDay,
    timeZone: BETA_2A_1_REPORT_TIME_ZONE,
    window: {
      startUtc: window.start.toISOString(),
      endUtcExclusive: window.endExclusive.toISOString(),
    },
    coverage: {
      sourceRows: input.rows.length,
      rowsInDailyWindow: rows.length,
      settledRows,
      pendingRows,
      invalidLineageRows: reliability.overall.invalidLineage,
      outcomeCoverageRate: validRows > 0 ? settledRows / validRows : null,
      clvEligibleRows: reliability.overall.clvEligible,
      clvCoverageRate: settledRows > 0 ? reliability.overall.clvEligible / settledRows : null,
    },
    probability: {
      raw,
      paper,
      brierDeltaPaperMinusRaw,
      logLossDeltaPaperMinusRaw,
      paperCalibrationImproved:
        brierDeltaPaperMinusRaw == null || logLossDeltaPaperMinusRaw == null
          ? null
          : brierDeltaPaperMinusRaw < 0 && logLossDeltaPaperMinusRaw < 0,
    },
    reliability,
    rows,
    readiness: {
      settledRows,
      diagnosticTargetRows: 30,
      promotionTargetRows: 150,
      diagnosticProgressRate: Math.min(1, settledRows / 30),
      promotionProgressRate: Math.min(1, settledRows / 150),
      status:
        settledRows === 0
          ? 'NO_SETTLED_SAMPLE'
          : settledRows < 30
            ? 'ACCUMULATING_DIAGNOSTIC_SAMPLE'
            : 'DIAGNOSTIC_SAMPLE_AVAILABLE',
      automaticPromotion: false,
    },
    safety: {
      appendOnlySource: true,
      derivedReadModel: true,
      pitSafe: true,
      paperOnly: true,
      historicalRowsRewritten: false,
      databaseWritten: false,
      externalApiCalled: false,
      officialBestBetChanged: false,
      automaticPromotion: false,
      automaticBetPlacement: false,
      realMoneyExecution: false,
    },
  };
}
