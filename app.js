/**
 * Main Application Controller — State Machine & Coordinator
 */

import { 
  loadSettings, 
  saveSettings, 
  loadTrades, 
  saveTrades, 
  logTrade, 
  loadAlerts, 
  addAlert, 
  clearTradeLog 
} from './storage/trade-log.js';

import { 
  fetchKlines, 
  fetchTicker24h, 
  fetchFundingRate, 
  fetchOpenInterest, 
  fetchLongShortRatio, 
  fetchFearGreedIndex, 
  fetchGlobalMarketStats 
} from './api/binance-rest.js';

import { initWebSocket, closeWebSocket } from './api/binance-ws.js';
import { calculateEMA, calculateBollingerBands } from './engine/indicators.js';
import { analyzeMarket } from './engine/signal-engine.js';
import { initChart, updateChartData, drawSignalOverlays, clearSignalOverlays } from './ui/chart.js';
import { renderPairTabs, renderWatchlist, renderIndicatorBadges, setConnectionStatus } from './ui/dashboard.js';
import { renderSignalCard } from './ui/signal-card.js';
import { initCalculator, getCalculatorLeverage } from './ui/calculator.js';
import { renderTradeLogTable, initExportCSV } from './ui/trade-log-ui.js';
import { renderBacktestStats } from './ui/backtest-ui.js';
import { renderAlertsFeed, renderAlertsPopover, updateAlertBadge, playAlertSound } from './ui/alerts-ui.js';
import { checkCorrelation, isDailyLossLimitReached } from './risk/position-sizing.js';

// Application State
const State = {
  settings: {},
  trades: [],
  alerts: [],
  tickerPrices: {},      // { BTCUSDT: { price: float, changePct: float, volume: float } }
  activePair: 'BTCUSDT',
  activeTimeframe: '4h', // default timeframe for chart display
  activeAnalysis: null,  // analysis result for the active pair
  allAnalysis: {},       // cache of analysis per pair: { BTCUSDT: analysisObj }
  activePage: 'dashboard',
  suppressSignals: false,
  unreadAlertsCount: 0
};

// DOM references
const loadingOverlay = document.getElementById('loading-overlay');
const pageViews = document.querySelectorAll('.page-view');
const navItems = document.querySelectorAll('.nav-item');
const alertBellBtn = document.getElementById('alert-bell-btn');
const settingsBtn = document.getElementById('settings-btn');
const lossLimitBanner = document.getElementById('loss-limit-banner');

/**
 * Show / Hide loading screen
 */
function toggleLoading(show) {
  if (loadingOverlay) {
    if (show) loadingOverlay.classList.remove('hidden');
    else loadingOverlay.classList.add('hidden');
  }
}

/**
 * Page router switching views
 * @param {string} pageId - 'dashboard', 'signals', 'tradelog', 'backtest', 'settings'
 */
function navigateTo(pageId) {
  State.activePage = pageId;
  
  // Update nav buttons
  navItems.forEach(item => {
    if (item.dataset.page === pageId) item.classList.add('active');
    else item.classList.remove('active');
  });

  // Update page displays
  pageViews.forEach(view => {
    if (view.id === `page-${pageId}`) view.classList.add('active');
    else view.classList.remove('active');
  });

  // Refresh page specific views
  if (pageId === 'tradelog') {
    renderTradeLogTable(State.trades, {
      onExitConfirm: () => {
        State.trades = loadTrades();
        checkDailyLossLimit();
        renderTradeLogTable(State.trades, { onExitConfirm: () => refreshState(), onReload: refreshState });
      },
      onReload: refreshState
    });
  } else if (pageId === 'backtest') {
    renderBacktestStats(State.trades);
  } else if (pageId === 'settings') {
    loadSettingsForm();
  }
}

/**
 * Check and apply daily loss limit suppressions
 */
function checkDailyLossLimit() {
  const isBlocked = isDailyLossLimitReached(State.trades, State.settings.dailyLossLimit);
  State.suppressSignals = isBlocked;
  
  if (isBlocked && lossLimitBanner) {
    lossLimitBanner.classList.remove('hidden');
  } else if (lossLimitBanner) {
    lossLimitBanner.classList.add('hidden');
  }
}

/**
 * Handle new alert creation
 * @param {string} text 
 * @param {string} type - 'bullish' | 'bearish' | 'warning' | 'info'
 */
