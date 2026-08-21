# API Call Budget — không để hết quota giữa ngày

**Vấn đề:** cấu hình mặc định cũ + autopilot chạy song song khiến worker gọi API-Football
quá nhiều và đốt sạch hạn mức ngày (Free 100 req, Pro 7.500 req) chỉ trong vài giờ.

## 1. Trước đây: vì sao hết quota?

| Nguồn | Cấu hình cũ | Request/ngày (92 trận sắp tới) |
|---|---|---|
| `dev:autopilot` — statistics/xG | mỗi 60 phút × 25 fixture | 600 |
| `dev:autopilot` — injuries | mỗi 60 phút × ~20 fixture | 480 |
| `dev:autopilot` — refresh fixtures+predictions | mỗi 120 phút | 300–600 |
| `dev:autopilot` — early odds discovery | mỗi 3h/fixture | 700+ |
| `sync-odds-repeated` (worker) | mỗi 5 phút × 8 trận | 2.304 |
| `sync-predictions` (worker) | mỗi giờ × 92 trận | 2.208 |
| `sync-lineups` (worker) | mỗi 10 phút × trận trong 6h | 1.152 |
| discovery + current-refresh + live | — | ~500 |
| **Tổng** | | **~8.000–9.000** → vượt Pro 7.500 |

## 2. Sau khi áp bản nâng cấp: giảm ~80–90%

### (a) `sync-odds` chuyển sang **BULK-BY-DATE** ⭐ (thay đổi lớn nhất)
- Trước: 1 request/trận (`/odds?fixture=X`) → 92 request mỗi lần sync.
- Sau: 1–2 request/ngày (`/odds?date=YYYY-MM-DD`, phân trang) lấy odds cho **tất cả** trận
  hôm đó, chỉ lưu trận đã có trong DB. 4 ngày = **~4–8 request/run**.
- Chạy mỗi 30 phút → ~200–350 request/ngày cho mọi trận + vẫn tích lũy snapshot
  biến động odds (OddsSnapshot chỉ ghi khi odds đổi) → **không cần `sync-odds-repeated`**.

### (b) `sync-odds-repeated` — mặc định TẮT (`ODDS_REPEATED_ENABLED=false`)
Bulk-by-date đã bao phủ; bật lại chỉ khi cần độ chính xác trong giờ cuối.

### (c) Autopilot (npm run dev) — default tiết kiệm
| Biến | Cũ | Mới |
|---|---|---|
| `DEV_SCIENTIFIC_AUTOPILOT_TICK_SECONDS` | 60 | **300** |
| `DEV_SCIENTIFIC_AUTOPILOT_REFRESH_MINUTES` | 120 | **720** (12h) |
| `DEV_SCIENTIFIC_AUTOPILOT_STATISTICS_MINUTES` | 60 | **360** (6h) |
| `DEV_SCIENTIFIC_AUTOPILOT_INJURY_MINUTES` | 60 | **240** (4h) |
| `DEV_SCIENTIFIC_AUTOPILOT_PLAN_MINUTES` | 15 | **30** |

Không cần autopilot → `DEV_SCIENTIFIC_AUTOPILOT_ENABLED=false`.

### (d) Predictions — 1 lần/ngày (`PREDICTION_SYNC_CRON="30 4 * * *"`)
API-Football predictions chỉ chiếm 8% trọng số blend; 92 req/ngày là đủ, không cần 2.208.

### (e) Lineups — giới hạn 10 trận/run + cửa sổ 6h (giữ), cron 30 phút.

### (f) `scientific-current-refresh` — mỗi tuần (`30 7 * * 1`) thay vì 2 ngày/lần.

### (g) Quota guard toàn cục (đã có): khi `remaining <= API_QUOTA_MIN_RESERVE` (250),
mọi job đồng bộ tự skip — chỉ settlement/live vẫn chạy.

## 3. Con số sau cùng (ước tính)

| Nguồn | Request/ngày |
|---|---|
| `sync-odds` bulk 30 phút × 4 ngày | ~200–350 |
| `sync-predictions` 1 lần/ngày | ~92 |
| `sync-lineups` 48 lần × ≤10 trận | ~300–400 |
| fixtures discovery 4 lần | ~100–200 |
| autopilot (tick 5 phút, stats 6h, injury 4h) | ~400–700 |
| current-refresh (tuần /7) | ~50 |
| **Tổng** | **~1.200–1.800** ✅ (Pro 7.500 dư nhiều) |

## 4. Cấu hình cho từng gói

### Pro (7.500/ngày) — mặc định mới là đủ
```env
ODDS_REPEATED_ENABLED=false
ODDS_SYNC_CRON="*/30 * * * *"
PREDICTION_SYNC_CRON="30 4 * * *"
LINEUP_SYNC_CRON="*/30 * * * *"
API_QUOTA_MIN_RESERVE=250
```
Muốn odds sát giờ đá hơn: `ODDS_SYNC_CRON="*/15 * * * *"` (+~200 req/ngày) vẫn an toàn.

### Free (100/ngày)
```env
WORKER_SCHEDULER_ENABLED=false          # tắt cron; sync bằng tay
DEV_SCIENTIFIC_AUTOPILOT_ENABLED=false # tắt autopilot
```
Mỗi lần sync tay ~60–80 req:
```powershell
npm run worker -- sync-fixtures
npm run worker -- sync-odds
npm run worker -- sync-predictions
npm run worker -- generate
```

## 5. Kiểm tra mức tiêu thụ
```bash
npx prisma studio    # bảng ApiQuotaDaily + ApiUsage (số thật sau bản fix quota)
# FE dashboard hiển thị "API còn X/Y" từ DB
```
