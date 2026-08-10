import Link from 'next/link';

export function Header() {
  return (
    <header className="site-header pcr-header">
      <div className="container header-inner">
        <Link href="/" className="brand">
          <span className="brand-mark">FA</span>
          <span>
            <strong>Football AI v7</strong>
            <small>Personal research console</small>
          </span>
        </Link>

        <nav className="navigation pcr-navigation" aria-label="Điều hướng chính">
          <Link href="/">Tổng quan</Link>
          <Link href="/predictions">Dự đoán & BEST BET</Link>
          <Link href="/backtest">Backtest</Link>
          <Link href="/matches">Trận đấu</Link>
          <Link href="/bet-history">Lịch sử</Link>
          <Link href="/v8-monitoring">v8 Monitor</Link>
        </nav>
      </div>
    </header>
  );
}
