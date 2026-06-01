# Crypto Futures Signal Tracker — Build Spec

A client-side web application for tracking Binance USDⓈ-M Futures pairs, generating rule-based trade signals, and managing position sizing for swing trades.

**Built for:** Pichan  
**Exchange:** Binance Futures USDⓈ-M  
**Strategy:** Swing trading (hours to days), 5x–10x leverage, Isolated margin  
**Account size:** ~$600 USDT, 10% risk per trade (~$60/trade)

---

## Folder Structure

```
crypto tracker/
├── README.md              ← This file. Start here.
├── tech-stack.md          ← APIs, libraries, project file structure
├── signal-engine.md       ← Full rule-based signal logic (the brain of the app)
├── ui-design.md           ← Layout, pages, components, interactions
├── risk-management.md     ← Position sizing, liquidation, loss limits
└── features.md            ← Full feature list, v1 vs v2 priority
```

---

## What This App Does

1. Connects to Binance public WebSocket and REST API — no API key required
2. Fetches real-time price + OHLCV candle data for 5 pairs (BTC, ETH, SOL, BNB, XRP vs USDT)
3. Runs a rule-based signal engine every time a new 1H candle closes
4. Scores signals using 3-timeframe confluence (1D + 4H + 1H) — only shows signals ≥ 70% confidence
5. Displays trade cards: direction (Long/Short), entry zone, stop loss, TP1/TP2/TP3, liquidation price
6. Calculates position size automatically based on account size and risk %
7. Tracks trade history (paper + real) and shows backtest stats

---

## What This App Does NOT Do

- Does NOT place orders on Binance (read-only, no private API key)
- Does NOT use AI/LLM at runtime — all signals are pure JS math
- Does NOT have a backend server — fully client-side, runs in browser
- Does NOT store data remotely — uses localStorage only

---

## Key Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| Signal source | Rule-based JS | No API cost, runs offline, deterministic |
| Margin mode | Isolated only | Limits max loss to margin on that trade |
| Partial TP | 50% at TP1, 30% at TP2, 20% trail to TP3 | Lock profit early, let winner run |
| Min confidence | 70% | Filter noise, only high-conviction setups |
| Timeframes | 1D + 4H + 1H confluence | Industry standard for swing futures |
| SL method | ATR-based (1.5× ATR-14) | Adapts to volatility, not fixed % |
| Data source | Binance public API | Free, reliable, no auth needed |

---

## Read Order for AntiGravity

1. `README.md` — understand scope and constraints  
2. `tech-stack.md` — set up project structure and API connections  
3. `signal-engine.md` — implement the signal logic first (core of the app)  
4. `risk-management.md` — implement position sizing calculator  
5. `ui-design.md` — build the interface around the working engine  
6. `features.md` — check v1 checklist before shipping  
