# Prediction AI v6

Gói này nâng cấp trực tiếp pipeline dự đoán khoa học hiện tại, không thay đổi Prisma schema và không yêu cầu Python.

## Thành phần mới

- Bagged ensemble gồm nhiều mô hình softmax/logistic thay cho một mô hình tuyến tính duy nhất.
- Chia train/validation theo thời gian, không random split.
- Trọng số dữ liệu gần hiện tại cao hơn dữ liệu quá cũ.
- Loại tự động feature hằng hoặc gần như hằng, bao gồm biến `homeAdvantage = 1` của pipeline cũ.
- Bổ sung feature phi tuyến và các tương tác có kiểm soát.
- Early stopping và Adam optimizer.
- Temperature scaling cho 1X2, Platt calibration cho Over 2.5 và BTTS.
- Độ bất định từ mức bất đồng giữa các thành viên ensemble.
- Dixon-Coles correction cho phân phối tỷ số thấp.
- Trọng số ML/Poisson thích ứng với số mẫu và độ bất định.
- Tính EV bằng xác suất bảo thủ sau khi trừ uncertainty penalty.
- Scientific backtest sử dụng fixed decision horizon, mặc định T-90 phút.

## Biến môi trường mới

```env
SCIENTIFIC_UNCERTAINTY_PENALTY=0.65
SCIENTIFIC_BACKTEST_HORIZON_MINUTES=90
```

Các biến huấn luyện hiện tại vẫn dùng được:

```env
SCIENTIFIC_TRAINING_EPOCHS=360
SCIENTIFIC_TRAINING_RATE=0.018
SCIENTIFIC_TRAINING_L2=0.01
SCIENTIFIC_TRAINING_LIMIT=4000
SCIENTIFIC_TRAINING_SEED=20260722
SCIENTIFIC_ENSEMBLE_MEMBERS=3
SCIENTIFIC_MIN_TRAINING_SAMPLES=80
```

## Sau khi cập nhật

Huấn luyện lại artifact v6:

```cmd
npm run worker -- train-scientific
```

Tạo dự đoán và khuyến nghị:

```cmd
npm run worker -- generate
```

Backtest khoa học tại cùng horizon:

```cmd
set SCIENTIFIC_BACKTEST_HORIZON_MINUTES=90
npm run worker -- scientific-backtest
```

Chạy toàn bộ pipeline dữ liệu khoa học:

```cmd
npm run worker -- scientific-full
```

## Kiểm thử

```cmd
npm run typecheck -w @football-ai/sync
npm run test:prediction-v6 -w @football-ai/sync
```

Hoặc chạy `verify-update.cmd` trong gói cập nhật.

## Lưu ý vận hành

- Artifact v5 sẽ bị bỏ qua sau cập nhật. Chạy `train-scientific` để tạo artifact ensemble v6 trước khi đánh giá production.
- Backtest cũ `backtest` vẫn được giữ nguyên. Dùng `scientific-backtest` để đánh giá pipeline mới.
- Kết quả dự đoán không bảo đảm lợi nhuận. Nên so sánh Brier score, log loss, calibration, CLV và ROI trên nhiều giai đoạn trước khi thay cấu hình production.
