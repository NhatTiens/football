export type HistoryReplayStatus =
  | 'NOT_OU'
  | 'CURRENT_MODEL_RESULT'
  | 'REPLAYED_AS_MODEL_RESULT'
  | 'MISSING_SOURCE_AUDIT'
  | 'MISSING_TARGET_PIT_ODDS';

export function unresolvedHistoryLabel(
  input: {
    historyReplayStatus: HistoryReplayStatus;
    historyStrategyEligible: boolean;
    kickoffAt: string;
  },
  reportAsOf: number,
): string {
  if (!input.historyStrategyEligible) {
    if (input.historyReplayStatus === 'MISSING_SOURCE_AUDIT') {
      return 'Thiếu audit nguồn';
    }

    if (input.historyReplayStatus === 'MISSING_TARGET_PIT_ODDS') {
      return 'Thiếu odds PIT phù hợp';
    }

    return 'Dữ liệu lịch sử chưa hợp lệ';
  }

  return new Date(input.kickoffAt).getTime() > reportAsOf ? 'Chờ trận đấu' : 'Chờ kết quả';
}
