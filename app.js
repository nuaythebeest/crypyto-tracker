/**
 * Main Application Controller — State Machine & Coordinator
 */

import {
  loadSettings,
  saveSettings,
  loadTrades,
  saveTrades,
  logTrade,
  updateTrade,
  loadAlerts,
  addAlert,
  clearTradeLog
} from './storage/trade-log.js';

import {
  fetchKlines,
  fetchKlinesRange,
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
import { initEngineBacktest } from './ui/engine-backtest-ui.js';
import { renderAlertsFeed, renderAlertsPopover, updateAlertBadge, playAlertSound } from './ui/alerts-ui.js';
import { checkCorrelation, isDailyLossLimitReached, getMaxSafeLeverage } from './risk/position-sizing.js';
import { sendTelegram, sendTelegramSilent, fetchTelegramUpdates } from './api/telegram.js';

// Alert cooldown constant — minimum ms between same alert type for same trade
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

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
  unreadAlertsCount: 0,
  alertCooldowns: {},    // { "tradeId:alertType": lastFiredTimestamp } — prevents alert spam
  lastTelegramUpdateId: 0 // tracks last-seen Telegram update for reply polling
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
    const buildTradeLogCallbacks = () => ({
      onExitConfirm: () => {
        State.trades = loadTrades();
        checkDailyLossLimit();
        renderTradeLogTable(State.trades, buildTradeLogCallbacks());
      },
      onReload: refreshState,
      onMarkTaken: (trade) => {
        // Open take-trade modal for an 'observed' signal — same flow as dashboard "Take" button
        openTakeTradeModal(trade);
      }
    });
    renderTradeLogTable(State.trades, buildTradeLogCallbacks());
  } else if (pageId === 'signals') {
    renderMarketScanner();
  } else if (pageId === 'backtest') {
    State.trades = loadTrades();  // always fresh load before rendering backtest
    renderBacktestStats(State.trades);
  } else if (pageId === 'settings') {
    loadSettingsForm();
  }
}

/**
 * Check and apply daily loss limit suppressions
 */
