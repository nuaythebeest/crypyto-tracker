# Signal Engine — Rule-Based Logic

## Overview

The signal engine runs **on every 1H candle close** for all active pairs.  
It evaluates 3 timeframes independently, scores each, and combines them into a confidence score.  
A signal is only shown to the user if confidence ≥ 70%.

---

## Step 1 — Fetch Candle Data

For each pair, fetch 200 candles for each timeframe before running analysis:

```
1D candles  → GET /api/v3/klines?symbol=BTCUSDT&interval=1d&limit=200
4H candles  → GET /api/v3/klines?symbol=BTCUSDT&interval=4h&limit=200
1H candles  → GET /api/v3/klines?symbol=BTCUSDT&interval=1h&limit=200
```

Extract from each candle: `open, high, low, close, volume`

---

## Step 2 — Calculate Indicators

Run these on each timeframe's candle array. All calculations are standard formulas.

### EMA (Exponential Moving Average)
```javascript
function ema(closes, period) {
  const k = 2 / (period + 1);
  let emaVal = closes[0];
  for (let i = 1; i < closes.length; i++) {
    emaVal = closes[i] * k + emaVal * (1 - k);
  }
  return emaVal;
}
// Calculate: EMA20, EMA50, EMA200 for each timeframe
```

### RSI (14)
```javascript
function rsi(closes, period = 14) {
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}
```

### MACD (12, 26, 9)
```javascript
function macd(closes) {
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12 - ema26;
  // Signal line = EMA9 of MACD line values (need array of recent MACD values)
  // Histogram = macdLine - signalLine
  // Return: { macdLine, signalLine, histogram }
}
```

### Bollinger Bands (20, 2)
```javascript
function bollingerBands(closes, period = 20, stdDev = 2) {
  const slice = closes.slice(-period);
  const sma = slice.reduce((a, b) => a + b) / period;
  const variance = slice.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period;
  const std = Math.sqrt(variance);
  return { upper: sma + stdDev * std, middle: sma, lower: sma - stdDev * std };
}
```

### ATR (14) — used for Stop Loss calculation
```javascript
function atr(highs, lows, closes, period = 14) {
  const trueRanges = [];
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);
  }
  // Wilder's smoothing
  let atrVal = trueRanges.slice(0, period).reduce((a, b) => a + b) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atrVal = (atrVal * (period - 1) + trueRanges[i]) / period;
  }
  return atrVal;
}
```

### ADX (14) — trend strength
```javascript
// ADX > 25 = trending market (use trend-following signals)
// ADX < 20 = ranging market (use mean-reversion signals)
// Standard Wilder ADX formula using +DI and -DI
```

---

## Step 3 — Confluence Scoring

Score each condition independently. Total max = 100 points.  
**Signal fires only if total ≥ 70.**

### Daily Timeframe (max 30 points)

| Condition | Points | Check |
|---|---|---|
| Price above EMA 200 (bullish) OR below EMA 200 (bearish) | +15 | Confirms macro trend direction |
| EMA 20 above EMA 50 (bullish cross) OR below (bearish) | +10 | Medium-term trend aligned |
| RSI 1D between 40–70 (bullish) OR 30–60 (bearish) | +5 | Not exhausted on daily |

### 4H Timeframe (max 35 points)

| Condition | Points | Check |
|---|---|---|
| MACD histogram trending in signal direction | +15 | Momentum building |
| RSI 4H: bullish = 45–65, bearish = 35–55 | +10 | Not overbought/oversold |
| Price above EMA 50 (bullish) OR below EMA 50 (bearish) | +10 | 4H structure aligned |

### 1H Timeframe — Entry Trigger (max 20 points)

| Condition | Points | Check |
|---|---|---|
| RSI crossed 50 upward (bullish) OR downward (bearish) on this candle | +10 | Entry momentum |
| Price bounced from BB middle band (bullish) OR rejected at upper BB (bearish) | +10 | Price structure trigger |

### External Filters (max 15 points)

| Condition | Points | Check |
|---|---|---|
| Volume on trigger candle > 1.2× 20-period average | +10 | Confirms conviction |
| Funding rate neutral: -0.03% to +0.03% | +5 | Not overcrowded |

### Confidence Score Calculation
```javascript
function calculateConfidence(daily, fourH, oneH, external) {
  const total = daily.score + fourH.score + oneH.score + external.score;
  return Math.min(100, total);  // cap at 100
}

// Direction determined by majority of scored conditions
// If daily + 4H both point LONG → signal is LONG
// If they conflict → no signal regardless of score
```

---

## Step 4 — Funding Rate Filter (Hard Block)

Before generating any signal, check funding rate:

```javascript
function isFundingRateBlocked(fundingRate, direction) {
  if (direction === 'LONG' && fundingRate > 0.05) return true;   // Market overleveraged long
  if (direction === 'SHORT' && fundingRate < -0.05) return true; // Market overleveraged short
  return false;
}
// If blocked → do not show signal regardless of confidence score
// Show warning: "Signal suppressed — funding rate extreme"
```

