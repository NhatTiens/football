export function percent(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function signedPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const percentage = value * 100;
  return `${percentage >= 0 ? '+' : ''}${percentage.toFixed(digits)}%`;
}

export function dateTime(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value));
}

export function confidenceLabel(value: number): string {
  if (value >= 0.8) return 'Rất cao';
  if (value >= 0.68) return 'Cao';
  if (value >= 0.55) return 'Trung bình';
  return 'Thấp';
}