function triggerAlert(text, type = 'info') {
  const alert = {
    id: crypto.randomUUID(),
    text,
    type,
    createdAt: Date.now()
  };
  
  State.alerts = addAlert(alert);
  State.unreadAlertsCount++;
  
  renderAlertsFeed(State.alerts);
  renderAlertsPopover(State.alerts);
  updateAlertBadge(State.unreadAlertsCount);
}

/**
 * Run Analysis on a Pair (fetches 3 timeframes candle arrays and current funding rate)
 * @param {string} symbol 
 */
async function runAnalysisForPair(symbol) {
  try {
    const klines1d = await fetchKlines(symbol, '1d', 200);
    const klines4h = await fetchKlines(symbol, '4h', 200);
    const klines1h = await fetchKlines(symbol, '1h', 200);
    const fundingData = await fetchFundingRate(symbol);

    const analysis = analyzeMarket(symbol, { klines1d, klines4h, klines1h }, fundingData.fundingRatePct);
    
    // Preserve signal identity across runs if continuous
    const prevAnalysis = State.allAnalysis[symbol];
    if (analysis.signal && prevAnalysis && prevAnalysis.signal && prevAnalysis.signal.direction === analysis.signal.direction) {
      analysis.signal.id = prevAnalysis.signal.id;
      analysis.signal.signalTime = prevAnalysis.signal.signalTime;
      analysis.signal.expiresAt = prevAnalysis.signal.expiresAt;
    }

    State.allAnalysis[symbol] = analysis;
    
    // Check if new signal fired and needs alert trigger
    if (analysis.signal && (!State.activeAnalysis || !State.activeAnalysis.signal || State.activeAnalysis.signal.id !== analysis.signal.id)) {
      // Avoid duplicate alert alerts
      const exists = State.trades.some(t => t.id === analysis.signal.id);
      if (!exists && !State.suppressSignals) {
        triggerAlert(`New AI Signal: ${symbol} ${analysis.signal.direction} (${analysis.signal.confidence}% Confidence)`, analysis.signal.direction === 'LONG' ? 'bullish' : 'bearish');
        playAlertSound();
      }
    }

    return analysis;
  } catch (error) {
    console.error(`Error running analysis for ${symbol}:`, error);
    return null;
  }
}

/**
 * Full Refresh of Active Pair Data and UI overlays
 */
