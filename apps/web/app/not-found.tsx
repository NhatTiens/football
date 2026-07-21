import Link from 'next/link';

export default function NotFound() {
  return <div className="empty-state"><h1>Không tìm thấy dữ liệu</h1><p>Trận đấu không tồn tại hoặc API chưa đồng bộ.</p><Link className="button primary" href="/matches">Quay lại danh sách</Link></div>;
}
