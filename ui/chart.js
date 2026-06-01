/**
 * TradingView Lightweight Charts Setup and Rendering Module
 * Uses standard HEX colors for cross-version compatibility.
 */

let chart = null;
let candleSeries = null;
let ema20Series = null;
let ema50Series = null;
let ema200Series = null;
let bbUpperSeries = null;
let bbMiddleSeries = null;
let bbLowerSeries = null;

// Price line overlays (stored so they can be removed/updated)
let entryZoneHighLine = null;
let entryZoneLowLine = null;
let stopLossLine = null;
let tp1Line = null;
let tp2Line = null;
let tp3Line = null;

/**
 * Initialize TradingView Lightweight Chart
 * @param {string} containerId - Element ID to inject the chart into
 */
export function initChart(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Clear existing chart if already initialized
  container.innerHTML = '';

  // 1. Create Chart
  chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: 280,
    layout: {
      background: { color: 'transparent' },
      textColor: '#4a5568', // Slate grey text for light theme
      fontSize: 11,
      fontFamily: 'Inter, sans-serif'
    },
    grid: {
      vertLines: { color: '#f1f5f9' }, // Very light grey grid lines
      horzLines: { color: '#f1f5f9' }
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: {
        color: '#3b82f6', // Info blue
        width: 1,
        style: 3, // dashed
        labelBackgroundColor: '#4a5568'
      },
      horzLine: {
        color: '#3b82f6',
        width: 1,
        style: 3,
        labelBackgroundColor: '#4a5568'
      }
    },
    timeScale: {
      timeVisible: true,
      secondsVisible: false,
      borderColor: '#cbd5e1' // light border grey
    },
    rightPriceScale: {
      borderColor: '#cbd5e1',
      autoScale: true
    }
  });

  // 2. Add Candlestick Series
  candleSeries = chart.addCandlestickSeries({
    upColor: '#22c55e', // --color-bullish
    downColor: '#ef4444', // --color-bearish
    borderUpColor: '#22c55e',
    borderDownColor: '#ef4444',
    wickUpColor: '#22c55e',
    wickDownColor: '#ef4444'
  });

  // 3. Add Indicators Series (Muted line styles)
  ema20Series = chart.addLineSeries({
    color: '#3b82f6', // --color-info
    lineWidth: 1,
    title: 'EMA 20'
  });

  ema50Series = chart.addLineSeries({
    color: '#f59e0b', // --color-warning
    lineWidth: 1,
    title: 'EMA 50'
  });

  ema200Series = chart.addLineSeries({
    color: '#ef4444', // --color-bearish
    lineWidth: 1,
    lineStyle: 3, // dashed
    title: 'EMA 200'
  });

  // Bollinger Bands Series
  bbUpperSeries = chart.addLineSeries({
    color: 'rgba(15, 23, 42, 0.15)',
    lineWidth: 1,
    lineStyle: 2, // dotted
    title: 'BB Upper'
  });

  bbMiddleSeries = chart.addLineSeries({
    color: 'rgba(15, 23, 42, 0.1)',
    lineWidth: 1,
    lineStyle: 2,
    title: 'BB Middle'
  });

  bbLowerSeries = chart.addLineSeries({
    color: 'rgba(15, 23, 42, 0.15)',
    lineWidth: 1,
    lineStyle: 2,
    title: 'BB Lower'
  });

  // Resize handler
  const resizeObserver = new ResizeObserver(entries => {
    if (entries.length === 0 || !chart) return;
    const { width, height } = entries[0].contentRect;
    chart.applyOptions({ width, height: 280 });
  });
  resizeObserver.observe(container);
}

/**
 * Render Chart Data and Indicator Overlays
 * @param {Array} klines - Raw kline candles data
 * @param {Object} indicators - Precalculated indicator values arrays
 */