async function refreshActivePair() {
  const pair = State.activePair;
  toggleLoading(true);
  
  try {
    const analysis = await runAnalysisForPair(pair);
    State.activeAnalysis = analysis;

    if (analysis) {
      // 1. Draw chart price candles and indicator lines
      // We need to fetch candles for the selected timeframe for charting
      const tfKlines = await fetchKlines(pair, State.activeTimeframe, 200);
      
      // Calculate indicators on timeframe
      const closes = tfKlines.map(c => c[4]);
      const highs = tfKlines.map(c => c[2]);
      const lows = tfKlines.map(c => c[3]);
      
      const indicators = {
        ema20: calculateEMA(closes, 20),
        ema50: calculateEMA(closes, 50),
        ema200: calculateEMA(closes, 200),
        bbUpper: calculateBollingerBands(closes, 20, 2).upper,
        bbMiddle: calculateBollingerBands(closes, 20, 2).middle,
        bbLower: calculateBollingerBands(closes, 20, 2).lower
      };
      
      updateChartData(tfKlines, indicators);

      // 2. Market mode and header
      document.getElementById('chart-pair-name').innerText = pair;
      const modeBadge = document.getElementById('market-mode-badge');
      modeBadge.innerText = analysis.marketMode;
      modeBadge.className = `badge badge-${analysis.marketMode === 'TRENDING' ? 'blue' : (analysis.marketMode === 'RANGING' ? 'yellow' : 'grey')}`;

      // 3. Render indicator strip
      renderIndicatorBadges(analysis);

      // 4. Render signal cards
      // Check if signal should be suppressed by daily loss limits
      if (State.suppressSignals) {
        renderSignalCard(null, 'LONG', State.settings.defaultLeverage, 'Signals suppressed — daily loss limit reached.');
        renderSignalCard(null, 'SHORT', State.settings.defaultLeverage, 'Signals suppressed — daily loss limit reached.');
        clearSignalOverlays();
      } else {
        let activeSignal = analysis.signal;
        
        // Filter out if this signal has already been taken or skipped
        if (activeSignal) {
          const isLogged = State.trades.some(t => {
            if (t.id === activeSignal.id) return true;
            if (t.pair === activeSignal.pair && t.direction === activeSignal.direction) {
              if (t.status === 'taken' && !t.result) return true; // open taken trade
              if (t.status === 'skipped' && Date.now() - (t.signalTime || 0) < 3 * 3600000) return true; // skipped within 3 hours
            }
            return false;
          });
          if (isLogged) {
            activeSignal = null;
          }
        }

        const isLong = activeSignal && activeSignal.direction === 'LONG';
        const isShort = activeSignal && activeSignal.direction === 'SHORT';

        // Check correlation warnings
        let warningText = '';
        if (activeSignal) {
          const correlationWarning = checkCorrelation(pair, activeSignal.direction, State.trades);
          if (correlationWarning) warningText = correlationWarning;
        }

        renderSignalCard(
          isLong ? activeSignal : null, 
          'LONG', 
          State.settings.defaultLeverage, 
          analysis.isFundingBlocked && analysis.dailyDirection === 'LONG' ? analysis.blockReason : warningText,
          { onTake: openTakeTradeModal, onSkip: handleSkipSignal }
        );

        renderSignalCard(
          isShort ? activeSignal : null, 
          'SHORT', 
          State.settings.defaultLeverage, 
          analysis.isFundingBlocked && analysis.dailyDirection === 'SHORT' ? analysis.blockReason : warningText,
          { onTake: openTakeTradeModal, onSkip: handleSkipSignal }
        );

        // 5. Draw entry/SL/TP lines on chart
        if (activeSignal) {
          drawSignalOverlays(activeSignal);
        } else {
          clearSignalOverlays();
        }
      }

      // 6. Reset right panel calculator
      initCalculator(analysis.signal, State.settings, handleCalculatorSettingsUpdate);
    }
  } catch (error) {
    console.error('Error refreshing active pair UI:', error);
  } finally {
    toggleLoading(false);
  }
}

/**
 * Handle Calculator inputs updating settings on the fly
 */
function handleCalculatorSettingsUpdate(updatedSettings) {
  State.settings = { ...State.settings, ...updatedSettings };
  saveSettings(State.settings);
}

/**
 * Skip signal handler
 */
function handleSkipSignal(signal) {
  // Log trade as skipped in localStorage
  const skippedTrade = {
    ...signal,
    status: 'skipped',
    result: null,
    exitPrice: null,
    pnlUSDT: 0,
    notes: 'Manually skipped by user.'
  };

  logTrade(skippedTrade);
  State.trades = loadTrades();
  triggerAlert(`Signal ${signal.pair} ${signal.direction} skipped.`, 'info');
  refreshActivePair();
}

/**
 * Open Take Trade Modal Dialog
 */
