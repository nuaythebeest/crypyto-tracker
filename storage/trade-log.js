/**
 * Storage Engine — Supabase Backend
 * Replaces localStorage with Supabase PostgreSQL queries.
 * All functions are async and return data from the database.
 */

import { supabase } from '../api/supabase-client.js';

// Default settings used when profile data is unavailable
const DEFAULT_SETTINGS = {
  accountSize: 600,
  riskPercent: 10,
  defaultLeverage: 7,
  pairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'],
  dailyLossLimit: 2,
  paperMode: true
};

// ── TRADES ──────────────────────────────────────────────────

/**
 * Load all trades for the authenticated user, newest first
 * @returns {Promise<Array<Object>>}
 */
export async function loadTrades() {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .order('signal_time', { ascending: false });
  if (error) { console.error('loadTrades error:', error); return []; }
  // Map snake_case DB columns to camelCase used in app
  return (data || []).map(mapTradeFromDB);
}

/**
 * Log a new trade (insert)
 * @param {Object} tradeObj - trade data in app camelCase format
 * @returns {Promise<Object>} inserted trade
 */
export async function logTrade(tradeObj) {
  const { data: { user } } = await supabase.auth.getUser();
  const dbTrade = mapTradeToDB(tradeObj);
  const { data, error } = await supabase
    .from('trades')
    .insert({ ...dbTrade, user_id: user.id })
    .select()
    .single();
  if (error) throw error;
  return mapTradeFromDB(data);
}

/**
 * Update an existing trade
 * @param {string} id - trade UUID
 * @param {Object} updates - partial trade data in app camelCase format
 */
export async function updateTrade(id, updates) {
  const dbUpdates = mapTradeToDB(updates);
  const { error } = await supabase
    .from('trades')
    .update(dbUpdates)
    .eq('id', id);
  if (error) throw error;
}

/**
 * Delete all trades for the authenticated user
 */
export async function clearTradeLog() {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('trades')
    .delete()
    .eq('user_id', user.id);
  if (error) throw error;
}

// ── ALERTS ──────────────────────────────────────────────────

/**
 * Load alerts for the authenticated user (last 50)
 * @returns {Promise<Array<Object>>}
 */
export async function loadAlerts() {
  const { data, error } = await supabase
    .from('alerts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) { console.error('loadAlerts error:', error); return []; }
  // Map to app format
  return (data || []).map(row => ({
    id: row.id,
    text: row.message,
    type: row.alert_type,
    pair: row.pair,
    price: row.price ? parseFloat(row.price) : null,
    isRead: row.is_read,
    createdAt: new Date(row.created_at).getTime()
  }));
}

/**
 * Add a new alert (insert into Supabase, which triggers Telegram webhook)
 * @param {Object} alertObj - { pair, alert_type, message, price? } OR legacy { text, type }
 */
export async function addAlert(alertObj) {
  const { data: { user } } = await supabase.auth.getUser();

  // Support both V2 format { pair, alert_type, message } and legacy { text, type }
  const row = {
    user_id: user.id,
    pair: alertObj.pair || 'SYSTEM',
    alert_type: alertObj.alert_type || alertObj.type || 'info',
    message: alertObj.message || alertObj.text || '',
    price: alertObj.price || null
  };

  const { error } = await supabase
    .from('alerts')
    .insert(row);
  if (error) console.error('addAlert error:', error);
}

/**
 * Mark all unread alerts as read for the authenticated user
 */
export async function markAlertsRead() {
  const { data: { user } } = await supabase.auth.getUser();
  await supabase
    .from('alerts')
    .update({ is_read: true })
    .eq('user_id', user.id)
    .eq('is_read', false);
}

/**
 * Clear all alerts for the authenticated user
 */
export async function clearAlerts() {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('alerts')
    .delete()
    .eq('user_id', user.id);
  if (error) console.error('clearAlerts error:', error);
}

// ── SETTINGS (user_profiles) ─────────────────────────────────

/**
 * Load settings from user profile
 * @returns {Promise<Object>} settings object in app format
 */
export async function loadSettings() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return DEFAULT_SETTINGS;

  const { data } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (!data) return DEFAULT_SETTINGS;

  return {
    accountSize: parseFloat(data.account_size),
    riskPercent: parseFloat(data.risk_percent),
    defaultLeverage: data.default_leverage,
    telegramChatId: data.telegram_chat_id,
    displayName: data.display_name,
    // These are client-side only settings, kept as defaults
    pairs: DEFAULT_SETTINGS.pairs,
    dailyLossLimit: DEFAULT_SETTINGS.dailyLossLimit,
    paperMode: DEFAULT_SETTINGS.paperMode
  };
}

