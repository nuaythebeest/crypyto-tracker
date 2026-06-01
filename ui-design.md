# UI Design Specification

## Layout Overview

3-column fixed layout. No mobile support needed (1200px minimum width).

```
┌─────────────────────────────────────────────────────────────────────┐
│  TOPBAR (48px) — Logo | Pair Tabs | Live Price | Market Stats       │
├────────────┬────────────────────────────────────┬───────────────────┤
│            │                                    │                   │
│  SIDEBAR   │         MAIN AREA                  │   RIGHT PANEL     │
│  (220px)   │         (flex 1)                   │   (300px)         │
│            │                                    │                   │
│ Navigation │  Price Chart                       │ Position Sizing   │
│ Watchlist  │  Indicator Badges                  │ Calculator        │
│ Market     │  Signal Cards (Long + Short)       │                   │
│ Stats      │                                    │ On-Chain Pulse    │
│            │                                    │                   │
│            │                                    │ Live Alerts       │
└────────────┴────────────────────────────────────┴───────────────────┘
```

---

## Pages

The app has 5 pages, rendered by swapping main content area. Sidebar navigation always visible.

### Page 1 — Dashboard (default)
- Live chart for selected pair
- Indicator badge strip
- Signal cards (Long + Short side by side, or "No Signal" placeholder)
- Market condition badge (Trending / Ranging / Transitioning)

### Page 2 — AI Signals
- Full feed of all signals generated today across all pairs
- Filter by: pair, direction (Long/Short), confidence threshold
- Each item shows: pair, direction, confidence score, time, entry zone, current status

### Page 3 — Trade Log
- Table of all trades: Paper + Taken + Skipped
- Columns: Date, Pair, Direction, Entry, SL, TP1, TP2, Leverage, Confidence, Status, Result, PnL
- User can: mark a signal as Taken or Skipped, add result (Win/Loss/Partial), add notes
- Filter by: pair, result, date range

### Page 4 — Backtest Stats
- Pulled from trade log data
- Shows last 20 signals taken
- Stats: Win rate %, Avg R:R, Total PnL, Best trade, Worst trade
- Equity curve chart (cumulative PnL over time)
- Signal confidence distribution (bar chart: how many signals at 70%, 75%, 80%, etc.)

