# Prediction AI v6.2 - Dynamic Bankroll and Stake Sizing

## Muc tieu

v6.2 bo sung quan ly von dong cho recommendation va backtest. Muc cuoc khong tang chi vi xac suat thang cao. He thong chi tang stake khi:

- xac suat da hieu chinh tao EV duong tai odds hien tai;
- edge duong so voi fair market;
- confidence va data quality du tot;
- model uncertainty da duoc phat trong v6;
- drawdown va exposure van nam trong gioi han.

## Cong thuc

He thong bat dau tu Kelly day du:

```text
fullKelly = EV / (odds - 1)
```

Sau do dung fractional Kelly va cac he so rui ro:

```text
stakeFraction = fullKelly
  * kellyFraction
  * qualityMultiplier
  * edgeMultiplier
  * expectedValueMultiplier
  * drawdownMultiplier
```

Ket qua bi gioi han boi max stake, % bankroll moi bet, exposure moi fixture va exposure moi ngay.

## Profile mac dinh

- CONSERVATIVE: 0.10 Kelly, toi da 1% bankroll moi bet.
- BALANCED: 0.20 Kelly, toi da 1.5% bankroll moi bet.
- GROWTH: 0.30 Kelly, toi da 2% bankroll moi bet.

BALANCED la profile mac dinh. GROWTH co bien dong va drawdown cao hon.

## Bien moi truong

```env
SCIENTIFIC_STAKING_ENABLED=true
SCIENTIFIC_STAKING_PROFILE=BALANCED
SCIENTIFIC_BANKROLL_UNITS=100
SCIENTIFIC_BANKROLL_AMOUNT=10000000
SCIENTIFIC_BANKROLL_CURRENCY=VND
SCIENTIFIC_KELLY_FRACTION=0.20
SCIENTIFIC_MIN_STAKE_UNITS=0.10
SCIENTIFIC_MAX_STAKE_UNITS=1.50
SCIENTIFIC_MAX_STAKE_FRACTION=0.015
SCIENTIFIC_MAX_FIXTURE_EXPOSURE_FRACTION=0.025
SCIENTIFIC_MAX_DAILY_EXPOSURE_FRACTION=0.08
SCIENTIFIC_STAKE_ROUNDING_UNITS=0.05
SCIENTIFIC_DRAWDOWN_SOFT_LIMIT=0.08
SCIENTIFIC_DRAWDOWN_HARD_LIMIT=0.20
```

`SCIENTIFIC_BANKROLL_AMOUNT` la tong so tien von. Vi du 10,000,000 VND va 100 units thi 1 unit tuong duong 100,000 VND.

## Backtest

Backtest v6.2 dung stake dong va luu trong `BacktestBet.stakeUnits`. `BacktestRun.rules` co:

- stakingConfig
- stakingMetrics
- starting/ending bankroll
- totalStakeUnits
- largestStakeUnits
- maximumDrawdownUnits
- maximumDrawdownFraction

Walk-forward v6.2 tong hop return va drawdown theo tung fold.

## Gioi han

Khong co chien luoc staking nao bao dam loi nhuan. Sai so calibration co the lam Kelly dat cuoc qua lon, vi vay v6.2 dung fractional Kelly, hard caps va drawdown stop.
