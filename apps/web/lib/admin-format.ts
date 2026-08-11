export function formatAdminMoney(value: number | null | undefined): string {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

export function formatAdminDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

export function adminPaymentLabel(status: string): string {
  if (status === 'PAID') return 'Đã thanh toán';
  if (status === 'PENDING') return 'Đang chờ';
  if (status === 'EXPIRED') return 'Hết hạn';
  if (status === 'CANCELLED') return 'Đã hủy';
  return status;
}

export function adminSubscriptionLabel(status: string): string {
  if (status === 'ACTIVE') return 'Đang hoạt động';
  if (status === 'EXPIRED') return 'Hết hạn';
  if (status === 'REVOKED') return 'Đã thu hồi';
  return status;
}

export function adminUserStatusLabel(status: string): string {
  if (status === 'ACTIVE') return 'Hoạt động';
  if (status === 'DISABLED') return 'Đã khóa';
  if (status === 'PENDING_VERIFICATION') return 'Chờ xác minh';
  return status;
}

export function adminMetadataText(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string') return value;

  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}
