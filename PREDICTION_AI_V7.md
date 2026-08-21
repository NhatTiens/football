# Prediction AI v7 — Market features, learned stacking và isotonic calibration

**Version:** `scientific-ensemble-dixon-coles-v7`
**Ngày phát hành:** 2026-08-21
**Phạm vi:** nâng cấp trực tiếp pipeline khoa học hiện tại (`packages/engine`, `packages/sync`, worker CLI). **Không thay đổi Prisma schema, không cần migration.**

---

## 1. Vấn đề mà v7 giải quyết

Bản đánh giá (21/08/2026) dựa trên artifacts trong repo cho thấy:

- O2.5 có skill âm (−1.4% so với baseline), BTTS ≈ 0% skill so với uniform — lõi dự đoán đang ở mức baseline.
- Feature vector v6 chỉ có **16 feature tổng hợp thô**; **market consensus (nguồn thông tin mạnh nhất) không được đưa vào model** — odds chỉ được dùng để tính edge sau khi có xác suất model.
- Training và inference **không khớp feature**: lúc train, injury/tactical/lineup bị đặt = 0 (hằng số) nên model không bao giờ học được chúng.
- Trọng số blend (Poisson 0.48 / Elo 0.24 / ML 0.38×…) là **chỉnh tay**, không tối ưu.
- Calibration binary chỉ dùng Platt (giả định dạng logistic) — cứng nhắc.

## 2. Thay đổi chính

### 2.1 Feature vector v7 — 29 chiều (từ 16)

Thêm 13 feature (xem `SCIENTIFIC_FEATURE_NAMES_V7` trong `packages/sync/src/scientific-model.ts`):

| # | Feature | Ý nghĩa |
|---|---|---|
| 16 | `homeAdvantageTeam` | Lợi thế sân nhà riêng của đội (home PPG − away PPG so với chuẩn giải). Thay hằng số `1` của v6. |
| 17–19 | `marketHome/Draw/AwayConsensus` | No-vig consensus 1X2 từ toàn bộ nhà cái (median), PIT-safe. |
| 20 | `marketOver25Consensus` | Consensus OVER 2.5 no-vig. |
| 21 | `marketBttsYesConsensus` | Consensus BTTS YES no-vig. |
| 22 | `marketMoveHome` | Độ dịch chuyển 1X2 home từ opening → hiện tại (dấu hiệu "tiền thông minh"). |
| 23 | `marketMoveOver25` | Độ dịch chuyển OVER 2.5. |
| 24 | `marketAvailable` | Cờ dữ liệu market đủ điều kiện (0/1). |
| 25 | `marketOddsAgeHours` | Độ tươi của odds (chuẩn hóa /72h). |
| 26 | `marketBookmakerCount` | Số nhà cái đóng góp (chuẩn hóa /10). |
| 27 | `opponentAdjustedFormDiff` | PPG điều chỉnh theo sức mạnh đối thủ (Elo từng trận). |
| 28 | `injuryWeightedDiff` | Chấn thương theo trọng số: cầu thủ thường đá chính tính gấp đôi. |
| 29 | `fatigueDensityDiff` | Mật độ trận đấu 7/14 ngày gần nhất (proxy minutes tải trận). |

**Training và inference giờ dùng ĐÚNG cùng vector 29 chiều** — sửa luôn lỗi "training ≠ inference".

Nguồn dữ liệu market: `packages/sync/src/scientific-market-features.ts` (mới) — đọc `OddsSnapshot` append-only, chỉ dùng snapshot `capturedAt <= predictionAsOf`, loại odds live, no-vig theo từng nhà cái rồi lấy median. Bản bulk `getFixturesMarketFeatureSets` hỗ trợ `asOfByFixture` (mỗi trận dùng cutoff là giờ kickoff của chính nó) — **không rò rỉ tương lai vào quá khứ** khi huấn luyện.

### 2.2 Learned stacking (thay trọng số chỉnh tay)

`trainStackingWeights()` trong `scientific-model.ts`:

- Huấn luyện **coordinate ascent trên simplex** (trọng số luôn ≥ 0 và tổng = 1) tối ưu **log loss** — thử toàn bộ cặp có hệ thống nên không kẹt local optimum.
- 1X2: 4 thành phần `[poisson, elo, ml, market]`; O2.5/BTTS: 3 thành phần `[poisson, ml, market]`.
- Khởi tạo uniform = blend tay hiện tại; learner chỉ dịch chuyển khi một thành phần thực sự thêm thông tin.
- Được fit trên **validation chia theo thời gian** (20% cuối), thành phần ML dùng model **không nhìn thấy** các trận đó (OOF), sau đó base được train lại trên toàn bộ dữ liệu (refit) — chuẩn stacking.

### 2.3 Isotonic calibration (PAV)

`fitIsotonicRegression()` / `applyIsotonicRegression()`:

- Pool Adjacent Violators đảm bảo ánh xạ **đơn điệu không giảm** trên [0,1], không giả định dạng tham số như Platt.
- Áp lên xác suất **sau stacking** của O2.5 và BTTS.
- Lưu dạng bins (mặc định 20) gọn trong artifact.

### 2.4 Blend khi inference

`predictScientificModelV7()`: nếu artifact là v7 có stacking → blend 4/3 thành phần theo trọng số học được + isotonic; thiếu thành phần market → chuẩn hóa lại trọng số còn lại; artifact v6 → hành vi cũ y hệt (`adaptFeatureWidth` cắt vector 29 → 16).

### 2.5 Engine nâng cấp (packages/engine)

