# AntiGravity — V3 Instructions
## Crypto Futures Signal Tracker — Telegram Alerts + Security Hardening

---

## Overview

Two features to add to the existing static app. No backend, no database, no Supabase.
The app remains a pure static site served by nginx on Railway.

1. **Telegram Notifications** — call Telegram Bot API directly from browser JS when signals fire
2. **HTTP Basic Auth + Security Headers** — lock the app behind a username/password at the nginx level

Signal engine (`engine/` folder) must NOT be touched.

---

## Files to Create or Modify

```
crypto tracker/
├── Dockerfile              ← REPLACE entirely
├── nginx.conf              ← CREATE new
├── entrypoint.sh           ← CREATE new
├── config.example.js       ← MODIFY: add 2 new lines
├── config.js               ← MODIFY: add 2 new values (real credentials)
├── api/
│   └── telegram.js         ← CREATE new
├── app.js                  ← MODIFY: import sendTelegram, add 4 call sites
├── .gitignore              ← MODIFY: add .htpasswd
└── CHANGE.md               ← UPDATE as always
```

---

## Part 1 — Telegram Notifications

### Create `api/telegram.js`

```javascript
/**
 * Telegram Bot API — called directly from browser
 * Credentials loaded from config.js (gitignored)
 */
import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from '../config.js';

export async function sendTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'your-bot-token-here') return;
  if (!TELEGRAM_CHAT_ID || TELEGRAM_CHAT_ID === 'your-chat-id-here') return;

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML'
      })
    });
  } catch (e) {
    console.warn('Telegram notification failed:', e);
  }
}
```

---

### Modify `config.example.js`

Add these two lines (alongside existing Supabase placeholder lines if present, or as the full file):

```javascript
// Copy this file to config.js and fill in your real values
// config.js is gitignored — never commit it

export const SUPABASE_URL = 'https://placeholder.supabase.co';
export const SUPABASE_ANON_KEY = 'placeholder-anon-key';
export const TELEGRAM_BOT_TOKEN = 'your-bot-token-here';
export const TELEGRAM_CHAT_ID = 'your-chat-id-here';
```

---

### Modify `config.js`

Add the two Telegram lines with real values:

```javascript
export const SUPABASE_URL = 'https://placeholder.supabase.co';
export const SUPABASE_ANON_KEY = 'placeholder-anon-key';
export const TELEGRAM_BOT_TOKEN = '8971078232:AAHpqCPoCJtPjigrAYRPJgQS40-7GFsFx6E';
export const TELEGRAM_CHAT_ID = '8659280980';
```

> `config.js` is already in `.gitignore` — confirm it stays there.

---

### Modify `app.js` — 4 call sites

Import at the top of `app.js`:
```javascript
import { sendTelegram } from './api/telegram.js';
```

Then add `sendTelegram(...)` calls at these exact 4 points:

**1. When a new signal fires (confidence ≥ 70%)**

Find where a new signal is stored/displayed and add:
```javascript
sendTelegram(
  `📡 <b>NEW SIGNAL — ${signal.pair} ${signal.direction}</b>\n` +
  `Confidence: ${signal.confidence}%\n` +
  `Entry: $${signal.entryPrice.toFixed(2)}\n` +
  `SL: $${signal.stopLoss.toFixed(2)} (-${signal.slDistancePct.toFixed(1)}%)\n` +
  `TP1: $${signal.tp1.toFixed(2)} (+${signal.tp1Pct.toFixed(1)}%)\n` +
  `TP2: $${signal.tp2.toFixed(2)} (+${signal.tp2Pct.toFixed(1)}%)\n` +
  `TP3: $${signal.tp3.toFixed(2)} (+${signal.tp3Pct.toFixed(1)}%)\n` +
  `R:R 1:3.0 | Expires in 3H`
);
```

**2. When TP1 is hit** (in the price monitoring loop where TP1 is detected):
```javascript
sendTelegram(
  `🎯 <b>TP1 HIT — ${trade.pair} ${trade.direction}</b>\n` +
  `Price reached $${currentPrice.toFixed(2)}\n` +
  `Action: Close 50% of position now.\n` +
  `Move Stop Loss to breakeven (entry price) ✅`
);
```

**3. When Stop Loss is hit** (in the price monitoring loop where SL is detected):
```javascript
sendTelegram(
  `🛑 <b>STOP LOSS HIT — ${trade.pair} ${trade.direction}</b>\n` +
  `Exit at $${currentPrice.toFixed(2)}\n` +
  `Loss: -$${Math.abs(pnl).toFixed(2)} USDT`
);
```