function checkDailyLossLimit() {
  const wasBlocked = State.suppressSignals;
  const isBlocked = isDailyLossLimitReached(State.trades, State.settings.dailyLossLimit);
  State.suppressSignals = isBlocked;
  
  if (isBlocked && lossLimitBanner) {
    lossLimitBanner.classList.remove('hidden');
    // Send Telegram only on the transition to blocked (not on every check)
    if (!wasBlocked) {
      sendTelegramSilent(
        `⛔ <b>DAILY LOSS LIMIT REACHED</b>\n` +
        `2 consecutive losses today.\n` +
        `No new signals until 00:00 UTC.\n` +
        `Protect your capital. Step away and review.`
      );
    }
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
    const klines1w = await fetchKlines(symbol, '1w', 30);  // weekly for macro trend filter
    const fundingData = await fetchFundingRate(symbol);

    const analysis = analyzeMarket(symbol, { klines1d, klines4h, klines1h, klines1w }, fundingData.fundingRatePct);
    
    // Preserve signal identity across runs if continuous
    const prevAnalysis = State.allAnalysis[symbol];
    if (analysis.signal && prevAnalysis && prevAnalysis.signal && prevAnalysis.signal.direction === analysis.signal.direction) {
      analysis.signal.id = prevAnalysis.signal.id;
      analysis.signal.signalTime = prevAnalysis.signal.signalTime;
      analysis.signal.expiresAt = prevAnalysis.signal.expiresAt;
    }

    State.allAnalysis[symbol] = analysis;

    // Auto-log new signals as 'observed' for complete signal history.
    // Two-tier de-duplication:
    //   1. Exact ID match (State.allAnalysis preserved ID across soft refreshes)
    //   2. Same pair+direction within 3 hours from localStorage (survives hard reload / WS reconnect)
    //      → silently update prices on existing record instead of firing a new alert
    let isNewSignal = false;
    if (analysis.signal && !State.suppressSignals) {
      const alreadyLogged = State.trades.some(t => t.id === analysis.signal.id);

      if (!alreadyLogged) {
        // Secondary guard: same continuing signal with drifted price (reconnect / page reload)
        const recentSame = State.trades.find(t =>
          t.pair === analysis.signal.pair &&
          t.direction === analysis.signal.direction &&
          (t.status === 'observed' || t.status === 'taken') &&
          !t.result &&
          Date.now() - (t.signalTime || 0) < 3 * 3600000
        );

        if (recentSame) {
          // Same signal, prices drifted — update existing record silently, adopt persisted identity
          updateTrade(recentSame.id, {
            entryPrice: analysis.signal.entryPrice,
            stopLoss:   analysis.signal.stopLoss,
            tp1: analysis.signal.tp1, tp2: analysis.signal.tp2, tp3: analysis.signal.tp3,
            slDistancePct: analysis.signal.slDistancePct,
            tp1Pct: analysis.signal.tp1Pct, tp2Pct: analysis.signal.tp2Pct, tp3Pct: analysis.signal.tp3Pct,
          });
          analysis.signal.id         = recentSame.id;
          analysis.signal.signalTime  = recentSame.signalTime;
          analysis.signal.expiresAt   = recentSame.expiresAt;
          State.trades = loadTrades();
        } else {
          // Genuinely new signal — log + alert
          isNewSignal = true;
          logTrade({
            ...analysis.signal,
            status: 'observed',
            leverage: State.settings.defaultLeverage,
            marginUsed: null,
            positionSize: null,
            result: null,
            exitPrice: null,
            pnlUSDT: null,
            notes: 'Signal observed — not yet entered.'
          });
          State.trades = loadTrades();
        }
      }
    }

    // Fire in-app alert + Telegram on first-seen signal
    if (isNewSignal) {
      const sig = analysis.signal;
      triggerAlert(
        `New Signal: ${symbol} ${sig.direction} (${sig.confidence}% Conf)`,
        sig.direction === 'LONG' ? 'bullish' : 'bearish'
      );
      if (symbol === State.activePair) playAlertSound();

      sendTelegramSilent(
        `📡 <b>NEW SIGNAL — ${symbol} ${sig.direction}</b>\n` +
        `Confidence: ${sig.confidence}%\n` +
        `Entry: $${sig.entryPrice.toFixed(2)}\n` +
        `SL: $${sig.stopLoss.toFixed(2)} (-${(sig.slDistancePct || 0).toFixed(1)}%)\n` +
        `TP1: $${sig.tp1.toFixed(2)} (+${(sig.tp1Pct || 0).toFixed(1)}%)\n` +
        `TP2: $${sig.tp2.toFixed(2)} (+${(sig.tp2Pct || 0).toFixed(1)}%)\n` +
        `TP3: $${sig.tp3.toFixed(2)} (+${(sig.tp3Pct || 0).toFixed(1)}%)\n` +
        `R:R 1:${(sig.riskReward || 2).toFixed(1)} | Expires in 3H`
      );
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
        
        // Hide signal card if already taken (open) or recently skipped.
        // 'observed' status does NOT hide the card — it just means it was auto-logged, not entered yet.
        if (activeSignal) {
          const isLogged = State.trades.some(t => {
            // Exact ID match: only suppress if taken or skipped (not 'observed')
            if (t.id === activeSignal.id && t.status !== 'observed') return true;
            // Same pair+direction: open taken trade, or skipped within 3 hours
            if (t.pair === activeSignal.pair && t.direction === activeSignal.direction) {
              if (t.status === 'taken' && !t.result) return true;
              if (t.status === 'skipped' && Date.now() - (t.signalTime || 0) < 3 * 3600000) return true;
            }
            return false;
          });
          if (isLogged) activeSignal = null;
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
          analysis.isSignalBlocked ? analysis.blockReason : warningText,
          { onTake: openTakeTradeModal, onSkip: handleSkipSignal }
        );

        renderSignalCard(
          isShort ? activeSignal : null,
          'SHORT',
          State.settings.defaultLeverage,
          analysis.isSignalBlocked ? analysis.blockReason : warningText,
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
 * Skip signal handler — updates existing 'observed' record if present
 */
function handleSkipSignal(signal) {
  const existingObserved = State.trades.find(t => t.id === signal.id && t.status === 'observed');
  if (existingObserved) {
    updateTrade(existingObserved.id, { status: 'skipped', notes: 'Manually skipped by user.' });
  } else {
    logTrade({ ...signal, status: 'skipped', result: null, exitPrice: null, pnlUSDT: 0, notes: 'Manually skipped by user.' });
  }
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

  // Liquidation guard: max leverage keeping liquidation ≥30% beyond SL
  const maxSafeLev = getMaxSafeLeverage(signal.entryPrice, signal.stopLoss);
  const submitBtn = form.querySelector('button[type="submit"]');

  // Clamp pre-selected leverage to safe limit
  if (parseInt(selectLev.value) > maxSafeLev) {
    const options = [...selectLev.options].map(o => parseInt(o.value));
    const safest = options.filter(v => v <= maxSafeLev);
    selectLev.value = safest.length ? Math.max(...safest) : options[0];
  }

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
    document.getElementById('modal-max-lev').innerText = `${maxSafeLev}x`;

    // Block confirm when selected leverage can liquidate before SL fires
    const unsafe = leverage > maxSafeLev;
    const warnEl = document.getElementById('modal-lev-warning');
    if (warnEl) {
      warnEl.innerHTML = unsafe
        ? `<div class="warning-banner"><i class="ti ti-alert-octagon"></i>
           <span>⛔ BLOCKED: ${leverage}x can liquidate this position before the stop loss triggers.
           Select ${maxSafeLev}x or lower.</span></div>`
        : '';
    }
    if (submitBtn) submitBtn.disabled = unsafe;
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
    if (finalLeverage > maxSafeLev) return; // hard block — liquidation before SL
    const notes = document.getElementById('modal-notes').value;

    const riskAmount = State.settings.accountSize * (State.settings.riskPercent / 100);
    const slDistance = Math.abs(signal.entryPrice - signal.stopLoss);
    const positionSize = riskAmount / slDistance;
    const margin = (positionSize * signal.entryPrice) / finalLeverage;

    const takenFields = {
      status: 'taken',
      leverage: finalLeverage,
      marginUsed: parseFloat(margin.toFixed(2)),
      positionSize: parseFloat(positionSize.toFixed(6)),
      result: null,
      exitPrice: null,
      pnlUSDT: null,
      takenAt: Date.now(),
      notes: notes
    };

    // Update existing 'observed' record if present; otherwise create new trade entry
    const existingObserved = State.trades.find(t => t.id === signal.id && t.status === 'observed');
    if (existingObserved) {
      updateTrade(existingObserved.id, takenFields);
    } else {
      logTrade({ ...signal, ...takenFields, signalTime: signal.signalTime || Date.now() });
    }
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
    if (submitBtn) submitBtn.disabled = false; // reset for next open
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

    // Helper: returns true if this alert type is on cooldown for this trade
    const onCooldown = (type) => {
      const key = `${trade.id}:${type}`;
      if (Date.now() - (State.alertCooldowns[key] || 0) < ALERT_COOLDOWN_MS) return true;
      State.alertCooldowns[key] = Date.now();
      return false;
    };

    // Stop Loss hit check
    if (isLong ? (price <= trade.stopLoss) : (price >= trade.stopLoss)) {
      if (!onCooldown('sl')) {
        triggerAlert(`⛔ STOP LOSS HIT for ${pair} ${trade.direction} at $${price.toLocaleString()}`, 'warning');
        playAlertSound();

        const pnl = parseFloat((isLong ? (trade.stopLoss - trade.entryPrice) : (trade.entryPrice - trade.stopLoss)) * (trade.positionSize || 0));
        sendTelegramSilent(
          `🛑 <b>STOP LOSS HIT — ${trade.pair} ${trade.direction}</b>\n` +
          `Exit at $${price.toFixed(2)}\n` +
          `Loss: -$${Math.abs(pnl).toFixed(2)} USDT\n` +
          `Reply <b>close</b> to mark trade closed.`
        );

        // Auto-exit trade in logs
        updateTrade(trade.id, {
          result: 'loss',
          exitPrice: trade.stopLoss,
          pnlUSDT: parseFloat((isLong ? (trade.stopLoss - trade.entryPrice) : (trade.entryPrice - trade.stopLoss)) * (trade.positionSize || 0)),
          notes: 'Auto-closed: Stop Loss hit.'
        });
        State.trades = loadTrades();
        checkDailyLossLimit();
      }
    }

    // TP1 hit
    if (isLong ? (price >= trade.tp1) : (price <= trade.tp1)) {
      if (!onCooldown('tp1')) {
        triggerAlert(`🎯 TP1 HIT for ${pair} ${trade.direction} at $${price.toLocaleString()}`, 'bullish');
        playAlertSound();
        sendTelegramSilent(
          `🎯 <b>TP1 HIT — ${trade.pair} ${trade.direction}</b>\n` +
          `Price reached $${price.toFixed(2)}\n` +
          `Action: Close 50% of position now.\n` +
          `Move Stop Loss to breakeven (entry price) ✅\n` +
          `Reply <b>close</b> to stop further alerts.`
        );
      }
    }

    // TP2 hit
    if (isLong ? (price >= trade.tp2) : (price <= trade.tp2)) {
      if (!onCooldown('tp2')) {
        triggerAlert(`🎯 TP2 HIT for ${pair} ${trade.direction} at $${price.toLocaleString()}`, 'bullish');
        sendTelegramSilent(
          `🎯 <b>TP2 HIT — ${trade.pair} ${trade.direction}</b>\n` +
          `Price reached $${price.toFixed(2)}\n` +
          `Action: Close remaining position or trail SL to TP1. 🏆\n` +
          `Reply <b>close</b> to stop further alerts.`
        );
      }
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
 * Poll Telegram for reply commands from user.
 * Supported replies (case-insensitive):
 *   Replied to NEW SIGNAL alert  → "taken"/"take"/"yes" | "skip"/"pass"/"no"
 *   Replied to TP/SL alert       → "close"/"sold"/"done"/"closed"
 * Runs every 60 seconds via setInterval.
 */
async function processTelegramReplies() {
  try {
    const updates = await fetchTelegramUpdates(State.lastTelegramUpdateId + 1);
    if (!updates.length) return;

    // Advance offset so next poll skips already-processed updates
    State.lastTelegramUpdateId = updates[updates.length - 1].update_id;

    for (const update of updates) {
      const msg = update.message;
      if (!msg || !msg.reply_to_message || !msg.text) continue;

      const replyText      = msg.text.trim().toLowerCase();
      const originalText   = msg.reply_to_message.text || '';

      // --- Extract pair + direction from original bot message ---
      // Matches "NEW SIGNAL — BTCUSDT SHORT" or "TP1 HIT — BTCUSDT SHORT" or "STOP LOSS HIT — BTCUSDT SHORT"
      const contextMatch = originalText.match(/(?:NEW SIGNAL|TP\d+ HIT|STOP LOSS HIT)[^\w]*([A-Z]+USDT)\s+(LONG|SHORT)/);
      if (!contextMatch) continue;

      const pair      = contextMatch[1];
      const direction = contextMatch[2];

      const isSignalAlert = /NEW SIGNAL/.test(originalText);
      const isTradeAlert  = /TP\d+ HIT|STOP LOSS HIT/.test(originalText);

      // --- "taken" / "take" / "yes" → mark observed signal as taken ---
      if (isSignalAlert && ['taken', 'take', 'yes'].includes(replyText)) {
        const observed = State.trades.find(t =>
          t.pair === pair && t.direction === direction &&
          t.status === 'observed' && !t.result
        );
        if (observed) {
          updateTrade(observed.id, {
            status: 'taken',
            takenAt: Date.now(),
            leverage: State.settings.defaultLeverage,
            notes: 'Marked taken via Telegram reply.'
          });
          State.trades = loadTrades();
          sendTelegramSilent(`✅ <b>Trade logged: ${pair} ${direction} TAKEN</b>\nView app to close when TP/SL hit.`);
          triggerAlert(`Telegram: ${pair} ${direction} marked TAKEN.`, 'info');
        }
      }

      // --- "skip" / "pass" / "no" → mark observed signal as skipped ---
      else if (isSignalAlert && ['skip', 'pass', 'no'].includes(replyText)) {
        const observed = State.trades.find(t =>
          t.pair === pair && t.direction === direction &&
          t.status === 'observed' && !t.result
        );
        if (observed) {
          updateTrade(observed.id, { status: 'skipped', notes: 'Skipped via Telegram reply.' });
          State.trades = loadTrades();
          sendTelegramSilent(`⏭ <b>${pair} ${direction}</b> marked as skipped.`);
        }
      }

      // --- "close" / "sold" / "done" / "closed" → close open taken trade ---
      else if (isTradeAlert && ['close', 'sold', 'done', 'closed'].includes(replyText)) {
        const openTrade = State.trades.find(t =>
          t.pair === pair && t.direction === direction &&
          t.status === 'taken' && !t.result
        );
        if (openTrade) {
          const exitPrice = State.tickerPrices[pair]?.price || openTrade.tp1;
          const isLong    = direction === 'LONG';
          const pnlUSDT   = parseFloat(
            ((isLong ? (exitPrice - openTrade.entryPrice) : (openTrade.entryPrice - exitPrice)) * (openTrade.positionSize || 0)).toFixed(2)
          );
          updateTrade(openTrade.id, {
            result: 'partial',
            exitPrice: parseFloat(exitPrice.toFixed(4)),
            pnlUSDT,
            notes: 'Closed via Telegram reply.'
          });
          State.trades = loadTrades();
          checkDailyLossLimit();
          sendTelegramSilent(
            `🔒 <b>Trade closed: ${pair} ${direction}</b>\n` +
            `Exit: $${Number(exitPrice).toFixed(2)}\n` +
            `PnL: ${pnlUSDT >= 0 ? '+' : ''}$${pnlUSDT.toFixed(2)} USDT`
          );
          triggerAlert(`Telegram: ${pair} ${direction} trade closed.`, 'info');
          // Clear TP/SL cooldowns so they don't interfere with future trades on this pair
          delete State.alertCooldowns[`${openTrade.id}:tp1`];
          delete State.alertCooldowns[`${openTrade.id}:tp2`];
          delete State.alertCooldowns[`${openTrade.id}:sl`];
        }
      }
    }
  } catch (e) {
    console.warn('processTelegramReplies error:', e.message);
  }
}

/**
 * Auto-Backtest: evaluate expired observed/taken signals against historical price data.
 * For each un-evaluated signal that has expired:
 *   1. Fetch 1H candles from signalTime → signalTime + 48H
 *   2. Walk candles checking if SL or TP1 was hit first
 *   3. Mark result + simulated PnL in trade log
 * Called by the "Auto-Backtest" button in the Backtest page.
 */
async function autoEvaluateExpiredSignals() {
  const statusEl = document.getElementById('backtest-status');

  // Find signals: expired (expiresAt in past) AND no result yet
  const toEvaluate = State.trades.filter(t =>
    (t.status === 'observed' || t.status === 'taken') &&
    t.result === null &&
    t.expiresAt != null &&
    t.expiresAt < Date.now()
  );

  if (toEvaluate.length === 0) {
    if (statusEl) statusEl.innerText = 'No expired signals to evaluate.';
    triggerAlert('Auto-Backtest: no expired signals found.', 'info');
    return;
  }

  let evaluated = 0;
  let errors = 0;

  for (let i = 0; i < toEvaluate.length; i++) {
    const trade = toEvaluate[i];
    if (statusEl) statusEl.innerText = `Evaluating ${i + 1} / ${toEvaluate.length}…`;

    try {
      // Fetch 1H candles in 48H window starting at signal time
      const startTime = trade.signalTime;
      const endTime   = Math.min(trade.signalTime + 48 * 3600000, Date.now() - 60000);
      const klines    = await fetchKlinesRange(trade.pair, '1h', startTime, endTime);

      const isLong   = trade.direction === 'LONG';
      let result     = null;
      let exitPrice  = null;

      // Walk candles chronologically — first hit wins
      for (const candle of klines) {
        const high = candle[2];
        const low  = candle[3];

        const slHit  = isLong ? low  <= trade.stopLoss : high >= trade.stopLoss;
        const tp1Hit = isLong ? high >= trade.tp1      : low  <= trade.tp1;

        if (slHit && tp1Hit) {
          // Both in same candle — assume SL hit first (conservative)
          result    = 'loss';
          exitPrice = trade.stopLoss;
          break;
        }
        if (tp1Hit) { result = 'win';  exitPrice = trade.tp1;      break; }
        if (slHit)  { result = 'loss'; exitPrice = trade.stopLoss; break; }
      }

      if (result) {
        // Simulated PnL using current risk settings
        const riskAmount   = (State.settings.accountSize || 1000) * ((State.settings.riskPercent || 1) / 100);
        const slDistance   = Math.abs(trade.entryPrice - trade.stopLoss);
        const positionSize = slDistance > 0 ? riskAmount / slDistance : 0;
        const rawPnl       = isLong
          ? (exitPrice - trade.entryPrice) * positionSize
          : (trade.entryPrice - exitPrice) * positionSize;

        updateTrade(trade.id, {
          result,
          exitPrice:       parseFloat(exitPrice.toFixed(4)),
          pnlUSDT:         parseFloat(rawPnl.toFixed(2)),
          positionSize:    parseFloat(positionSize.toFixed(6)),
          backtestEvaluated: true,
          notes: `Auto-backtested: ${result.toUpperCase()} — TP1/SL scan on 1H candles`
        });
        evaluated++;
      }
    } catch (e) {
      console.warn(`Backtest eval failed for ${trade.pair}:`, e.message);
      errors++;
    }
  }

  State.trades = loadTrades();
  if (statusEl) statusEl.innerText = `Done: ${evaluated} evaluated${errors ? `, ${errors} failed` : ''}.`;
  triggerAlert(`Auto-Backtest complete: ${evaluated} of ${toEvaluate.length} signals evaluated.`, 'info');
  renderBacktestStats(State.trades);
}

/**
 * Market Scanner — render a grid of all pairs with current signal status.
 * Uses cached allAnalysis where available; fetches fresh for uncached pairs.
 */
async function renderMarketScanner() {
  const container = document.getElementById('signals-feed-list');
  if (!container) return;

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;padding:40px 0;color:var(--text-muted);">
      <div class="spinner" style="width:24px;height:24px;border-width:3px;"></div>
      Scanning ${State.settings.pairs.length} pairs...
    </div>`;

  const scanResults = [];
  for (const pair of State.settings.pairs) {
    try {
      let analysis = State.allAnalysis[pair];
      if (!analysis) analysis = await runAnalysisForPair(pair);
      if (analysis) scanResults.push({ pair, analysis });
    } catch (e) {
      console.warn(`Scanner: ${pair} failed:`, e.message);
    }
  }

  if (scanResults.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">No analysis available. Check network connection.</div>';
    return;
  }

  const cardsHTML = scanResults.map(({ pair, analysis }) => {
    const ticker = State.tickerPrices[pair];
    const price = ticker?.price || analysis.currPrice;
    const changePct = ticker?.changePct ?? 0;
    const changeClass = changePct >= 0 ? 'success-text' : 'danger-text';

    const sig = analysis.signal;
    let signalHTML = '<span class="badge badge-grey" style="font-size:0.7rem;">No Signal</span>';
    if (sig) {
      const badgeClass = sig.direction === 'LONG' ? 'badge-green' : 'badge-red';
      signalHTML = `
        <span class="badge ${badgeClass}" style="font-size:0.7rem;">${sig.direction}</span>
        <span class="conf-score">${sig.confidence}%</span>
      `;
    }

    const modeBadgeClass = analysis.marketMode === 'TRENDING' ? 'badge-blue' : (analysis.marketMode === 'RANGING' ? 'badge-yellow' : 'badge-grey');
    const trendArrow = analysis.dailyDirection === 'LONG' ? '↑' : (analysis.dailyDirection === 'SHORT' ? '↓' : '~');
    const rsi4h = Math.round(analysis.indicatorValues?.rsi4h ?? 0);
    const weeklyIcon = analysis.weeklyTrend === 'BULL' ? '🟢W' : (analysis.weeklyTrend === 'BEAR' ? '🔴W' : '⬜W');

    return `
      <div class="scanner-card" data-pair="${pair}">
        <div class="scanner-card-header">
          <strong>${pair.replace('USDT', '/USDT')}</strong>
          <span class="${changeClass}" style="font-size:0.8rem;">${changePct >= 0 ? '+' : ''}${Number(changePct).toFixed(2)}%</span>
        </div>
        <div class="scanner-price">$${Number(price).toLocaleString()}</div>
        <div class="scanner-signal">${signalHTML}</div>
        <div class="scanner-meta">
          <span class="badge ${modeBadgeClass}" style="font-size:0.65rem;">${analysis.marketMode}</span>
          <span class="scanner-indicators">RSI ${rsi4h} · ${trendArrow} Daily · ${weeklyIcon}</span>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `<div class="scanner-grid">${cardsHTML}</div>`;

  // Click card → switch to that pair on dashboard
  container.querySelectorAll('.scanner-card').forEach(card => {
    card.addEventListener('click', () => {
      handlePairSelect(card.dataset.pair);
      navigateTo('dashboard');
    });
  });
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
        document.body.classList.remove('sidebar-open');
      });
    });

    // Mobile Drawer navigation toggle and backdrop click
    const menuToggleBtn = document.getElementById('menu-toggle-btn');
    if (menuToggleBtn) {
      menuToggleBtn.addEventListener('click', () => {
        document.body.classList.toggle('sidebar-open');
      });
    }

    const sidebarBackdrop = document.getElementById('sidebar-backdrop');
    if (sidebarBackdrop) {
      sidebarBackdrop.addEventListener('click', () => {
        document.body.classList.remove('sidebar-open');
      });
    }

    // Topbar Settings shortcut
    settingsBtn.addEventListener('click', () => {
      navigateTo('settings');
      document.body.classList.remove('sidebar-open');
    });
    
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

    // Telegram test button
    document.getElementById('test-telegram-btn').addEventListener('click', async () => {
      const statusEl = document.getElementById('telegram-test-status');
      const btn = document.getElementById('test-telegram-btn');
      btn.disabled = true;
      statusEl.style.color = '';
      statusEl.textContent = 'Sending…';
      try {
        await sendTelegram(
          `✅ <b>Telegram Test — CryptoSignal</b>\n` +
          `Connection confirmed.\n` +
          `Time: ${new Date().toUTCString()}`
        );
        statusEl.style.color = 'var(--color-bullish)';
        statusEl.textContent = '✓ Sent! Check your Telegram.';
      } catch (e) {
        statusEl.style.color = 'var(--color-bearish)';
        statusEl.textContent = '✗ Failed: ' + e.message;
      } finally {
        btn.disabled = false;
      }
    });
    
    // Market Scanner refresh button
    const scannerRefreshBtn = document.getElementById('scanner-refresh-btn');
    if (scannerRefreshBtn) {
      scannerRefreshBtn.addEventListener('click', renderMarketScanner);
    }

    // Engine historical simulation (bar-by-bar backtest with report)
    initEngineBacktest(() => State.settings.pairs);

    // Auto-Backtest button — evaluates expired signals against historical kline data
    const runBacktestBtn = document.getElementById('run-backtest-btn');
    if (runBacktestBtn) {
      runBacktestBtn.addEventListener('click', async () => {
        runBacktestBtn.disabled = true;
        runBacktestBtn.innerHTML = '<i class="ti ti-loader"></i> Running…';
        await autoEvaluateExpiredSignals();
        runBacktestBtn.disabled = false;
        runBacktestBtn.innerHTML = '<i class="ti ti-player-play"></i> Auto-Backtest';
      });
    }

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

    // 10-minute background all-pairs signal scan
    // Ensures non-active pairs (ETH, SOL, BNB, XRP) are analysed and their signals auto-logged
    setInterval(async () => {
      for (const pair of State.settings.pairs) {
        if (pair === State.activePair) continue; // dashboard already handles active pair
        try {
          await runAnalysisForPair(pair);
        } catch (e) {
          console.warn(`Background scan: ${pair} failed:`, e.message);
        }
      }
    }, 10 * 60 * 1000);

    // Telegram reply polling — every 60 seconds, process user replies to bot alerts
    setInterval(processTelegramReplies, 60 * 1000);
    processTelegramReplies(); // initial pass on startup (pick up any replies sent while app was offline)

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