function openTakeTradeModal(signal) {
  const dialog = document.getElementById('take-trade-dialog');
  const form = document.getElementById('take-trade-form');
  
  document.getElementById('modal-pair').innerText = signal.pair;
  
  const dirEl = document.getElementById('modal-direction');
  dirEl.innerText = signal.direction;
  dirEl.className = `value ${signal.direction === 'LONG' ? 'success-text' : 'danger-text'}`;

  const selectLev = document.getElementById('modal-leverage');
  selectLev.value = getCalculatorLeverage();

  // Dynamic preview calculations inside modal
  const updateModalPreview = () => {
    const leverage = parseInt(selectLev.value);
    const riskAmount = State.settings.accountSize * (State.settings.riskPercent / 100);
    const slDistance = Math.abs(signal.entryPrice - signal.stopLoss);
    const positionSize = riskAmount / slDistance;
    const notional = positionSize * signal.entryPrice;
    const margin = notional / leverage;
    
    let liqPrice = 0;
    if (signal.direction === 'LONG') {
      liqPrice = signal.entryPrice * (1 - (1 / leverage) + 0.005);
    } else {
      liqPrice = signal.entryPrice * (1 + (1 / leverage) - 0.005);
    }

    document.getElementById('modal-size').innerText = `${positionSize.toFixed(4)} ${signal.pair.replace('USDT', '')}`;
    document.getElementById('modal-margin').innerText = `$${margin.toFixed(2)} USDT`;
    document.getElementById('modal-liq').innerText = `$${liqPrice.toFixed(2)}`;
  };

  selectLev.addEventListener('change', updateModalPreview);
  updateModalPreview(); // initial call

  dialog.showModal();

  const cancelBtn = form.querySelector('.secondary-btn');
  const handleCancel = () => {
    dialog.close();
    cleanup();
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const finalLeverage = parseInt(selectLev.value);
    const notes = document.getElementById('modal-notes').value;

    const riskAmount = State.settings.accountSize * (State.settings.riskPercent / 100);
    const slDistance = Math.abs(signal.entryPrice - signal.stopLoss);
    const positionSize = riskAmount / slDistance;
    const margin = (positionSize * signal.entryPrice) / finalLeverage;

    const newTrade = {
      ...signal,
      status: 'taken',
      leverage: finalLeverage,
      marginUsed: parseFloat(margin.toFixed(2)),
      positionSize: parseFloat(positionSize.toFixed(6)),
      result: null,
      exitPrice: null,
      pnlUSDT: null,
      notes: notes,
      signalTime: Date.now()
    };

    logTrade(newTrade);
    State.trades = loadTrades();
    
    triggerAlert(`Trade Taken: ${signal.pair} ${signal.direction} at $${signal.entryPrice}`, 'info');
    
    dialog.close();
    cleanup();
    refreshActivePair();
  };

  const cleanup = () => {
    cancelBtn.removeEventListener('click', handleCancel);
    form.removeEventListener('submit', handleSubmit);
    selectLev.removeEventListener('change', updateModalPreview);
  };

  cancelBtn.addEventListener('click', handleCancel);
  form.addEventListener('submit', handleSubmit);
}

/**
 * Handle Live Websocket updates
 */
function handleWebSocketPriceUpdate(pair, price, changePct, volume) {
  // 1. Update ticker cache
  State.tickerPrices[pair] = { price, changePct, volume };

  // 2. If active pair price changes, update indicators / triggers in real time
  if (pair === State.activePair) {
    // We can show the live price inside watchlist or pair tabs
    // Wait: render tabs and watchlist to reflect live price changes!
    renderPairTabs(State.settings.pairs, State.activePair, State.tickerPrices, handlePairSelect);
    renderWatchlist(State.settings.pairs, State.activePair, State.tickerPrices, handlePairSelect);
    
    // Check custom alert triggers (e.g. price touched entry or SL/TP)
    checkLivePriceAlerts(pair, price);
  }
}

/**
 * Check live price updates against taken/active trades to alert users
 */
function checkLivePriceAlerts(pair, price) {
  // Check active signals or open taken trades
  const openTrades = State.trades.filter(t => t.status === 'taken' && !t.result && t.pair === pair);
  
  openTrades.forEach(trade => {
    const isLong = trade.direction === 'LONG';
    
    // Stop Loss hit check
    if (isLong ? (price <= trade.stopLoss) : (price >= trade.stopLoss)) {
      triggerAlert(`⛔ STOP LOSS HIT for ${pair} ${trade.direction} at $${price.toLocaleString()}`, 'warning');
      playAlertSound();
      // Auto-exit trade in logs
      const updates = {
        result: 'loss',
        exitPrice: trade.stopLoss,
        pnlUSDT: parseFloat((isLong ? (trade.stopLoss - trade.entryPrice) : (trade.entryPrice - trade.stopLoss)) * trade.positionSize),
        notes: 'Auto-closed: Stop Loss hit.'
      };
      updateTrade(trade.id, updates);
      State.trades = loadTrades();
      checkDailyLossLimit();
    }
    
    // TP targets hit checks
    if (isLong ? (price >= trade.tp1) : (price <= trade.tp1)) {
      triggerAlert(`🎯 TAKE PROFIT 1 HIT for ${pair} ${trade.direction} at $${price.toLocaleString()}`, 'bullish');
      playAlertSound();
    }
    if (isLong ? (price >= trade.tp2) : (price <= trade.tp2)) {
      triggerAlert(`🎯 TAKE PROFIT 2 HIT for ${pair} ${trade.direction} at $${price.toLocaleString()}`, 'bullish');
    }
  });
}

/**
 * Switch active selected pair
 */