**4. When daily loss limit is reached** (where `isDailyLossLimitReached` returns true):
```javascript
sendTelegram(
  `⛔ <b>DAILY LOSS LIMIT REACHED</b>\n` +
  `2 consecutive losses today.\n` +
  `No new signals until 00:00 UTC.\n` +
  `Protect your capital. Step away and review.`
);
```

---

## Part 2 — Security Hardening

### Create `nginx.conf` in project root

```nginx
events {}

http {
  include       /etc/nginx/mime.types;
  default_type  application/octet-stream;
  server_tokens off;

  server {
    listen 80;
    root  /usr/share/nginx/html;
    index index.html;

    # HTTP Basic Auth — prompts for username/password before serving anything
    auth_basic           "CryptoSignal — Restricted Access";
    auth_basic_user_file /etc/nginx/.htpasswd;

    # Security headers
    add_header X-Frame-Options        "DENY"        always;
    add_header X-Content-Type-Options "nosniff"     always;
    add_header X-XSS-Protection       "1; mode=block" always;
    add_header Referrer-Policy        "no-referrer" always;
    add_header Permissions-Policy     "geolocation=(), camera=(), microphone=()" always;
    add_header Content-Security-Policy
      "default-src 'self' https://cdn.jsdelivr.net https://unpkg.com https://fonts.googleapis.com https://fonts.gstatic.com https://stream.binance.com wss://stream.binance.com https://api.binance.com https://fapi.binance.com https://api.alternative.me https://api.coingecko.com https://api.telegram.org;
       script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com;
       style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com;
       font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com;" always;

    location / {
      try_files $uri $uri/ /index.html;
    }
  }
}
```

---

### Create `entrypoint.sh` in project root

```bash
#!/bin/sh
# Generates .htpasswd from Railway environment variables at container startup.
# Set BASIC_AUTH_USER and BASIC_AUTH_PASSWORD in Railway → Variables.

if [ -z "$BASIC_AUTH_USER" ] || [ -z "$BASIC_AUTH_PASSWORD" ]; then
  echo "WARNING: BASIC_AUTH_USER or BASIC_AUTH_PASSWORD not set. Disabling auth."
  sed -i '/auth_basic/d' /etc/nginx/nginx.conf
else
  echo "Basic Auth enabled for user: $BASIC_AUTH_USER"
  htpasswd -bc /etc/nginx/.htpasswd "$BASIC_AUTH_USER" "$BASIC_AUTH_PASSWORD"
fi

exec nginx -g "daemon off;"
```

---

### Replace `Dockerfile` entirely

```dockerfile
FROM nginx:alpine

# Install apache2-utils for the htpasswd command
RUN apk add --no-cache apache2-utils

# Copy all app files into nginx web root
COPY . /usr/share/nginx/html

# Use custom nginx config
COPY nginx.conf /etc/nginx/nginx.conf

# Copy startup script and make it executable
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/entrypoint.sh"]
```

---

### Modify `.gitignore` — add one line

```
.htpasswd
```

---

## After Pushing — Set Railway Environment Variables

Once `git push` is done and Railway redeploys, go to Railway → your project → **Variables** tab and add:

| Variable | Value |
|---|---|
| `BASIC_AUTH_USER` | Choose a username (e.g. `pichan`) |
| `BASIC_AUTH_PASSWORD` | Choose a strong password (min 12 chars, mix letters/numbers) |

Railway will redeploy automatically after saving. The app URL will then show a browser login prompt before anything loads.

---

## What This Protects Against

| Threat | Status |
|---|---|
| Random person finds Railway URL | ✅ Blocked — 401 before any content loads |
| Bots and scanners | ✅ Never see the app |
| Clickjacking (app embedded in iframe) | ✅ Blocked by X-Frame-Options: DENY |
| XSS script injection | ✅ CSP header restricts script sources to known CDNs only |
| MIME type sniffing | ✅ X-Content-Type-Options: nosniff |
| nginx version fingerprinting | ✅ server_tokens off |

> Note: Bot token and Chat ID in `config.js` are visible to anyone who successfully logs in and views source. Keep your `BASIC_AUTH_PASSWORD` strong and do not share the app URL publicly.

---

## Summary Checklist for AntiGravity

- [ ] Create `api/telegram.js`
- [ ] Update `config.example.js` with Telegram placeholder lines
- [ ] Update `config.js` with real Telegram credentials
- [ ] Import `sendTelegram` in `app.js` and add 4 call sites
- [ ] Create `nginx.conf`
- [ ] Create `entrypoint.sh`
- [ ] Replace `Dockerfile`
- [ ] Add `.htpasswd` to `.gitignore`
- [ ] Update `CHANGE.md`
- [ ] `git push` → Railway auto-redeploys
- [ ] Set `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` in Railway Variables
