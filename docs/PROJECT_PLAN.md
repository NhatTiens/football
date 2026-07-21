# Kế hoạch hoàn thiện sản phẩm

## Trạng thái source code bàn giao

Bản hiện tại là MVP chạy được của luồng cốt lõi:

- API-Football → fixtures, odds, predictions.
- MySQL lưu odds snapshot và lịch sử recommendation.
- Poisson baseline, market consensus, no-vig, edge, EV và confidence.
- Top recommendation, expiration và settlement.
- REST API, dashboard Next.js, worker, Docker và CI.

Bản này chưa được xem là mô hình betting thương mại đã kiểm chứng. Dữ liệu demo không chứng minh hiệu suất dự đoán.

## Dự kiến phát triển từ MVP đến production

| Giai đoạn | Phạm vi | Nhóm 3–4 người |
|---|---|---:|
| Hardening MVP | Auth, RBAC, migrations, logs, admin UI, test tích hợp | 3–4 tuần |
| Data & backtest | Historical ingestion, walk-forward backtest, calibration, CLV | 4–6 tuần |
| Closed beta | Premium, alerts, audit, monitoring, incident handling | 3–4 tuần |
| Commercial release | Security review, legal/data licensing, SLA, scale testing | 3–5 tuần |

Tổng dự kiến để chuyển source MVP này thành sản phẩm thương mại tương đối ổn định: **13–19 tuần** với nhóm 3–4 người. Một lập trình viên toàn thời gian thường cần khoảng **5–8 tháng**.

## Nhân sự đề xuất

- 1 backend/data engineer.
- 1 frontend engineer.
- 1 ML/data scientist.
- 1 QA/DevOps bán thời gian hoặc toàn thời gian khi chuẩn bị phát hành.

## Tiêu chí trước khi bán gói Premium

- Backtest point-in-time không rò rỉ dữ liệu.
- Probability calibration đạt ngưỡng đã thống nhất.
- Báo cáo Log Loss, Brier Score, CLV, ROI và drawdown theo market/league.
- Prediction thất bại không bị xóa khỏi lịch sử.
- Recommendation tự hết hạn khi odds hoặc thông tin trận thay đổi.
- Data license và quy định tại thị trường mục tiêu đã được rà soát.
