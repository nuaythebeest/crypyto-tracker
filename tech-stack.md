# Tech Stack & Project Structure

## Technology Choices

| Layer | Technology | Notes |
|---|---|---|
| Language | HTML + CSS + Vanilla JavaScript | No framework required. Keep it simple. |
| Charts | TradingView Lightweight Charts v4 | Free, open source, works with custom OHLCV data |
| Data | Binance Public REST + WebSocket | No API key needed |
| Storage | Browser localStorage | Trade log, settings, backtest history |
| Styling | CSS custom properties (variables) | No framework — custom design system |
| Icons | Tabler Icons (CDN) | Outline style only |

**No backend. No Node.js server. No database. Runs entirely in the browser.**

---

## Project File Structure

```
crypto-tracker/
├── index.html                  ← Entry point, app shell
├── style.css                   ← Global styles, design tokens
├── app.js                      ← App init, routing, state management
│
├── api/
│   ├── binance-rest.js         ← REST API calls (candles, ticker, funding rate)
│   └── binance-ws.js           ← WebSocket connection (live price stream)
│
├── engine/
│   ├── indicators.js           ← EMA, RSI, MACD, BB, ATR, ADX calculations
│   ├── signal-engine.js        ← Main signal logic, confluence scoring
│   ├── divergence.js           ← RSI divergence detection
│   └── market-structure.js     ← Break of Structure (BOS) detection
│
├── risk/
│   └── position-sizing.js      ← Position size, margin, liquidation price calculator
│
├── storage/
│   └── trade-log.js            ← Save/load trades from localStorage
│
└── ui/
    ├── dashboard.js            ← Main dashboard panel
    ├── signal-card.js          ← Trade card component
    ├── chart.js                ← Chart setup and overlay rendering
    ├── calculator.js           ← Position sizing UI
    ├── trade-log-ui.js         ← Trade log page
    ├── backtest-ui.js          ← Backtest stats panel
    └── alerts-ui.js            ← Price alerts panel
```

---

## Binance API Reference

### REST Endpoints (no auth required)

#### Get OHLCV Candle Data
```
GET https://api.binance.com/api/v3/klines

Parameters:
  symbol    = BTCUSDT
  interval  = 1h | 4h | 1d
  limit     = 200  (enough for EMA 200 + lookback)

Response array per candle:
  [0]  Open time (ms)
  [1]  Open price
  [2]  High price
  [3]  Low price
  [4]  Close price
  [5]  Volume
  [6]  Close time (ms)

Example:
  https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=4h&limit=200
```

#### Get 24h Ticker
```
GET https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT

Key fields: lastPrice, priceChangePercent, volume, highPrice, lowPrice
```

#### Get Funding Rate (Futures)
```
GET https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT

Key fields: lastFundingRate, nextFundingTime, markPrice
```

#### Get Open Interest
```
GET https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT

Key field: openInterest
```

#### Get Long/Short Ratio
```
GET https://fapi.binance.com/futures/data/globalLongShortAccountRatio
  ?symbol=BTCUSDT&period=1h&limit=1

Key fields: longShortRatio, longAccount, shortAccount
```

---

### WebSocket — Live Price Stream

```javascript
// Single ticker stream
const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@ticker');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // data.c = current price
  // data.P = 24h price change %
  // data.v = 24h volume
};

// Combined multi-pair stream
const ws = new WebSocket(
  'wss://stream.binance.com:9443/stream?streams=btcusdt@ticker/ethusdt@ticker/solusdt@ticker/bnbusdt@ticker/xrpusdt@ticker'
);
```

#### Kline (candle) stream — triggers signal engine on candle close
```javascript
const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@kline_1h');

ws.onmessage = (event) => {
  const kline = JSON.parse(event.data).k;
  if (kline.x === true) {
    // x = true means candle is CLOSED — run signal engine now
    runSignalEngine('BTCUSDT');
  }
};
```

---

## Supported Pairs (v1)

```javascript
const PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
```

---

## TradingView Lightweight Charts Setup

```html
<script src="https://unpkg.com/lightweight-charts/dist/lightweight-charts.standalone.production.js"></script>
```

```javascript
const chart = LightweightCharts.createChart(document.getElementById('chart'), {
  width: container.clientWidth,
  height: 300,
  layout: { background: { color: 'transparent' }, textColor: '#888' },
  grid: { vertLines: { color: '#1a1a2e' }, horzLines: { color: '#1a1a2e' } },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  timeScale: { timeVisible: true, secondsVisible: false },
});

const candleSeries = chart.addCandlestickSeries({
  upColor: '#22c55e', downColor: '#ef4444',
  borderUpColor: '#22c55e', borderDownColor: '#ef4444',
  wickUpColor: '#22c55e', wickDownColor: '#ef4444',
});

// Feed data from Binance klines response
candleSeries.setData(candles.map(c => ({
  time: c[0] / 1000,   // convert ms to seconds
  open: parseFloat(c[1]),
  high: parseFloat(c[2]),
  low: parseFloat(c[3]),
  close: parseFloat(c[4]),
})));
```

---

## localStorage Schema

```javascript
// Settings
localStorage.setItem('settings', JSON.stringify({
  accountSize: 600,       // USDT
  riskPercent: 10,        // % per trade
  defaultLeverage: 7,     // x
  activePair: 'BTCUSDT',
  pairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'],
}));

// Trade log entry
{
  id: 'uuid',
  pair: 'BTCUSDT',
  direction: 'LONG',           // LONG | SHORT
  entryPrice: 67200,
  stopLoss: 65800,
  tp1: 69500, tp2: 72000, tp3: 75800,
  leverage: 7,
  marginUsed: 85.71,
  confidence: 82,
  signalTime: 1717200000000,   // ms timestamp
  status: 'paper',             // paper | taken | skipped
  result: null,                // null | win | loss | partial
  exitPrice: null,
  pnlUSDT: null,
  notes: '',
}

// Price alerts
[{
  id: 'uuid',
  pair: 'BTCUSDT',
  price: 65000,
  direction: 'below',   // above | below
  triggered: false,
  createdAt: 1717200000000,
}]
```

---

## Browser Compatibility

Target: Chrome 90+, Firefox 88+, Safari 14+. No IE support needed.  
Responsive: desktop-first, minimum width 1200px (trading app, not mobile).
