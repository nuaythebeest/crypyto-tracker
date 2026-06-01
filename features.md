# Feature List — v1 vs v2

## Version 1 — Build This First

These are the core features. App is not useful without all of them.

### Data & Connectivity
- [ ] Binance WebSocket connection for live price stream (5 pairs)
- [ ] Binance REST API: OHLCV candles for 1H, 4H, 1D timeframes
- [ ] Binance Futures REST: funding rate, open interest, long/short ratio
- [ ] Auto-reconnect WebSocket on disconnect
- [ ] Live connection status indicator (green dot = connected)

### Signal Engine
- [ ] EMA 20, 50, 200 calculation
- [ ] RSI (14) calculation
- [ ] MACD (12, 26, 9) calculation
- [ ] Bollinger Bands (20, 2) calculation
- [ ] ATR (14) calculation — used for SL sizing
- [ ] ADX (14) calculation — trending vs ranging detection
- [ ] 3-timeframe confluence scoring (1D + 4H + 1H)
- [ ] Confidence score 0–100 (only show signals ≥ 70)
- [ ] Funding rate hard filter (suppress signals when rate extreme)
- [ ] RSI divergence detection (bullish + bearish)
- [ ] Break of Structure (BOS) detection on 4H
- [ ] ATR-based stop loss calculation (1.5× ATR)
- [ ] TP1, TP2, TP3 calculation (1.5×, 3×, 5× risk)
- [ ] Signal expiry after 3 candles (3H)
- [ ] Market mode detection (Trending / Ranging / Transitioning)
- [ ] Direction conflict check (daily vs 4H must agree — no signal if they conflict)

### Risk Management
- [ ] Position size calculator (risk amount ÷ SL distance)
- [ ] Margin required calculation
- [ ] Liquidation price (Isolated margin, LONG + SHORT formulas)
- [ ] Buffer to liquidation % with color coding (safe / caution / dangerous)
- [ ] SL vs liquidation safety check (2% minimum gap)
- [ ] Leverage selector (3x, 5x, 7x, 10x, 15x, 20x)
- [ ] Correlation warning (BTC/ETH/SOL same direction)
- [ ] Daily loss limit (stop showing signals after 2 consecutive losses)
- [ ] Partial TP logic display (50% → 30% → 20% plan)

### UI — Dashboard
- [ ] 3-column layout (sidebar + main + right panel)
- [ ] Topbar with pair tabs and live prices
- [ ] TradingView Lightweight Charts with EMA + BB overlays
- [ ] Timeframe selector (15m, 1H, 4H, 1D, 1W)
- [ ] Entry zone, SL, TP1/TP2/TP3 lines drawn on chart when signal active
- [ ] Indicator badge strip below chart
- [ ] Market mode badge on chart
- [ ] Signal cards (Long + Short side by side)
- [ ] Confidence score bar with breakdown
- [ ] "Mark as Taken" and "Skip" actions on signal cards
- [ ] Watchlist in sidebar with live prices
- [ ] Market stats in sidebar (BTC dom, Fear & Greed, Total MCap)

### UI — Right Panel
- [ ] Position sizing calculator (all inputs editable, auto-calculates)
- [ ] On-chain pulse section (5 metrics)
- [ ] Alerts feed

### Trade Log
- [ ] Save signal to trade log when "Mark as Taken" or "Skip" is clicked
- [ ] Paper trade mode toggle (marks all logged trades as Paper)
- [ ] Trade log table (all columns as specified in ui-design.md)
- [ ] User can add result (Win / Loss / Partial) and exit price
- [ ] PnL auto-calculated from exit price

### Backtest Stats
- [ ] Win rate % from trade log
- [ ] Avg R:R from trade log
- [ ] Total PnL
- [ ] Last 20 signals win/loss dot visualization
- [ ] Equity curve line chart

### Alerts
- [ ] Auto-alert when price enters signal entry zone
- [ ] Auto-alert when TP1 / TP2 / TP3 hit
- [ ] Auto-alert when SL hit
- [ ] Auto-alert when daily loss limit triggered
- [ ] Alert badge count on topbar bell icon
- [ ] Browser audio notification (beep) when new signal fires

