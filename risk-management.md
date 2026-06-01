# Risk Management Specification

## User Profile

| Parameter | Value |
|---|---|
| Account Size | ~$600 USDT (user-editable in Settings) |
| Risk per Trade | 10% of account = ~$60 |
| Margin Mode | Isolated only (never Cross) |
| Default Leverage | 7x |
| Max Leverage shown | 20x |

---

## Position Sizing Calculator

### Formulas

```
// Inputs
accountSize     = 600           // USDT (from settings)
riskPercent     = 10            // % (from settings)
leverage        = 7             // x (from UI selector)
entryPrice      = 67200         // USDT (from signal)
stopLossPrice   = 65420         // USDT (from signal engine ATR calc)

// Calculations
riskAmount      = accountSize × (riskPercent / 100)
                = 600 × 0.10 = $60.00

slDistancePrice = abs(entryPrice - stopLossPrice)
                = abs(67200 - 65420) = 1780

positionSize    = riskAmount / slDistancePrice
                = 60 / 1780 = 0.03371 BTC

notionalValue   = positionSize × entryPrice
                = 0.03371 × 67200 = $2,265

marginRequired  = notionalValue / leverage
                = 2265 / 7 = $323.57
```

**Validation:** If `marginRequired > accountSize × 0.5`, warn: "Position too large — margin exceeds 50% of account."

---

## Liquidation Price (Isolated Margin)

Binance USDⓈ-M Isolated margin liquidation formulas.  
Maintenance margin rate for BTC/ETH at standard tier: **0.50%**  
For other pairs (SOL, BNB, XRP) at standard tier: **0.50%** (same tier at small position sizes)

### LONG position
```
Liquidation Price = Entry × (1 - (1 / Leverage) + Maintenance Margin Rate)
                  = 67200 × (1 - (1/7) + 0.005)
                  = 67200 × (1 - 0.1429 + 0.005)
                  = 67200 × 0.8621
                  = $57,934
```

### SHORT position
```
Liquidation Price = Entry × (1 + (1 / Leverage) - Maintenance Margin Rate)
                  = 67200 × (1 + (1/7) - 0.005)
                  = 67200 × 1.1379
                  = $76,466
```

### Buffer to Liquidation
```
Buffer % (Long)  = (Entry - Liquidation) / Entry × 100
Buffer % (Short) = (Liquidation - Entry) / Entry × 100

Display:
  Buffer > 10%  → green label "Safe"
  Buffer 5–10%  → amber label "Caution"
  Buffer < 5%   → red label "⚠️ Dangerous"
```

---

## Stop Loss vs Liquidation Safety Check

**Rule:** Stop Loss must trigger before Liquidation Price.  
The app must verify there is at least a **2% gap** between SL and liquidation price.

```javascript
function isSLSafe(entryPrice, stopLoss, liquidationPrice, direction) {
  if (direction === 'LONG') {
    const slToLiqBuffer = (stopLoss - liquidationPrice) / stopLoss * 100;
    return slToLiqBuffer >= 2;  // SL must be at least 2% above liquidation
  } else {
    const slToLiqBuffer = (liquidationPrice - stopLoss) / stopLoss * 100;
    return slToLiqBuffer >= 2;
  }
}

// If false → show warning: "SL too close to liquidation price at this leverage. Reduce leverage."
// Suggest lower leverage automatically: show what leverage makes the buffer safe.
```

---

## Daily Loss Limit

```javascript
const DAILY_LOSS_LIMIT = 2;   // Stop after 2 consecutive losses

// Check on each trade result logged:
function checkDailyLossLimit() {
  const todaysTrades = getTodaysTrades();  // from localStorage
  const consecutiveLosses = getConsecutiveLossCount(todaysTrades);

  if (consecutiveLosses >= DAILY_LOSS_LIMIT) {
    // Show full-screen warning banner:
    // "⛔ Daily loss limit reached (2 losses)
    //  No new signals will be shown until tomorrow.
    //  Protect your capital. Step away and review."
    suppressSignals = true;
  }
}
```

Daily loss limit resets at 00:00 UTC (matches Binance daily candle reset).

---

## Correlation Warning

BTC and ETH have ~85% price correlation. SOL also highly correlated (~80% with BTC).

```javascript
const CORRELATION_GROUPS = {
  high: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],   // all highly correlated
  medium: ['BNBUSDT'],                          // moderate correlation
  low: ['XRPUSDT'],                             // lower correlation
};

function checkCorrelation(newSignalPair, newSignalDirection, openPositions) {
  const correlated = openPositions.filter(pos =>
    CORRELATION_GROUPS.high.includes(pos.pair) &&
    CORRELATION_GROUPS.high.includes(newSignalPair) &&
    pos.direction === newSignalDirection
  );

  if (correlated.length > 0) {
    // Show warning on signal card:
    // "⚠️ Correlated position: You already have a LONG on ETH/USDT.
    //  This doubles your effective BTC exposure."
  }
}
```

---

## Partial TP Risk Logic

When TP1 is hit and 50% is closed, recalculate risk on remaining position:

```
After TP1 hit:
  - Remaining position = 50% of original
  - SL moved to breakeven (entry price)
  - Risk on remaining = $0 (breakeven, can't lose money)
  - Free trade: only upside remains

Display update:
  - SL line on chart moves to entry price
  - Card shows "Position in profit — BE stop active"
  - Show expected profit at TP2 and TP3 for remaining 50%
```

---

## Risk Display Rules

Always show these in red:
- Stop Loss price
- Liquidation price
- Any warning about insufficient buffer

Always show these in green:
- Take profit prices
- Buffer % when safe (> 10%)
- PnL when positive

Never display leverage above 20x (even if Binance allows higher).  
Do not allow users to set risk % above 20% per trade (hard cap in settings input).  
Do not allow account size input below $50 (would make position sizes unrealistically small).

---

## Summary Table for Each Signal

The position sizing panel should auto-populate from the active signal:

```
Account Size       $600.00
Risk per Trade     10%  →  $60.00
Entry Price        $67,200
Stop Loss          $65,420  (-2.65%)
Leverage           7x

── Calculated ──
Position Size      0.0337 BTC
Notional Value     $2,265
Margin Required    $323.57   (53.9% of account — WARNING: high)
Liquidation Price  $57,934   (13.8% below entry — SAFE)
SL → Liq Buffer    4.4%      (CAUTION — reduce leverage if concerned)

── At TP1 ($69,500) ──
  50% closed PnL  +$38.90
  Remaining risk  $0 (SL at BE)

── At TP2 ($72,000) ──
  30% closed PnL  +$47.60 additional
  Total locked    +$86.50

── At TP3 ($75,800) ──
  Final 20% PnL   +$57.50
  Total trade PnL +$144.00  (+240% on $60 risk)
```
