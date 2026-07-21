import { clamp } from './math.js';

export type LineupPositionGroup =
  | 'GOALKEEPER'
  | 'DEFENDER'
  | 'MIDFIELDER'
  | 'ATTACKER'
  | 'UNKNOWN';

export interface MissingRegularPlayer {
  playerId: number;
  playerName: string;
  positionGroup: LineupPositionGroup;
  starts: number;
  historyMatches: number;
  startRate: number;
}

export interface TeamLineupEvidence {
  teamId: number;
  teamName: string;
  confirmed: boolean;
  starterCount: number;
  formation?: string | null;
  historyMatches: number;
  previousLineupOverlap: number | null;
  rotationCount: number | null;
  missingRegulars: MissingRegularPlayer[];
}

export interface LineupAnalysisRules {
  enabled: boolean;
  requireConfirmed: boolean;
  minimumHistoryMatches: number;
  rotationWarningThreshold: number;
  probabilityAdjustmentEnabled: boolean;
  maximumProbabilityAdjustment: number;
}

export interface LineupAdjustment {
  available: boolean;
  blockRecommendation: boolean;
  overProbabilityAdjustment: number;
  confidenceMultiplier: number;
  dataQualityMultiplier: number;
  reasons: string[];
  home: TeamLineupEvidence;
  away: TeamLineupEvidence;
}

function missingPlayerOverEffect(player: MissingRegularPlayer): number {
  const reliability = clamp(player.startRate, 0, 1);
  if (player.positionGroup === 'GOALKEEPER') return 0.008 * reliability;
  if (player.positionGroup === 'DEFENDER') return 0.004 * reliability;
  if (player.positionGroup === 'ATTACKER') return -0.006 * reliability;
  if (player.positionGroup === 'MIDFIELDER') return -0.001 * reliability;
  return 0;
}

function teamSummaryReason(team: TeamLineupEvidence): string {
  if (!team.confirmed) {
    return `${team.teamName}: chưa có đội hình chính thức.`;
  }

  const formation = team.formation ? `, sơ đồ ${team.formation}` : '';
  const rotation =
    team.rotationCount === null
      ? ''
      : `, thay đổi ${team.rotationCount} vị trí so với trận gần nhất`;
  return `${team.teamName}: ${team.starterCount} cầu thủ đá chính${formation}${rotation}.`;
}

function missingReason(team: TeamLineupEvidence): string | null {
  if (team.missingRegulars.length === 0) return null;
  const names = team.missingRegulars
    .slice(0, 4)
    .map((player) => `${player.playerName} (${Math.round(player.startRate * 100)}% đá chính)`)
    .join(', ');
  const suffix = team.missingRegulars.length > 4 ? ` và ${team.missingRegulars.length - 4} người khác` : '';
  return `${team.teamName}: vắng cầu thủ thường xuyên đá chính ${names}${suffix}.`;
}

export function analyzeFixtureLineups(input: {
  home: TeamLineupEvidence;
  away: TeamLineupEvidence;
  rules: LineupAnalysisRules;
}): LineupAdjustment {
  const { home, away, rules } = input;

  if (!rules.enabled) {
    return {
      available: false,
      blockRecommendation: false,
      overProbabilityAdjustment: 0,
      confidenceMultiplier: 1,
      dataQualityMultiplier: 1,
      reasons: ['Phân tích đội hình đã bị tắt trong cấu hình.'],
      home,
      away,
    };
  }

  const bothConfirmed = home.confirmed && away.confirmed;
  const anyConfirmed = home.confirmed || away.confirmed;
  const completeness = clamp((home.starterCount + away.starterCount) / 22, 0, 1);
  const requiredHistory = Math.max(1, rules.minimumHistoryMatches);
  const historyCoverage = clamp(
    (Math.min(home.historyMatches, requiredHistory) +
      Math.min(away.historyMatches, requiredHistory)) /
      (requiredHistory * 2),
    0,
    1,
  );

  const rotationCounts = [home.rotationCount, away.rotationCount].filter(
    (value): value is number => value !== null,
  );
  const excessRotation = rotationCounts.reduce(
    (sum, value) => sum + Math.max(0, value - rules.rotationWarningThreshold),
    0,
  );

  let confidenceMultiplier = 0.75 + 0.15 * completeness + 0.1 * historyCoverage;
  confidenceMultiplier -= Math.min(0.2, excessRotation * 0.04);
  if (!bothConfirmed) confidenceMultiplier *= 0.82;
  confidenceMultiplier = clamp(confidenceMultiplier, 0.55, 1);

  let dataQualityMultiplier = 0.65 + 0.2 * completeness + 0.15 * historyCoverage;
  if (!bothConfirmed) dataQualityMultiplier *= 0.82;
  dataQualityMultiplier = clamp(dataQualityMultiplier, 0.5, 1);

  const rawAdjustment = [...home.missingRegulars, ...away.missingRegulars].reduce(
    (sum, player) => sum + missingPlayerOverEffect(player),
    0,
  );
  const overProbabilityAdjustment = rules.probabilityAdjustmentEnabled
    ? clamp(
        rawAdjustment,
        -Math.abs(rules.maximumProbabilityAdjustment),
        Math.abs(rules.maximumProbabilityAdjustment),
      )
    : 0;

  const reasons = [teamSummaryReason(home), teamSummaryReason(away)];
  const homeMissing = missingReason(home);
  const awayMissing = missingReason(away);
  if (homeMissing) reasons.push(homeMissing);
  if (awayMissing) reasons.push(awayMissing);

  if (rules.probabilityAdjustmentEnabled && Math.abs(overProbabilityAdjustment) >= 0.0001) {
    reasons.push(
      `Điều chỉnh xác suất Over theo đội hình: ${overProbabilityAdjustment >= 0 ? '+' : ''}${(
        overProbabilityAdjustment * 100
      ).toFixed(2)} điểm %.`,
    );
  } else if (!rules.probabilityAdjustmentEnabled) {
    reasons.push('Đội hình chỉ điều chỉnh confidence/data quality; không tự thay đổi xác suất vì chế độ heuristic đang tắt.');
  }

  if (excessRotation > 0) {
    reasons.push('Đội hình xoay tua mạnh nên confidence bị giảm.');
  }

  const blockRecommendation = rules.requireConfirmed && !bothConfirmed;
  if (blockRecommendation) {
    reasons.push('Không tạo khuyến nghị vì cấu hình yêu cầu đội hình chính thức của cả hai đội.');
  }

  return {
    available: anyConfirmed,
    blockRecommendation,
    overProbabilityAdjustment,
    confidenceMultiplier,
    dataQualityMultiplier,
    reasons,
    home,
    away,
  };
}
