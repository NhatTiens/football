export function formatAccountDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function remainingEntitlementText(
  value: string | null | undefined,
  nowMs = Date.now(),
): string {
  if (!value) return 'Không có thời hạn PRO';

  const expiry = new Date(value).getTime();
  if (!Number.isFinite(expiry) || expiry <= nowMs) return 'Đã hết hạn';

  const remainingMs = expiry - nowMs;
  const totalHours = Math.ceil(remainingMs / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  if (days > 0 && hours > 0) return `Còn ${days} ngày ${hours} giờ`;
  if (days > 0) return `Còn ${days} ngày`;
  return `Còn ${Math.max(1, hours)} giờ`;
}

export function quotaPercent(used: number, limit: number | null): number | null {
  if (limit == null) return null;
  if (limit <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
}

export function quotaValue(value: number | null): string {
  return value == null ? 'Không giới hạn' : new Intl.NumberFormat('vi-VN').format(value);
}

export function billingStatusLabel(status: string): string {
  if (status === 'PAID') return 'Đã thanh toán';
  if (status === 'EXPIRED') return 'Đã hết hạn';
  if (status === 'CANCELLED') return 'Đã hủy';
  return 'Chờ thanh toán';
}

export function subscriptionStatusLabel(status: string): string {
  if (status === 'ACTIVE') return 'Đang hoạt động';
  if (status === 'EXPIRED') return 'Đã hết hạn';
  if (status === 'REVOKED') return 'Đã thu hồi';
  return status;
}