export function updateChartData(klines, indicators) {
  if (!chart || !candleSeries) return;

  // Format candles for TradingView (timestamps in SECONDS)
  const chartCandles = klines.map(c => ({
    time: c[0] / 1000,
    open: c[1],
    high: c[2],
    low: c[3],
    close: c[4]
  }));

  candleSeries.setData(chartCandles);

  const times = klines.map(c => c[0] / 1000);

  // Set EMA overlays (filtering out any null/undefined values to prevent Y-axis scale to 0)
  if (indicators.ema20) {
    ema20Series.setData(indicators.ema20.map((val, idx) => ({ time: times[idx], value: val })).filter(d => d.value !== null && d.value !== undefined && !isNaN(d.value)));
  }
  if (indicators.ema50) {
    ema50Series.setData(indicators.ema50.map((val, idx) => ({ time: times[idx], value: val })).filter(d => d.value !== null && d.value !== undefined && !isNaN(d.value)));
  }
  if (indicators.ema200) {
    ema200Series.setData(indicators.ema200.map((val, idx) => ({ time: times[idx], value: val })).filter(d => d.value !== null && d.value !== undefined && !isNaN(d.value)));
  }

  // Set Bollinger Bands overlays (filtering out any null/undefined values to prevent Y-axis scale to 0)
  if (indicators.bbUpper) {
    bbUpperSeries.setData(indicators.bbUpper.map((val, idx) => ({ time: times[idx], value: val })).filter(d => d.value !== null && d.value !== undefined && !isNaN(d.value)));
  }
  if (indicators.bbMiddle) {
    bbMiddleSeries.setData(indicators.bbMiddle.map((val, idx) => ({ time: times[idx], value: val })).filter(d => d.value !== null && d.value !== undefined && !isNaN(d.value)));
  }
  if (indicators.bbLower) {
    bbLowerSeries.setData(indicators.bbLower.map((val, idx) => ({ time: times[idx], value: val })).filter(d => d.value !== null && d.value !== undefined && !isNaN(d.value)));
  }

  // Auto scale price scale to fit content
  chart.timeScale().fitContent();
}

/**
 * Draw Horizontal Trade Signal Overlays
 * @param {Object} signal - Active trade signal object, or null to clear overlays
 */
export function drawSignalOverlays(signal) {
  // Clear any existing custom price lines
  clearSignalOverlays();

  if (!signal || !candleSeries) return;

  const isLong = signal.direction === 'LONG';
  const tpColor = '#22c55e'; // Take profit is always green (profitable target)
  const stopColor = '#ef4444'; // Stop loss is always red (loss exit)

  // 1. Entry Price line
  entryZoneHighLine = candleSeries.createPriceLine({
    price: signal.entryPrice,
    color: '#3b82f6', // Blue info line
    lineWidth: 2,
    lineStyle: 1, // solid
    axisLabelVisible: true,
    title: 'ENTRY'
  });

  // 2. Stop Loss line
  stopLossLine = candleSeries.createPriceLine({
    price: signal.stopLoss,
    color: stopColor,
    lineWidth: 2,
    lineStyle: 3, // dashed
    axisLabelVisible: true,
    title: 'STOP LOSS'
  });

  // 3. Take Profit lines
  tp1Line = candleSeries.createPriceLine({
    price: signal.tp1,
    color: tpColor,
    lineWidth: 1.5,
    lineStyle: 2, // dotted
    axisLabelVisible: true,
    title: `TP1 (${signal.tp1Pct}%)`
  });

  tp2Line = candleSeries.createPriceLine({
    price: signal.tp2,
    color: tpColor,
    lineWidth: 1.5,
    lineStyle: 2, // dotted
    axisLabelVisible: true,
    title: `TP2 (${signal.tp2Pct}%)`
  });

  tp3Line = candleSeries.createPriceLine({
    price: signal.tp3,
    color: tpColor,
    lineWidth: 1.5,
    lineStyle: 2, // dotted
    axisLabelVisible: true,
    title: `TP3 (${signal.tp3Pct}%)`
  });
}

/**
 * Remove Signal Overlay Price Lines from Chart
 */
export function clearSignalOverlays() {
  if (!candleSeries) return;

  if (entryZoneHighLine) { candleSeries.removePriceLine(entryZoneHighLine); entryZoneHighLine = null; }
  if (entryZoneLowLine) { candleSeries.removePriceLine(entryZoneLowLine); entryZoneLowLine = null; }
  if (stopLossLine) { candleSeries.removePriceLine(stopLossLine); stopLossLine = null; }
  if (tp1Line) { candleSeries.removePriceLine(tp1Line); tp1Line = null; }
  if (tp2Line) { candleSeries.removePriceLine(tp2Line); tp2Line = null; }
  if (tp3Line) { candleSeries.removePriceLine(tp3Line); tp3Line = null; }
}
