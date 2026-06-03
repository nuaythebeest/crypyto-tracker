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