### Page 5 — Settings
- Account Size (USDT)
- Risk per trade (%)
- Default leverage
- Active pairs (checkboxes)
- Daily loss limit (# of losses)
- Reset trade log button

---

## Component Specs

### Topbar
```
Height: 48px
Background: white / dark surface
Left:   Logo icon + "CryptoSignal" text
Center: Pair selector tabs (BTC | ETH | SOL | BNB | XRP | + Add)
        Active pair shows highlighted tab
        Each tab: pair name + current price + 24h % change
Right:  Live status dot (green = connected, red = disconnected)
        "Live" label
        Alert bell icon (shows badge count if unread alerts)
        Settings gear icon
```

### Sidebar
```
Width: 220px
Sections:
  NAVIGATION
    Dashboard (chart icon)
    AI Signals (robot/brain icon)
    Trade Log (history icon)
    Alerts (bell icon)
    Settings (settings icon)

  WATCHLIST
    Each row: pair name | current price | 24h % (green/red badge)
    Click row → switches active pair in topbar + chart
    Live price updates via WebSocket

  MARKET
    BTC Dominance %
    Fear & Greed Index (number + label: Extreme Fear / Fear / Neutral / Greed / Extreme Greed)
    Total Market Cap
    Update every 60 seconds via REST
```

### Price Chart
```
Library: TradingView Lightweight Charts
Height: ~280px
Timeframe selector: 15m | 1H | 4H | 1D | 1W (buttons, default 4H)
Overlays drawn on chart:
  - EMA 20 (blue line)
  - EMA 50 (orange line)
  - EMA 200 (red line, dashed)
  - Bollinger Bands (grey shaded area)
  - Entry zone (horizontal green zone band when signal is active)
  - Stop Loss line (horizontal red dashed line when signal active)
  - TP1, TP2, TP3 lines (horizontal green dotted lines when signal active)
Volume histogram at bottom of chart.
Market mode badge top-right of chart: "TRENDING" (blue) | "RANGING" (amber) | "TRANSITIONING" (grey)
```

### Indicator Badge Strip
```
Below chart. Horizontal row of badges, each showing one indicator status.
Badge format: "[Indicator] [Value] — [Status]"
Colors: green background = bullish, red = bearish, grey = neutral

Examples:
  RSI 58 — Neutral Bullish    (green)
  MACD Bullish Cross          (green)
  Above EMA 200               (green)
  BB Mid Band                 (grey)
  Funding Rate Caution        (red)
  ADX 28 — Trending           (blue)
  Bullish Divergence          (green, if detected)
```

### Signal Card (Long or Short)
```
One card for LONG, one for SHORT. Shown side by side.
If no signal → show greyed "No Signal" placeholder with reason.

Card structure:
┌─────────────────────────────────────────────┐
│ HEADER: LONG / CALL    Suggested: 7x        │  ← green background
├─────────────────────────────────────────────┤
│ Entry Zone         $66,800 – $67,200        │
│ Stop Loss          $65,400  (-2.1%)         │  ← red text
│ SL Distance        2.1%                     │
│ Liquidation (7x)   $61,100                  │  ← red text
├─────────────────────────────────────────────┤
│ TAKE PROFIT LEVELS                          │
│ [TP1: $69,500 +3.4%] [TP2: $72,000 +7.1%] [TP3: $75,800 +12.8%] │
├─────────────────────────────────────────────┤
│ Risk/Reward   ████████░░  1 : 3.4           │  ← progress bar
├─────────────────────────────────────────────┤
│ Confidence Score   ████████████ 82%         │  ← confidence bar
│ Score: Daily 25 | 4H 30 | 1H 15 | Ext 12   │  ← breakdown
├─────────────────────────────────────────────┤
│ PARTIAL TP PLAN                             │
│ TP1 hit → Close 50%, move SL to breakeven  │
│ TP2 hit → Close 30%, trail remaining       │
│ TP3 hit → Close final 20%                  │
├─────────────────────────────────────────────┤
│ Signal rationale (1–2 sentences from engine)│
├─────────────────────────────────────────────┤
│ [Mark as Taken]  [Skip]                     │  ← action buttons
└─────────────────────────────────────────────┘

"Mark as Taken" → opens modal to confirm leverage, then logs to trade log
"Skip" → logs as skipped, removes from dashboard
```

### Confidence Score Bar
```
Horizontal bar: 0–100%
  0–49%  = red (never shown — below threshold)
  50–69% = orange (never shown — below threshold)
  70–79% = yellow/amber
  80–89% = light green
  90–100% = bright green
Label: "82% Confidence"
Score breakdown shown as small text: Daily 25 / 4H 30 / 1H 15 / Ext 12
```

### Position Sizing Calculator (Right Panel)
```
Inputs (editable):
  Account Size (USDT)     [600]
  Risk per Trade (%)      [10]  → Risk Amount = $60

Leverage selector:
  [3x] [5x] [7x] [10x] [15x] [20x]  ← toggle buttons, default 7x

Calculated outputs (auto-update on input change):
  Risk Amount          $60.00
  Position Size        0.0XXX BTC  (Risk ÷ SL_distance_in_price)
  Notional Value       $X,XXX
  Margin Required      $XXX
  Liquidation Price    $XX,XXX   ← red text
  Buffer to Liq.       X.X%      ← green if >5%, yellow if 3–5%, red if <3%

Warning banner:
  If buffer < 5%: "⚠️ Liquidation close — consider lower leverage"
  If leverage > 10x: "⚠️ High leverage — max loss = full margin"
```

### On-Chain Pulse (Right Panel)
```
5 rows, each with label + visual indicator:

Exchange Netflow     [meter bar] Outflow (green) / Inflow (red)
Long/Short Ratio     [meter bar] 1.38 Long / balanced / Short
MVRV Ratio           X.X — Undervalued / Neutral / Overvalued
Whale Activity       Accumulating / Neutral / Distributing
SOPR                 X.XX — Profit taking / At cost / Selling at loss
Funding Rate         +0.012% — Normal / Caution / Extreme

Update: every 5 minutes via REST
```

### Alerts Panel (Right Panel)
```
Feed of triggered alerts, newest first.
Each item:
  Colored dot (green = bullish event, amber = caution, red = bearish/risk)
  Alert text (e.g. "BTC touched $67,000 support — Long entry zone active")
  Timestamp

Types of auto-generated alerts:
  - Price entered signal entry zone
  - Price hit TP1 / TP2 / TP3
  - Price hit stop loss
  - Funding rate exceeded ±0.05%
  - Signal expired without fill
  - Daily loss limit reached
  - Confidence score signal fired (new signal)
  - BTC dominance crossed 50% threshold
```

### Backtest Stats Panel (Page 4)
```
Top row — 4 metric cards:
  Win Rate     XX%
  Avg R:R      1 : X.X
  Total PnL    +$XXX
  Signals      XX taken

Below — Win/Loss visualization:
  Last 20 signals as colored dots: green = win, red = loss, grey = open/paper
  "W W L W W W L W ..." pattern

Below — Equity curve:
  Line chart of cumulative PnL over time
  X-axis: dates, Y-axis: USDT
  Start at $0 delta, show growth/drawdown

Below — Confidence distribution:
  Bar chart: signals bucketed by confidence score range
  70–74%, 75–79%, 80–84%, 85–89%, 90%+
  Shows win rate within each bucket (optional, if enough data)
```

---

## Color System

```
Long / Bullish signals   → green  (#22c55e text, green-tinted background)
Short / Bearish signals  → red    (#ef4444 text, red-tinted background)
Neutral / Info           → blue   (#3b82f6 text, blue-tinted background)
Warning / Caution        → amber  (#f59e0b text, amber-tinted background)
Inactive / Muted         → grey   (--color-text-secondary)

Confidence bar:
  70–79%  → amber
  80–89%  → light green
  90–100% → bright green

Liquidation price always displayed in red.
Stop loss always displayed in red.
Take profit always displayed in green.
```

---

## Interactions

- Clicking a pair in the sidebar → updates topbar active tab + reloads chart + signal cards
- Clicking a timeframe button → reloads chart with new interval, re-runs indicator overlays
- Changing leverage → immediately recalculates position sizing and liquidation price
- Changing account size or risk % → immediately recalculates all derived values
- "Mark as Taken" → modal: confirm leverage → saves to trade log → card shows "Taken" badge
- "Skip" → card shows "Skipped" badge, fades out after 2s, removed from view
- Alert bell badge → click to open alerts panel, marks all as read
- New signal fires → browser notification sound (if tab is not focused) + alert added
