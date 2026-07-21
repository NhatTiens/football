import Link from 'next/link';

export function Header() {
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link href="/" className="brand">
          <span className="brand-mark">FA</span>
          <span>
            <strong>Football Value AI</strong>
            <small>Odds-driven decision support</small>
          </span>
        </Link>
        <nav className="navigation" aria-label="Điều hướng chính">
          <Link href="/">Tổng quan</Link>
          <Link href="/matches">Trận đấu</Link>
          <Link href="/recommendations">Khuyến nghị</Link>
          <Link href="/backtest">Backtest</Link>
        </nav>
      </div>
    </header>
  );
}