- `estimateExpectedGoalsV2`: xG **recency-weighted** (half-life 60 ngày, effective sample size Kish).
- `deriveMarketProbabilities(..., rho)`: hỗ trợ **Dixon–Coles tau** cho 1X2/BTTS ở baseline Poisson.
- `calculatePoissonMarketsV2`: một call tổng hợp cả hai.
- Helpers: `softmax`, `sigmoid`, `logit`, `inverseLogit`, `weightedMean`, `expDecayWeight`, `effectiveSampleSize`.

## 3. Biến môi trường mới (.env)

```env
SCIENTIFIC_V7_ENABLED=true                 # false = quay về hành vi v6 hoàn toàn
SCIENTIFIC_STACKING_ENABLED=true           # bật stacking khi train
SCIENTIFIC_STACK_EPOCHS=300
SCIENTIFIC_STACK_LR=0.05
SCIENTIFIC_STACK_SEED=20260821
SCIENTIFIC_ISOTONIC_BINS=20
SCIENTIFIC_MARKET_MIN_BOOKMAKERS=2         # tối thiểu nhà cái để tính consensus
SCIENTIFIC_MARKET_MAX_AGE_HOURS=168        # odds cũ hơn mức này bị loại khỏi feature
```

## 4. Vận hành

```bash
# 1) Huấn luyện artifact v7 (market features + stacking + isotonic)
npm run worker -- train-scientific-v7

# 2) Sinh dự đoán/khuyến nghị như cũ (tự dùng artifact v7 nếu có)
npm run worker -- generate

# 3) Đánh giá khoa học (backtest / walk-forward) như cũ
npm run worker -- scientific-backtest
npm run worker -- scientific-walk-forward

# 4) Kiểm thử
npm run test:prediction-v7 -w @football-ai/sync
npm run typecheck
```

`train-scientific` (cũ) vẫn chạy và **mặc định tạo artifact v7** (vì `SCIENTIFIC_V7_ENABLED=true`). Đặt biến `SCIENTIFIC_V7_ENABLED=false` để huấn luyện artifact v6 thuần.

Artifact v7 lưu ở cùng `AppSetting` key `SCIENTIFIC_MODEL_V1` + registry (aliases `latest`/`champion`), version = `scientific-ensemble-dixon-coles-v7`. Artifact v6 cũ vẫn được chấp nhận (`isScientificModelArtifact` chấp nhận cả 2), model cũ chỉ bị "không dùng" nếu không qua cổng thời gian PIT.

## 5. Kết quả kiểm chứng

- **703 → 719+ tests pass** (72 file sync, 3 file engine), typecheck toàn repo 0 lỗi, prettier clean.
- Mô phỏng end-to-end 800 mẫu: stacking học đúng trọng số market (0.8) khi market là thành phần giàu thông tin; **log loss validation giảm 4.08%** so với blend tay.
- Các test mới: `packages/engine/tests/poisson-v7.test.ts` (recency, DC tau, helpers), `packages/sync/tests/scientific-v7.test.ts` (stacking hội tụ + simplex, isotonic đơn điệu, market consensus/movement PIT, artifact v7, predict có/không có market).

## 6. Lưu ý vận hành (quan trọng)

1. **Dữ liệu odds phải có** để feature market hoạt động: chạy `sync-odds` + `sync-odds-repeated` đều đặn; odds càng nhiều nhà cái càng tốt. Với trận không có odds PIT, các feature market về fallback (1/3, 0.5, 0) và cờ `marketAvailable=0` — model v7 học cách xử lý cả hai trường hợp.
2. **Đánh giá lại bằng log loss/Brier/ECE**, không chỉ accuracy; so sánh v6 vs v7 trên cùng walk-forward trước khi chốt production.
3. Vẫn giữ kỷ luật PIT: mọi dữ liệu mới (odds, lineup, stats) phải qua snapshot append-only — đã đảm bảo trong code mới.
4. Replay odds lịch sử (provider replay) cần dữ liệu odds thật; sau khi bật `train-scientific-v7`, chạy `scientific-walk-forward` để đo CLV/ROI thật trên cỡ mẫu lớn trước khi tăng stake.

## 7. Files thay đổi

| File | Thay đổi |
|---|---|
| `packages/engine/src/math.ts` | +softmax, sigmoid, logit, weightedMean, expDecayWeight, effectiveSampleSize, mean |
| `packages/engine/src/poisson.ts` | +estimateDixonColesRho, dixonColesTau, estimateExpectedGoalsV2, calculatePoissonMarketsV2, rho param |
| `packages/sync/src/scientific-model.ts` | +V7 feature names (29), stacking trainer/applier, isotonic PAV, buildScientificArtifactV7, predictScientificModelV7, adaptFeatureWidth, opponentAdjustedPpg |
| `packages/sync/src/scientific-market-features.ts` | **mới** — market consensus/movement 3 market, PIT, bulk training path |
| `packages/sync/src/scientific-features.ts` | feature vector 29 chiều, market features, stacking blend, Elo series, fatigue/home-advantage/opponent-adjusted |
| `packages/sync/src/scientific-sync.ts` | training v7: market features bulk, OOF split, stacking + isotonic fit |
| `packages/sync/src/point-in-time.ts` | +FeatureSource `MARKET_FEATURES` |
| `apps/worker/src/jobs.ts`, `cli.ts` | +command `train-scientific-v7` |
| `.env.example` | +8 biến v7 |
| `packages/engine/tests/poisson-v7.test.ts`, `packages/sync/tests/scientific-v7.test.ts` | **mới** — 41 test |