/**
 * Save settings to user profile
 * @param {Object} settings - app settings object (partial OK)
 */
export async function saveSettings(settings) {
  const { data: { user } } = await supabase.auth.getUser();
  // Map only the fields that exist in the DB
  const dbUpdates = {};
  if (settings.accountSize !== undefined) dbUpdates.account_size = settings.accountSize;
  if (settings.riskPercent !== undefined) dbUpdates.risk_percent = settings.riskPercent;
  if (settings.defaultLeverage !== undefined) dbUpdates.default_leverage = settings.defaultLeverage;
  if (settings.telegramChatId !== undefined) dbUpdates.telegram_chat_id = settings.telegramChatId;
  if (settings.displayName !== undefined) dbUpdates.display_name = settings.displayName;

  if (Object.keys(dbUpdates).length === 0) return;

  const { error } = await supabase
    .from('user_profiles')
    .update(dbUpdates)
    .eq('id', user.id);
  if (error) throw error;
}

// ── FIELD MAPPING HELPERS ────────────────────────────────────
// The app uses camelCase, the DB uses snake_case

function mapTradeFromDB(row) {
  return {
    id: row.id,
    pair: row.pair,
    direction: row.direction,
    entryPrice: parseFloat(row.entry_price),
    stopLoss: parseFloat(row.stop_loss),
    tp1: parseFloat(row.tp1),
    tp2: parseFloat(row.tp2),
    tp3: parseFloat(row.tp3),
    slDistancePct: row.sl_distance_pct ? parseFloat(row.sl_distance_pct) : null,
    leverage: row.leverage,
    confidence: row.confidence,
    marginUsed: row.margin_used ? parseFloat(row.margin_used) : null,
    signalTime: new Date(row.signal_time).getTime(),
    expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
    status: row.status,
    result: row.result,
    exitPrice: row.exit_price ? parseFloat(row.exit_price) : null,
    pnlUSDT: row.pnl_usdt ? parseFloat(row.pnl_usdt) : null,
    notes: row.notes || '',
    positionSize: row.position_size ? parseFloat(row.position_size) : null,
    createdAt: new Date(row.created_at).getTime()
  };
}

function mapTradeToDB(trade) {
  const row = {};
  if (trade.pair !== undefined) row.pair = trade.pair;
  if (trade.direction !== undefined) row.direction = trade.direction;
  if (trade.entryPrice !== undefined) row.entry_price = trade.entryPrice;
  if (trade.stopLoss !== undefined) row.stop_loss = trade.stopLoss;
  if (trade.tp1 !== undefined) row.tp1 = trade.tp1;
  if (trade.tp2 !== undefined) row.tp2 = trade.tp2;
  if (trade.tp3 !== undefined) row.tp3 = trade.tp3;
  if (trade.slDistancePct !== undefined) row.sl_distance_pct = trade.slDistancePct;
  if (trade.leverage !== undefined) row.leverage = trade.leverage;
  if (trade.confidence !== undefined) row.confidence = trade.confidence;
  if (trade.marginUsed !== undefined) row.margin_used = trade.marginUsed;
  if (trade.signalTime !== undefined) row.signal_time = new Date(trade.signalTime).toISOString();
  if (trade.expiresAt !== undefined) row.expires_at = trade.expiresAt ? new Date(trade.expiresAt).toISOString() : null;
  if (trade.status !== undefined) row.status = trade.status;
  if (trade.result !== undefined) row.result = trade.result;
  if (trade.exitPrice !== undefined) row.exit_price = trade.exitPrice;
  if (trade.pnlUSDT !== undefined) row.pnl_usdt = trade.pnlUSDT;
  if (trade.notes !== undefined) row.notes = trade.notes;
  return row;
}
