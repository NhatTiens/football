# Football Value AI — Odds + Lineup Analysis + Point-in-time Backtest

MVP dùng **Next.js + React + Node.js/Express + MySQL/Prisma** để lưu odds, ước lượng xác suất, tính edge/EV và kiểm định recommendation bằng backtest không dùng dữ liệu tương lai.

> Đây là công cụ hỗ trợ nghiên cứu xác suất. Không bảo đảm lợi nhuận, không tự động đặt cược và không thay thế việc đánh giá pháp lý/dữ liệu tại thị trường vận hành.


## Bản 1.2 bổ sung đội hình

- Đồng bộ `fixtures/lineups` thành snapshot, không ghi đè lịch sử.
- Lưu cầu thủ đá chính, dự bị, vị trí, số áo, sơ đồ và huấn luyện viên.
- Phân tích độ ổn định đội hình, số vị trí xoay tua và cầu thủ thường xuyên đá chính bị vắng.
- Có thể yêu cầu đủ đội hình chính thức của cả hai đội trước khi tạo Over/Under recommendation.
- Điều chỉnh xác suất đội hình có giới hạn và hiển thị rõ trong reasons.
- Backtest chỉ dùng lineup snapshot tồn tại trước `predictedAt`, tránh data leakage.

Xem `docs/LINEUPS.md`.

## Bản 1.1 bổ sung

- Giao diện match/market tối giản theo phong cách phòng thí nghiệm dữ liệu.
- Bảng market hiển thị odds tốt nhất, P(model), P(market), edge và EV trên cùng một hàng.
- Bet slip mô phỏng, không gửi lệnh cược thật.
- Backtest point-in-time có UI và REST API.
- Lưu `BacktestRun` và từng `BacktestBet` trong MySQL.
- Hit rate, profit, ROI, yield, average odds, maximum drawdown và Brier score.
- Equity curve và thống kê theo từng market.
- Root `.env` được tự động nạp cho Prisma, API và worker; không cần chép `.env` vào từng workspace.

## Chức năng cốt lõi

- Đồng bộ leagues, teams, fixtures, pre-match odds và API-Football predictions.
- Odds được lưu thành snapshot, không ghi đè lịch sử.
- Market MVP: 1X2, Over/Under 2.5 và BTTS.
- Poisson baseline, market no-vig consensus, best odds, edge, EV, confidence và data quality.
- Recommendation expiration, settlement và correlation filtering.
- Express API, Swagger, Next.js dashboard, cron worker, Docker và CI.

## Chạy nhanh trên Windows

Nên giải nén ngoài OneDrive, ví dụ `C:\dev\football-ai-platform-scientific`.

```powershell
Copy-Item .env.example .env
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\windows-clean-install.ps1

docker compose up -d mysql
npm run db:push
npm run db:seed
npm run worker -- generate
npm run worker -- backtest
npm run dev
```

Mở:

- Web: `http://localhost:3000`
- Match market: chọn một trận tại `/matches`
- Backtest: `http://localhost:3000/backtest`
- API: `http://localhost:4000/api`
- Swagger: `http://localhost:4000/api/docs`

## Chạy local trên macOS/Linux

```bash
cp .env.example .env
npm install
npm run db:generate
npm run db:push
npm run db:seed
npm run worker -- generate
npm run worker -- backtest
npm run dev
```

Các root script tự đọc `.env` bằng `scripts/run-with-env.mjs`.

## Dùng API-Football thật

```dotenv
API_FOOTBALL_KEY="your-new-private-key"
API_FOOTBALL_LEAGUES="39:2024,140:2024"
API_FOOTBALL_FIXTURES_FROM="2024-08-01"
API_FOOTBALL_FIXTURES_TO="2025-05-31"
```

Season phải nằm trong quyền truy cập của gói API. Chạy:

```bash
npm run worker -- sync-fixtures
npm run worker -- sync-odds
npm run worker -- sync-predictions
npm run worker -- generate
npm run worker -- settle
```

## Backtest

```bash
npm run worker -- backtest
```

Hoặc mở `/backtest`, nhập `ADMIN_API_TOKEN` và chạy từ giao diện. Xem chi tiết tại [`docs/BACKTEST.md`](docs/BACKTEST.md).

Backtest chỉ sử dụng:

- fixture lịch sử trước trận đang kiểm tra;
- odds snapshot trước kickoff;
- external prediction được ghi nhận trước kickoff.

Sau khi candidate được tạo, kết quả thật mới được dùng để settlement.

## Công thức

```text
Implied Probability = 1 / Decimal Odds
Fair Probability = Implied Probability / Tổng implied probability của market
Edge = Model Probability - Fair Market Probability
Expected Value = Model Probability × Decimal Odds - 1
Hit Rate = Wins / (Wins + Losses)
ROI = Profit / Total Stake
```

## Kiểm tra source

```bash
npm run verify
```

Kết quả bàn giao:

- TypeScript workspace: PASS
- Vitest: 6/6 PASS
- ESLint: PASS
- Next.js production build: PASS

## Cấu trúc

```text
apps/
  api/       REST API và backtest endpoints
  worker/    Scheduler, sync, generate, settle, backtest CLI
  web/       Next.js scientific dashboard
packages/
  database/  Prisma schema, migration, demo seed
  api-football/
  engine/    Poisson, no-vig, EV, confidence, settlement
  sync/      Data workflows và point-in-time backtest
```

## Giới hạn

- Demo seed chỉ dùng kiểm thử luồng phần mềm.
- Poisson baseline chưa dùng xG, lineup, injuries, Elo và tactical matchup.
- API-Football coverage khác nhau theo giải, mùa và gói tài khoản.
- Trước khi thương mại hóa cần kiểm tra quyền dùng odds, logo, dữ liệu và quy định betting.
