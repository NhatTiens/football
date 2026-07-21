'use client';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="empty-state"><h1>Không thể tải dữ liệu</h1><p>Hãy kiểm tra API và kết nối MySQL.</p><button className="button primary" onClick={() => reset()}>Thử lại</button></div>;
}