---

## Step 5 — RSI Divergence Detection

Run on 4H timeframe. Check the last 20 candles for divergence.

```
Bullish Divergence (adds +10 to confidence if detected):
  - Price makes LOWER LOW compared to previous swing low
  - RSI makes HIGHER LOW at the same points
  → Signals weakening bearish momentum, potential reversal up

Bearish Divergence (adds +10 to confidence if detected):
  - Price makes HIGHER HIGH compared to previous swing high
  - RSI makes LOWER HIGH at the same points
  → Signals weakening bullish momentum, potential reversal down

Note: Divergence adds to confidence only if it matches the signal direction.
```

---

## Step 6 — Break of Structure (BOS) Detection

```
Bullish BOS:
  - Find the last 3 swing highs (local maxima) in 4H candles
  - If current candle closes ABOVE the most recent swing high → Bullish BOS confirmed
  - Adds +8 confidence to LONG signal

Bearish BOS:
  - Find the last 3 swing lows (local minima) in 4H candles
  - If current candle closes BELOW the most recent swing low → Bearish BOS confirmed
  - Adds +8 confidence to SHORT signal

Swing point detection: a swing high is a candle where high > previous 2 highs AND > next 2 highs.
```

---

## Step 7 — Entry, Stop Loss, Take Profit

### Entry Zone
```
Entry = current close price (last 1H candle)
Entry zone low  = Entry × 0.998   (0.2% below)
Entry zone high = Entry × 1.002   (0.2% above)
```

### Stop Loss (ATR-based, Isolated margin)
```
ATR = atr(highs, lows, closes, 14) on 4H timeframe

LONG  stop loss = Entry - (1.5 × ATR)
SHORT stop loss = Entry + (1.5 × ATR)

SL distance % = abs(Entry - StopLoss) / Entry × 100
```

### Take Profit Levels
```
SL_distance = abs(Entry - StopLoss)

TP1 = Entry + (SL_distance × 1.5)   [for LONG; subtract for SHORT]
TP2 = Entry + (SL_distance × 3.0)
TP3 = Entry + (SL_distance × 5.0)   [stretch target]

R:R at TP1 = 1:1.5
R:R at TP2 = 1:3.0
R:R at TP3 = 1:5.0
```

### Partial TP Management Instructions (display in trade card)
```
On TP1 hit → Close 50% of position. Move stop loss to breakeven (entry price).
On TP2 hit → Close 30% of remaining position. Trail stop loss 1× ATR below price.
On TP3 hit → Close remaining 20%.
If SL hit before TP1 → Full loss, close entire position.
```

---

## Step 8 — Signal Expiry

```javascript
const SIGNAL_EXPIRY_CANDLES = 3;  // 3 × 1H = 3 hours

// When a signal fires, record signalTime.
// On each new candle, check:
//   if (currentCandle - signalCandle >= SIGNAL_EXPIRY_CANDLES) mark signal as EXPIRED
//   if (currentPrice already past entry zone) mark signal as MISSED
// Expired/missed signals are removed from dashboard, kept in trade log as 'skipped'
```

---

## Signal Object Structure

```javascript
{
  id: 'uuid',
  pair: 'BTCUSDT',
  direction: 'LONG',             // LONG | SHORT
  confidence: 82,                // 0–100
  entryZone: { low: 67065, high: 67335 },
  stopLoss: 65420,
  slDistancePct: 2.35,
  tp1: 69460, tp1Pct: 3.52,
  tp2: 71830, tp2Pct: 7.06,
  tp3: 75570, tp3Pct: 12.62,
  atr4h: 1210,
  riskReward: 3.0,               // at TP2
  indicators: {
    daily:  { ema200: 'above', emaCross: 'bullish', rsi: 58 },
    fourH:  { macd: 'bullish', rsi: 52, ema50: 'above' },
    oneH:   { rsiCross: true, bbBounce: true },
    volume: 'above_avg',
    fundingRate: 0.012,
    divergence: 'bullish',       // null | bullish | bearish
    bos: 'bullish',              // null | bullish | bearish
    adx: 28,                     // >25 = trending
  },
  scoreBreakdown: {
    daily: 25, fourH: 30, oneH: 15, external: 12
  },
  signalTime: 1717200000000,
  expiresAt: 1717210800000,      // +3H
  status: 'active',              // active | expired | taken | skipped
}
```

---

## Market Condition Mode

```javascript
function getMarketMode(adx4h) {
  if (adx4h > 25) return 'TRENDING';
  if (adx4h < 20) return 'RANGING';
  return 'TRANSITIONING';
}

// TRENDING mode   → weight MACD + EMA signals more
// RANGING mode    → weight RSI extremes + BB band touch more
// Display market mode badge on chart header so user knows context
```
