/**
 * Storage Engine
 * Handles saving and loading settings, trade logs, and price alerts from localStorage.
 */

const SETTINGS_KEY = 'crypto_signal_tracker_settings';
const TRADE_LOG_KEY = 'crypto_signal_tracker_trades';
const ALERTS_KEY = 'crypto_signal_tracker_alerts';

const DEFAULT_SETTINGS = {
  accountSize: 600,       // USDT
  riskPercent: 10,        // % per trade
  defaultLeverage: 7,     // x
  activePair: 'BTCUSDT',
  pairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'],
  dailyLossLimit: 2,
  paperMode: true         // default global setting
};

/**
 * Load settings from localStorage or initialize default settings
 */
export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      saveSettings(DEFAULT_SETTINGS);
      return DEFAULT_SETTINGS;
    }
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (error) {
    console.error('Error loading settings from storage:', error);
    return DEFAULT_SETTINGS;
  }
}

/**
 * Save settings to localStorage
 * @param {Object} settings 
 */
export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch (error) {
    console.error('Error saving settings to storage:', error);
    return false;
  }
}

/**
 * Load trade log list from localStorage
 * @returns {Array<Object>}
 */
export function loadTrades() {
  try {
    const raw = localStorage.getItem(TRADE_LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error('Error loading trade log from storage:', error);
    return [];
  }
}

/**
 * Save trade log list to localStorage
 * @param {Array<Object>} trades 
 */
export function saveTrades(trades) {
  try {
    localStorage.setItem(TRADE_LOG_KEY, JSON.stringify(trades));
    return true;
  } catch (error) {
    console.error('Error saving trade log to storage:', error);
    return false;
  }
}

/**
 * Add a single trade entry to log
 * @param {Object} trade 
 */
export function logTrade(trade) {
  const trades = loadTrades();
  trades.push(trade);
  saveTrades(trades);
  return trades;
}

/**
 * Update an existing trade entry
 * @param {string} id 
 * @param {Object} updates 
 */
export function updateTrade(id, updates) {
  const trades = loadTrades();
  const index = trades.findIndex(t => t.id === id);
  if (index !== -1) {
    trades[index] = { ...trades[index], ...updates };
    saveTrades(trades);
    return trades[index];
  }
  return null;
}

/**
 * Clear trade log
 */
export function clearTradeLog() {
  try {
    localStorage.removeItem(TRADE_LOG_KEY);
    return true;
  } catch (error) {
    console.error('Error clearing trade log:', error);
    return false;
  }
}

/**
 * Load alerts from localStorage
 * @returns {Array<Object>}
 */
export function loadAlerts() {
  try {
    const raw = localStorage.getItem(ALERTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error('Error loading alerts from storage:', error);
    return [];
  }
}

/**
 * Save alerts to localStorage
 * @param {Array<Object>} alerts 
 */
export function saveAlerts(alerts) {
  try {
    localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
    return true;
  } catch (error) {
    console.error('Error saving alerts to storage:', error);
    return false;
  }
}

/**
 * Add alert to storage
 * @param {Object} alert 
 */
export function addAlert(alert) {
  const alerts = loadAlerts();
  alerts.unshift(alert); // newest first
  // Cap at last 50 alerts to prevent excessive storage size
  if (alerts.length > 50) {
    alerts.pop();
  }
  saveAlerts(alerts);
  return alerts;
}
