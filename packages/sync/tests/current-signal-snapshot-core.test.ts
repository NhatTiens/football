import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  evaluateCurrentSignalSnapshotDue,
  nearestDueCheckpoint,
  parseCurrentSignalCheckpoints,
} from '../src/current-signal-snapshot-core.js';

describe(
  'R4.10.3 current signal snapshot core',
  () => {
    it(
      'parses deterministic default checkpoints',
      () => {
        expect(
          parseCurrentSignalCheckpoints(
            undefined,
          ),
        ).toEqual([
          180,
          90,
          60,
          30,
          5,
        ]);
      },
    );

    it(
      'finds the nearest due checkpoint within tolerance',
      () => {
        const now =
          new Date(
            '2026-07-28T07:00:30.000Z',
          );

        const kickoffAt =
          new Date(
            '2026-07-28T10:00:00.000Z',
          );

        expect(
          nearestDueCheckpoint({
            kickoffAt,
            now,
            checkpoints: [
              180,
              90,
              60,
              30,
              5,
            ],
            toleranceMinutes: 2,
          }),
        ).toMatchObject({
          checkpointMinutes: 180,
          exactMinutesToKickoff:
            179.5,
          distanceMinutes: 0.5,
        });
      },
    );

    it(
      'waits until close to the checkpoint even when AVAILABLE arrives early in tolerance',
      () => {
        const result =
          evaluateCurrentSignalSnapshotDue({
            kickoffAt:
              new Date(
                '2026-07-28T10:00:00.000Z',
              ),
            now:
              new Date(
                '2026-07-28T06:58:30.000Z',
              ),
            checkpoints: [
              180,
            ],
            toleranceMinutes: 2,
            status:
              'AVAILABLE',
            alreadyCaptured:
              false,
          });

        expect(
          result.action,
        ).toBe(
          'WAIT_FOR_DATA',
        );

        expect(
          result.reason,
        ).toBe(
          'WAIT_UNTIL_CHECKPOINT_TIME',
        );
      },
    );

    it(
      'captures AVAILABLE immediately inside the checkpoint window',
      () => {
        const result =
          evaluateCurrentSignalSnapshotDue({
            kickoffAt:
              new Date(
                '2026-07-28T10:00:00.000Z',
              ),
            now:
              new Date(
                '2026-07-28T07:00:30.000Z',
              ),
            checkpoints: [
              180,
              90,
              60,
              30,
              5,
            ],
            toleranceMinutes: 2,
            status:
              'AVAILABLE',
            alreadyCaptured:
              false,
          });

        expect(
          result.action,
        ).toBe(
          'CAPTURE_ANALYSIS',
        );
      },
    );

    it(
      'waits for transient missing data before the checkpoint window closes',
      () => {
        const result =
          evaluateCurrentSignalSnapshotDue({
            kickoffAt:
              new Date(
                '2026-07-28T10:00:00.000Z',
              ),
            now:
              new Date(
                '2026-07-28T06:59:00.000Z',
              ),
            checkpoints: [
              180,
            ],
            toleranceMinutes: 2,
            status:
              'NO_FRESH_PIT_ODDS',
            alreadyCaptured:
              false,
          });

        expect(
          result.action,
        ).toBe(
          'WAIT_FOR_DATA',
        );
      },
    );

    it(
      'captures the final transient status when the checkpoint window is closing',
      () => {
        const result =
          evaluateCurrentSignalSnapshotDue({
            kickoffAt:
              new Date(
                '2026-07-28T10:00:00.000Z',
              ),
            now:
              new Date(
                '2026-07-28T07:01:50.000Z',
              ),
            checkpoints: [
              180,
            ],
            toleranceMinutes: 2,
            status:
              'NO_MODEL',
            alreadyCaptured:
              false,
          });

        expect(
          result.action,
        ).toBe(
          'CAPTURE_FINAL_STATUS',
        );
      },
    );

    it(
      'never captures a second row for an existing fixture/checkpoint',
      () => {
        const result =
          evaluateCurrentSignalSnapshotDue({
            kickoffAt:
              new Date(
                '2026-07-28T10:00:00.000Z',
              ),
            now:
              new Date(
                '2026-07-28T07:00:00.000Z',
              ),
            checkpoints: [
              180,
            ],
            toleranceMinutes: 2,
            status:
              'AVAILABLE',
            alreadyCaptured:
              true,
          });

        expect(
          result.action,
        ).toBe(
          'ALREADY_CAPTURED',
        );
      },
    );
  },
);
