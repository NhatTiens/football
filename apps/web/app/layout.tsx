import type { Metadata } from 'next';
import { Header } from '../components/Header';
import { Disclaimer } from '../components/Disclaimer';
import './globals.css';

export const metadata: Metadata = {
  title: 'Football Value AI',
  description: 'Nền tảng phân tích odds, xác suất, edge và Expected Value.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        <Header />
        <main className="container main-content">{children}</main>
        <footer className="container footer">
          <Disclaimer />
          <p>Football Value AI · MVP nguồn mở nội bộ</p>
        </footer>
      </body>
    </html>
  );
}