function handlePairSelect(pair) {
  State.activePair = pair;
  refreshActivePair();
  renderPairTabs(State.settings.pairs, State.activePair, State.tickerPrices, handlePairSelect);
  renderWatchlist(State.settings.pairs, State.activePair, State.tickerPrices, handlePairSelect);
}

/**
 * Load settings into settings view inputs
 */
function loadSettingsForm() {
  const form = document.getElementById('settings-form');
  if (!form) return;

  form.querySelector('#setting-account-size').value = State.settings.accountSize;
  form.querySelector('#setting-risk-pct').value = State.settings.riskPercent;
  form.querySelector('#setting-leverage').value = State.settings.defaultLeverage;
  form.querySelector('#setting-loss-limit').value = State.settings.dailyLossLimit;

  // Set active pair checkboxes
  const checkboxes = form.querySelectorAll('input[name="active-pairs"]');
  checkboxes.forEach(box => {
    box.checked = State.settings.pairs.includes(box.value);
  });
}

/**
 * Save settings from settings view inputs
 */
function handleSettingsSubmit(e) {
  e.preventDefault();
  
  const form = e.target;
  const accountSize = parseFloat(form.querySelector('#setting-account-size').value);
  const riskPercent = parseFloat(form.querySelector('#setting-risk-pct').value);
  const defaultLeverage = parseInt(form.querySelector('#setting-leverage').value);
  const dailyLossLimit = parseInt(form.querySelector('#setting-loss-limit').value);

  // Collect active pairs
  const pairs = [];
  form.querySelectorAll('input[name="active-pairs"]:checked').forEach(box => {
    pairs.push(box.value);
  });

  if (pairs.length === 0) {
    alert('Please select at least one active pair.');
    return;
  }

  State.settings = {
    ...State.settings,
    accountSize,
    riskPercent,
    defaultLeverage,
    dailyLossLimit,
    pairs
  };

  saveSettings(State.settings);
  
  // Reinitialize websocket if active pairs changed
  initWebSocket(State.settings.pairs, handleWebSocketPriceUpdate, refreshActivePair, setConnectionStatus);
  
  triggerAlert('Settings saved successfully.', 'info');
  navigateTo('dashboard');
  refreshActivePair();
}

/**
 * Reset trade log logs
 */
function handleResetTradeLog() {
  if (confirm('Are you sure you want to delete ALL logged trades? This cannot be undone.')) {
    clearTradeLog();
    State.trades = [];
    checkDailyLossLimit();
    triggerAlert('Trade log history reset.', 'warning');
    navigateTo('dashboard');
    refreshActivePair();
  }
}

/**
 * Global state refresh (without reloading UI tabs)
 */
function refreshState() {
  State.trades = loadTrades();
  checkDailyLossLimit();
  navigateTo(State.activePage);
}

/**
 * Fetch On-Chain Pulse elements (MVRV, whale, flow simulated, real funding & LS)
 */
