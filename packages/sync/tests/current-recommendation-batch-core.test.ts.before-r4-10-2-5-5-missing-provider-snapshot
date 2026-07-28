import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  chunkCurrentRecommendationFixtures,
  prioritizeCurrentRecommendationFixtures,
} from '../src/current-recommendation-batch-core.js';

describe(
  'R4.10.2.5 current recommendation batch core',
  () => {
    const now =
      new Date(
        '2026-07-28T12:20:00.000Z',
      );

    it(
      'prioritizes a fixture close to a scientific checkpoint',
      () => {
        const rows =
          prioritizeCurrentRecommendationFixtures({
            now,
            fixtures: [
              {
                providerFixtureId:
                  1,
                kickoffAt:
                  new Date(
                    '2026-07-29T12:20:00.000Z',
                  ),
              },
              {
                providerFixtureId:
                  2,
                kickoffAt:
                  new Date(
                    '2026-07-28T13:00:00.000Z',
                  ),
              },
            ],
            signals: {
              recentRawAttemptFixtureIds:
                new Set<number>(),
              pitOddsFixtureIds:
                new Set<number>(),
            },
          });

        expect(
          rows[0]
            ?.providerFixtureId,
        ).toBe(2);

        expect(
          rows[0]
            ?.priorityReason,
        ).toBe(
          'CHECKPOINT_NEAR',
        );
      },
    );

    it(
      'prioritizes a recent raw attempt before an ordinary PIT-odds fixture',
      () => {
        const rows =
          prioritizeCurrentRecommendationFixtures({
            now,
            fixtures: [
              {
                providerFixtureId:
                  10,
                kickoffAt:
                  new Date(
                    '2026-07-29T10:00:00.000Z',
                  ),
              },
              {
                providerFixtureId:
                  11,
                kickoffAt:
                  new Date(
                    '2026-07-29T09:00:00.000Z',
                  ),
              },
            ],
            signals: {
              recentRawAttemptFixtureIds:
                new Set<number>([
                  10,
                ]),
              pitOddsFixtureIds:
                new Set<number>([
                  11,
                ]),
            },
            checkpointPriorityWindowMinutes:
              1,
          });

        expect(
          rows.map(
            (row) =>
              row.providerFixtureId,
          ),
        ).toEqual([
          10,
          11,
        ]);
      },
    );

    it(
      'uses kickoff order as the deterministic final tie-break',
      () => {
        const rows =
          prioritizeCurrentRecommendationFixtures({
            now,
            fixtures: [
              {
                providerFixtureId:
                  22,
                kickoffAt:
                  new Date(
                    '2026-07-30T12:00:00.000Z',
                  ),
              },
              {
                providerFixtureId:
                  21,
                kickoffAt:
                  new Date(
                    '2026-07-29T12:00:00.000Z',
                  ),
              },
            ],
            signals: {
              recentRawAttemptFixtureIds:
                new Set<number>(),
              pitOddsFixtureIds:
                new Set<number>(),
            },
            checkpointPriorityWindowMinutes:
              1,
          });

        expect(
          rows.map(
            (row) =>
              row.providerFixtureId,
          ),
        ).toEqual([
          21,
          22,
        ]);
      },
    );

    it(
      'splits a large batch without dropping order or fixtures',
      () => {
        expect(
          chunkCurrentRecommendationFixtures(
            [
              1,
              2,
              3,
              4,
              5,
            ],
            2,
          ),
        ).toEqual([
          [
            1,
            2,
          ],
          [
            3,
            4,
          ],
          [
            5,
          ],
        ]);
      },
    );

    it(
      'rejects an invalid chunk size',
      () => {
        expect(
          () =>
            chunkCurrentRecommendationFixtures(
              [
                1,
              ],
              0,
            ),
        ).toThrow(
          'chunkSize must be a positive integer.',
        );
      },
    );
  },
);
