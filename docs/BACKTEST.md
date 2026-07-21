# Point-in-time Backtest

Module backtest tái tạo recommendation tại thời điểm trước trận và lưu từng bet mô phỏng để kiểm toán.

## Nguyên tắc chống data leakage

Với mỗi fixture đã kết thúc, engine chỉ dùng:

- các trận lịch sử có `kickoffAt < fixture.kickoffAt`;
- odds snapshot có `capturedAt < fixture.kickoffAt`;
- external prediction có `capturedAt < fixture.kickoffAt`;
- kết quả thực tế chỉ được dùng sau bước tạo candidate, để settlement.

## Chỉ số

- `Hit rate = Wins / (Wins + Losses)`; bỏ qua PUSH và VOID.
- `Profit = Σ profit từng bet`, stake mặc định 1 unit.
- `ROI = Profit / tổng stake`.
- `Maximum drawdown`: mức giảm lớn nhất từ đỉnh equity đến đáy sau đó.
- `Brier score`: sai số bình phương của phân phối 1X2, càng thấp càng tốt.

## Chạy bằng CLI

Thiết lập tùy chọn trong `.env`:

```dotenv
BACKTEST_FROM="2024-08-01"
BACKTEST_TO="2025-05-31"
BACKTEST_LEAGUE_ID=""
BACKTEST_FIXTURE_LIMIT=500
BACKTEST_STAKE_UNITS=1
```

Sau đó:

```bash
npm run worker -- backtest
```

## Chạy trên giao diện

1. Chạy API và web bằng `npm run dev`.
2. Mở `http://localhost:3000/backtest`.
3. Nhập đúng `ADMIN_API_TOKEN` từ `.env`.
4. Chọn khoảng ngày, giải đấu và ngưỡng EV/edge/confidence.
5. Nhấn **Chạy backtest**.

## Dữ liệu demo

`npm run db:seed` tạo 120 trận lịch sử cùng odds snapshot trước giờ bóng lăn. Có thể kiểm tra ngay:

```bash
npm run db:seed
npm run worker -- backtest
npm run dev
```

Kết quả demo chỉ kiểm tra luồng phần mềm, không chứng minh hiệu quả thương mại.