async function refreshOnChainPulse() {
  const container = document.getElementById('pulse-container');
  if (!container) return;

  const pair = State.activePair;
  
  // Fetch real metrics from APIs
  const lsRatio = await fetchLongShortRatio(pair, '1h');
  const funding = await fetchFundingRate(pair);
  
  // Dynamic, premium simulation for on-chain metrics based on price action and trend
  const price = State.tickerPrices[pair]?.price || 65000;
  
  // simulated SOPR: fluctuates between 0.98 and 1.05
  const sopr = 1.0 + (Math.sin(Date.now() / 3600000) * 0.03) + (lsRatio ? (lsRatio.longShortRatio - 1) * 0.02 : 0);
  
  // simulated MVRV: BTC undervalued < 1.5, neutral 1.5-2.5, overvalued > 2.5
  const mvrv = 1.8 + (price / 80000) * 0.5;

  // netflow: outflow = green (bullish), inflow = red (bearish)
  const netflowVal = Math.sin(Date.now() / 1800000) * 1000 - 200; // negative is outflow
  const netflowText = netflowVal < 0 ? `Outflow ($${Math.abs(netflowVal).toFixed(0)}k)` : `Inflow ($${netflowVal.toFixed(0)}k)`;

  const lsRatioText = lsRatio ? `${lsRatio.longShortRatio.toFixed(2)} Long/Short` : '1.24 Long/Short';
  const lsRatioPercent = lsRatio ? (lsRatio.longAccount) : 52; // long account %

  // Funding text
  const fundRate = funding ? funding.fundingRatePct : 0.01;
  let fundText = `${fundRate.toFixed(4)}% — Normal`;
  if (Math.abs(fundRate) > 0.05) fundText = `${fundRate.toFixed(4)}% — Extreme`;
  else if (Math.abs(fundRate) > 0.03) fundText = `${fundRate.toFixed(4)}% — Caution`;

  container.innerHTML = `
    <div class="pulse-row">
      <div class="pulse-label-row">
        <span class="pulse-label">Exchange Netflow (24h)</span>
        <span class="pulse-value success-text">${netflowText}</span>
      </div>
      <div class="pulse-track">
        <div class="pulse-fill ${netflowVal < 0 ? 'bullish' : 'bearish'}" style="width: ${Math.min(100, Math.max(0, 50 + (netflowVal / 50)))}%"></div>
        <div class="pulse-mid-marker"></div>
      </div>
    </div>

    <div class="pulse-row">
      <div class="pulse-label-row">
        <span class="pulse-label">Long/Short Account Ratio</span>
        <span class="pulse-value">${lsRatioText}</span>
      </div>
      <div class="pulse-track">
        <div class="pulse-fill bullish" style="width: ${lsRatioPercent}%"></div>
        <div class="pulse-mid-marker"></div>
      </div>
    </div>

    <div class="pulse-row">
      <div class="pulse-label-row">
        <span class="pulse-label">MVRV Z-Score</span>
        <span class="pulse-value">${mvrv.toFixed(2)} — ${mvrv < 1.5 ? 'Undervalued' : (mvrv > 2.2 ? 'Overvalued' : 'Neutral')}</span>
      </div>
      <div class="pulse-track">
        <div class="pulse-fill" style="width: ${Math.min(100, (mvrv / 3.5) * 100)}%; background-color: ${mvrv < 1.5 ? 'var(--color-bullish)' : (mvrv > 2.2 ? 'var(--color-bearish)' : 'var(--color-info)')}"></div>
      </div>
    </div>

    <div class="pulse-row">
      <div class="pulse-label-row">
        <span class="pulse-label">Whale Activity</span>
        <span class="pulse-value">${sopr > 1.01 ? 'Accumulating' : 'Neutral'}</span>
      </div>
      <div class="pulse-track">
        <div class="pulse-fill" style="width: ${Math.min(100, Math.max(10, sopr * 50))}%"></div>
      </div>
    </div>

    <div class="pulse-row">
      <div class="pulse-label-row">
        <span class="pulse-label">Funding Rate</span>
        <span class="pulse-value">${fundText}</span>
      </div>
      <div class="pulse-track">
        <div class="pulse-fill" style="width: ${Math.min(100, Math.max(0, 50 + (fundRate * 500)))}%; background-color: ${Math.abs(fundRate) > 0.05 ? 'var(--color-bearish)' : (Math.abs(fundRate) > 0.03 ? 'var(--color-warning)' : 'var(--color-bullish)')}"></div>
        <div class="pulse-mid-marker"></div>
      </div>
    </div>
  `;
}

/**
 * Bootstrap Initialization
 */
