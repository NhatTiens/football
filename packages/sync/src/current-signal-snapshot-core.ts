export const CURRENT_SIGNAL_SNAPSHOT_LEDGER_VERSION =
  'v7.0-r4.10.3-current-signal-snapshot-ledger-v1';

export const DEFAULT_CURRENT_SIGNAL_CHECKPOINTS =
  [180, 90, 60, 30, 5] as const;

export type CurrentSignalAnalysisStatus =
  | 'AVAILABLE'
  | 'NO_FRESH_PIT_ODDS'
  | 'UNMAPPED_FIXTURE'
  | 'MAPPING_MISMATCH'
  | 'NO_MODEL'
  | 'NO_COMPLETE_MARKET'
  | 'NO_VALUE_SIGNAL';

export type CurrentSignalSnapshotAction =
  | 'NOT_DUE'
  | 'ALREADY_CAPTURED'
  | 'WAIT_FOR_DATA'
  | 'CAPTURE_ANALYSIS'
  | 'CAPTURE_FINAL_STATUS';

export interface CurrentSignalDueEvaluation {
  checkpointMinutes: number | null;
  exactMinutesToKickoff: number;
  distanceMinutes: number | null;
  action: CurrentSignalSnapshotAction;
  reason: string;
}

function integerList(
  raw: string | undefined,
): number[] {
  if (
    raw == null ||
    raw.trim() === ''
  ) {
    return [
      ...DEFAULT_CURRENT_SIGNAL_CHECKPOINTS,
    ];
  }

  const values =
    raw
      .split(',')
      .map(
        (value: string): number =>
          Number(value.trim()),
      )
      .filter(
        (value: number): boolean =>
          Number.isSafeInteger(value) &&
          value >= 1 &&
          value <= 1440,
      );

  return [
    ...new Set(values),
  ].sort(
    (
      left: number,
      right: number,
    ): number =>
      right - left,
  );
}

export function parseCurrentSignalCheckpoints(
  raw =
    process.env
      .CURRENT_SIGNAL_SNAPSHOT_HORIZONS_MINUTES,
): number[] {
  const values =
    integerList(raw);

  if (values.length === 0) {
    throw new Error(
      'CURRENT_SIGNAL_SNAPSHOT_HORIZONS_MINUTES must contain at least one integer from 1 to 1440.',
    );
  }

  return values;
}

export function currentSignalCheckpointLabel(
  checkpointMinutes: number,
): string {
  return `T-${checkpointMinutes}`;
}

export function exactMinutesToKickoff(
  kickoffAt: Date,
  now: Date,
): number {
  return (
    kickoffAt.getTime() -
    now.getTime()
  ) /
  60_000;
}

export function nearestDueCheckpoint(input: {
  kickoffAt: Date;
  now: Date;
  checkpoints: number[];
  toleranceMinutes: number;
}): {
  checkpointMinutes: number;
  exactMinutesToKickoff: number;
  distanceMinutes: number;
} | null {
  const exactMinutes =
    exactMinutesToKickoff(
      input.kickoffAt,
      input.now,
    );

  const matches =
    input.checkpoints
      .map(
        (
          checkpointMinutes: number,
        ) => ({
          checkpointMinutes,
          exactMinutesToKickoff:
            exactMinutes,
          distanceMinutes:
            Math.abs(
              exactMinutes -
              checkpointMinutes,
            ),
        }),
      )
      .filter(
        (
          item,
        ): boolean =>
          item.distanceMinutes <=
          input.toleranceMinutes,
      )
      .sort(
        (
          left,
          right,
        ): number =>
          left.distanceMinutes -
            right.distanceMinutes ||
          right.checkpointMinutes -
            left.checkpointMinutes,
      );

  return matches[0] ?? null;
}

export function isTerminalCurrentSignalStatus(
  status: CurrentSignalAnalysisStatus,
): boolean {
  return (
    status === 'AVAILABLE' ||
    status === 'NO_VALUE_SIGNAL'
  );
}

export function evaluateCurrentSignalSnapshotDue(input: {
  kickoffAt: Date;
  now: Date;
  checkpoints: number[];
  toleranceMinutes: number;
  status: CurrentSignalAnalysisStatus;
  alreadyCaptured: boolean;
}): CurrentSignalDueEvaluation {
  const due =
    nearestDueCheckpoint({
      kickoffAt:
        input.kickoffAt,
      now:
        input.now,
      checkpoints:
        input.checkpoints,
      toleranceMinutes:
        input.toleranceMinutes,
    });

  const exactMinutes =
    exactMinutesToKickoff(
      input.kickoffAt,
      input.now,
    );

  if (due == null) {
    return {
      checkpointMinutes: null,
      exactMinutesToKickoff:
        exactMinutes,
      distanceMinutes: null,
      action: 'NOT_DUE',
      reason:
        'NO_CHECKPOINT_WITHIN_TOLERANCE',
    };
  }

  if (input.alreadyCaptured) {
    return {
      ...due,
      action:
        'ALREADY_CAPTURED',
      reason:
        'APPEND_ONLY_CHECKPOINT_ALREADY_EXISTS',
    };
  }

  const terminalCaptureBoundary =
    due.checkpointMinutes +
    Math.min(
      0.25,
      input.toleranceMinutes /
        4,
    );

  if (
    isTerminalCurrentSignalStatus(
      input.status,
    )
  ) {
    if (
      due.exactMinutesToKickoff >
      terminalCaptureBoundary
    ) {
      return {
        ...due,
        action:
          'WAIT_FOR_DATA',
        reason:
          'WAIT_UNTIL_CHECKPOINT_TIME',
      };
    }

    return {
      ...due,
      action:
        'CAPTURE_ANALYSIS',
      reason:
        'CURRENT_ANALYSIS_TERMINAL_AT_CHECKPOINT',
    };
  }

  const finalizationBoundary =
    due.checkpointMinutes -
    input.toleranceMinutes +
    Math.min(
      0.25,
      input.toleranceMinutes /
        4,
    );

  if (
    due.exactMinutesToKickoff <=
    finalizationBoundary
  ) {
    return {
      ...due,
      action:
        'CAPTURE_FINAL_STATUS',
      reason:
        'CHECKPOINT_WINDOW_CLOSING',
    };
  }

  return {
    ...due,
    action:
      'WAIT_FOR_DATA',
    reason:
      'TRANSIENT_STATUS_RETRY_WITHIN_CHECKPOINT_WINDOW',
  };
}
