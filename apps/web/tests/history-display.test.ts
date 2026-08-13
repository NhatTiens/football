import { describe, expect, it } from 'vitest';

import { unresolvedHistoryLabel } from '../lib/history-display';

describe('History status labels', () => {
  const reportAsOf = Date.parse('2026-08-12T12:00:00.000Z');

  it('does not call invalid legacy rows pending results', () => {
    expect(
      unresolvedHistoryLabel(
        {
          historyReplayStatus: 'MISSING_SOURCE_AUDIT',
          historyStrategyEligible: false,
          kickoffAt: '2026-08-10T12:00:00.000Z',
        },
        reportAsOf,
      ),
    ).toBe('Thiếu audit nguồn');

    expect(
      unresolvedHistoryLabel(
        {
          historyReplayStatus: 'MISSING_TARGET_PIT_ODDS',
          historyStrategyEligible: false,
          kickoffAt: '2026-08-10T12:00:00.000Z',
        },
        reportAsOf,
      ),
    ).toBe('Thiếu odds PIT phù hợp');
  });

  it('keeps genuine upcoming and pending-result states', () => {
    expect(
      unresolvedHistoryLabel(
        {
          historyReplayStatus: 'CURRENT_MODEL_RESULT',
          historyStrategyEligible: true,
          kickoffAt: '2026-08-13T12:00:00.000Z',
        },
        reportAsOf,
      ),
    ).toBe('Chờ trận đấu');

    expect(
      unresolvedHistoryLabel(
        {
          historyReplayStatus: 'CURRENT_MODEL_RESULT',
          historyStrategyEligible: true,
          kickoffAt: '2026-08-11T12:00:00.000Z',
        },
        reportAsOf,
      ),
    ).toBe('Chờ kết quả');
  });
});