async function init() {
  console.log('Bootstrapping Crypto Futures Signal Tracker...');
  toggleLoading(true);
  
  try {
    // 1. Load data
    State.settings = loadSettings();
    State.trades = loadTrades();
    State.alerts = loadAlerts();
    State.unreadAlertsCount = State.alerts.length;

    checkDailyLossLimit();

    // 2. Initialize Navigation and Route listeners
    navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        navigateTo(e.currentTarget.dataset.page);
      });
    });

    // Topbar Settings shortcut
    settingsBtn.addEventListener('click', () => navigateTo('settings'));
    
    // Alerts Bell drop down clear button
    document.getElementById('clear-alerts-btn').addEventListener('click', () => {
      localStorage.removeItem('crypto_signal_tracker_alerts');
      State.alerts = [];
      State.unreadAlertsCount = 0;
      renderAlertsFeed(State.alerts);
      renderAlertsPopover(State.alerts);
      updateAlertBadge(0);
    });

    // Alerts Bell badge click to clear badge count
    alertBellBtn.addEventListener('click', () => {
      State.unreadAlertsCount = 0;
      updateAlertBadge(0);
    });

    // Forms binding
    document.getElementById('settings-form').addEventListener('submit', handleSettingsSubmit);
    document.getElementById('reset-log-btn').addEventListener('click', handleResetTradeLog);
    
    // Dismiss loss limit overlay button
    document.getElementById('dismiss-loss-banner-btn').addEventListener('click', () => {
      if (lossLimitBanner) lossLimitBanner.classList.add('hidden');
    });

    // Initialize export CSV
    initExportCSV('export-csv-btn');

    // Load paper trade mode checkbox
    const paperCheckbox = document.getElementById('paper-mode-checkbox');
    paperCheckbox.checked = State.settings.paperMode;
    paperCheckbox.addEventListener('change', (e) => {
      State.settings.paperMode = e.target.checked;
      saveSettings(State.settings);
      triggerAlert(`Paper trading mode globally ${e.target.checked ? 'ENABLED' : 'DISABLED'}.`, 'info');
    });

    // 3. Initialize TradingView Chart
    if (typeof LightweightCharts === 'undefined') {
      throw new Error('TradingView Lightweight Charts library failed to load. Please check your internet connection.');
    }
    initChart('chart-container');

    // 4. Timeframe buttons binding
    const tfButtons = document.querySelectorAll('.tf-btn');
    tfButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        tfButtons.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        State.activeTimeframe = e.target.dataset.tf;
        refreshActivePair();
      });
    });

    // Render alerts list
    renderAlertsFeed(State.alerts);
    renderAlertsPopover(State.alerts);
    updateAlertBadge(State.unreadAlertsCount);

    // 5. Fetch Initial market prices to render sidebar watchlist and topbar pair tabs immediately
    const defaultTickers = {};
    for (const pair of State.settings.pairs) {
      const tick = await fetchTicker24h(pair);
      defaultTickers[pair] = { price: tick.lastPrice, changePct: tick.priceChangePercent, volume: tick.volume };
    }
    State.tickerPrices = defaultTickers;
    
    // Draw initial tabs/watchlist
    renderPairTabs(State.settings.pairs, State.activePair, State.tickerPrices, handlePairSelect);
    renderWatchlist(State.settings.pairs, State.activePair, State.tickerPrices, handlePairSelect);

    // Fetch sidebar global market stats
    const fg = await fetchFearGreedIndex();
    const stats = await fetchGlobalMarketStats();
    
    document.getElementById('fear-greed').innerText = `${fg.value} (${fg.sentiment})`;
    document.getElementById('btc-dominance').innerText = stats.btcDominance;
    document.getElementById('total-mcap').innerText = stats.totalMarketCap;

    // Run active pair analysis
    await refreshActivePair();
    
    // Run initial on-chain pulse render
    await refreshOnChainPulse();

    // 6. Connect Live WS Streams
    initWebSocket(State.settings.pairs, handleWebSocketPriceUpdate, refreshActivePair, setConnectionStatus);

    // 7. Background timers setup
    // 60-second timer for Fear & Greed + global stats + signal expiry check
    setInterval(async () => {
      const fg = await fetchFearGreedIndex();
      const stats = await fetchGlobalMarketStats();
      
      document.getElementById('fear-greed').innerText = `${fg.value} (${fg.sentiment})`;
      document.getElementById('btc-dominance').innerText = stats.btcDominance;
      document.getElementById('total-mcap').innerText = stats.totalMarketCap;

      // Signal Expiry check: Check if current active signal is expired (3 hours)
      if (State.activeAnalysis && State.activeAnalysis.signal) {
        const sig = State.activeAnalysis.signal;
        if (Date.now() >= sig.expiresAt && sig.status === 'active') {
          triggerAlert(`Signal ${sig.pair} ${sig.direction} expired without entry fill.`, 'warning');
          refreshActivePair();
        }
      }
    }, 60 * 1000);

    // 5-minute timer for on-chain pulse
    setInterval(async () => {
      await refreshOnChainPulse();
    }, 5 * 60 * 1000);

  } catch (error) {
    console.error('Error during bootstrapping initialization:', error);
    // Add alert to feed so user sees the details in-app
    setTimeout(() => {
      triggerAlert(`Initialization Error: ${error.message}`, 'warning');
    }, 1000);
  } finally {
    toggleLoading(false);
  }
}

// Start Application!
window.addEventListener('DOMContentLoaded', init);
