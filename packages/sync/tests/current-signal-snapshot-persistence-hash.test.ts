import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  prepareCurrentSignalSnapshotPayloadForPersistence,
} from '../src/current-signal-snapshot-engine.js';
import {
  currentSignalPayloadHash,
} from '../src/current-signal-runtime-evidence-core.js';

describe(
  'R4.10.3.3.1 persisted current-signal snapshot payload hash',
  () => {
    it(
      'hashes exactly the JSON payload that will be stored',
      () => {
        const sourcePayload = {
          at:
            new Date(
              '2026-07-29T04:30:00.000Z',
            ),
          nested: {
            defined:
              true,
            omitted:
              undefined,
          },
          rows: [
            {
              capturedAt:
                new Date(
                  '2026-07-29T04:20:00.000Z',
                ),
            },
          ],
        };

        const prepared =
          prepareCurrentSignalSnapshotPayloadForPersistence(
            sourcePayload,
          );

        const independentlySerialized =
          JSON.parse(
            JSON.stringify(
              sourcePayload,
            ),
          );

        expect(
          prepared.persistedPayload,
        ).toEqual(
          independentlySerialized,
        );

        expect(
          prepared.snapshotHash,
        ).toBe(
          currentSignalPayloadHash(
            independentlySerialized,
          ),
        );
      },
    );

    it(
      'does not mutate the source payload',
      () => {
        const sourceDate =
          new Date(
            '2026-07-29T04:30:00.000Z',
          );

        const sourcePayload = {
          at:
            sourceDate,
        };

        const prepared =
          prepareCurrentSignalSnapshotPayloadForPersistence(
            sourcePayload,
          );

        expect(
          sourcePayload.at,
        ).toBe(
          sourceDate,
        );

        expect(
          (
            prepared
              .persistedPayload as {
                at: string;
              }
          ).at,
        ).toBe(
          sourceDate.toISOString(),
        );
      },
    );
  },
);