### Settings
- [ ] Account size (USDT)
- [ ] Risk per trade (%)
- [ ] Default leverage
- [ ] Active pairs (checkboxes)
- [ ] Daily loss limit (default 2)
- [ ] Reset trade log

---

## Version 2 — Nice to Have

Add these after v1 is stable and tested.

### Signal Enhancements
- [ ] News/event calendar (FOMC, CPI, NFP) — show warning banner before events
- [ ] Trading session indicator (Asia / London / New York) on chart
- [ ] Stochastic RSI indicator (faster than standard RSI)
- [ ] VWAP overlay on chart (useful for intraday reference)
- [ ] Fibonacci auto-draw on chart (0.382, 0.5, 0.618 levels from last swing)

### Risk Management
- [ ] Max concurrent positions setting
- [ ] Portfolio heat display (total capital at risk across all open trades)
- [ ] Breakeven suggestion: after partial TP, display "Move SL to breakeven now" prompt

### UI Improvements
- [ ] Dark mode / light mode toggle
- [ ] Custom pair input (add any Binance futures pair, not just the 5 defaults)
- [ ] Signal history calendar view (heatmap of signal days)
- [ ] Confidence filter slider on Signals page
- [ ] Export trade log as CSV

### Backtest
- [ ] Confidence bucket win rate analysis (does 80%+ confidence actually win more?)
- [ ] Drawdown chart (max drawdown period visualization)
- [ ] Per-pair win rate breakdown

### Alerts v2
- [ ] Telegram bot integration for alerts outside browser
- [ ] Custom price alert (user sets any price for any pair)
- [ ] "Signal about to expire" warning (30 min before expiry)

---

## Build Order Recommendation for AntiGravity

```
Phase 1 — Engine first, no UI
  1. Set up project structure (index.html, app.js, style.css)
  2. Implement Binance REST API (binance-rest.js) — fetch candles + ticker
  3. Implement all indicator calculations (indicators.js)
  4. Implement signal engine (signal-engine.js) — log output to console first
  5. Implement position sizing + liquidation formulas (position-sizing.js)
  6. Test engine works correctly with real Binance data

Phase 2 — Core UI
  7. Build 3-column layout shell (topbar, sidebar, main, right panel)
  8. Integrate TradingView chart with Binance candle data
  9. Add indicator overlays (EMA, BB, volume)
  10. Build signal card component
  11. Connect signal engine output → signal cards

Phase 3 — Right panel + storage
  12. Build position sizing calculator UI (connects to position-sizing.js)
  13. Add on-chain pulse section
  14. Implement trade log (localStorage save/load)
  15. Build trade log table UI
  16. Add WebSocket live price stream (binance-ws.js)

Phase 4 — Backtest + alerts
  17. Build backtest stats from trade log data
  18. Implement alerts logic + feed UI
  19. Add daily loss limit + correlation warning
  20. Final polish: confidence bar, market mode badge, loading states

Phase 5 — Testing
  21. Test with live Binance data for 24h
  22. Verify signal engine fires on actual 1H candle closes
  23. Verify liquidation price math against Binance calculator
  24. Test WebSocket reconnection
  25. Check localStorage persistence across browser refresh
```

---

## Known Constraints / Gotchas

- Binance rate limits: REST API allows 1200 requests/min. Fetching 200 candles × 3 timeframes × 5 pairs = 30 requests per signal cycle. Well within limits.
- WebSocket: Binance closes idle WebSocket connections after 24h. Implement ping/pong keepalive every 30 minutes.
- TradingView Lightweight Charts time format: requires Unix timestamps in **seconds**, not milliseconds. Binance returns ms — divide by 1000.
- Fear & Greed Index: use `https://api.alternative.me/fng/?limit=1` (free, no auth).
- BTC Dominance + Total Market Cap: use CoinGecko public API `https://api.coingecko.com/api/v3/global` (free, 50 calls/min).
- CORS: All Binance and CoinGecko public endpoints support CORS for browser requests. No proxy needed.
- LocalStorage limit: ~5MB per origin. Trade log of 1000 trades ≈ 500KB. Not a concern.
