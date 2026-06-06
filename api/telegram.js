/**
 * Telegram Bot API — called directly from browser
 * Credentials loaded from config.js (gitignored)
 */
import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from '../config.js';

/**
 * Send a Telegram message.
 * Returns { ok: true } on success.
 * Throws an Error with a descriptive message on failure so callers can show feedback.
 * Silent (no throw) when credentials are not configured — alerts are optional.
 */
export async function sendTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'your-bot-token-here') return;
  if (!TELEGRAM_CHAT_ID || TELEGRAM_CHAT_ID === 'your-chat-id-here') return;

  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    })
  });

  const json = await res.json();
  if (!json.ok) {
    throw new Error(`Telegram API error: ${json.description || json.error_code}`);
  }
  return { ok: true };
}

/**
 * Same as sendTelegram but swallows errors — used for fire-and-forget alerts
 * so a Telegram failure never crashes the signal engine.
 */
export async function sendTelegramSilent(message) {
  try {
    await sendTelegram(message);
  } catch (e) {
    console.warn('Telegram notification failed:', e.message);
  }
}

/**
 * Poll Telegram for incoming updates (user replies to bot messages).
 * Uses getUpdates with offset so only unseen messages are returned.
 * Returns array of Telegram update objects, or [] on failure / unconfigured.
 * @param {number} offset - Fetch updates with update_id >= offset
 */
export async function fetchTelegramUpdates(offset = 0) {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'your-bot-token-here') return [];
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${offset}&limit=20&timeout=0`
    );
    const json = await res.json();
    return json.ok ? json.result : [];
  } catch (e) {
    console.warn('Telegram getUpdates failed:', e.message);
    return [];
  }
}
