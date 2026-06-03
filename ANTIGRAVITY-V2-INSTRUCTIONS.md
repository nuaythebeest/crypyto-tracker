# AntiGravity — V2 Upgrade Instructions
## Crypto Futures Signal Tracker — Supabase Sync + Telegram + Multi-User

---

## Overview of What You Are Building

You are upgrading an existing static web app (HTML + CSS + Vanilla JS) that is already deployed on Railway via Docker/nginx.

The app currently:
- Tracks crypto futures signals (BTC, ETH, SOL, BNB, XRP vs USDT) using a rule-based signal engine
- Stores trade log and alerts in browser `localStorage` only
- Has no backend, no database, no authentication

You are adding:
1. **Supabase** — hosted PostgreSQL database + real-time sync + authentication
2. **Multi-user support** — each user has isolated trade data, personal settings, own Telegram
3. **Login screen** — Supabase Auth (email + password), invite-only (no open signup)
4. **Cross-device sync** — trade log and alerts sync in real-time across all devices
5. **Telegram notifications** — via Supabase Edge Function, per-user chat IDs

The signal engine (`engine/` folder) must NOT be modified. It is pure JS math and stays untouched.

---

## Secrets / Environment Variables

These 4 variables must be set in Railway → Variables tab (never hardcode in source):

| Variable | Where to get it |
|---|---|
| `SUPABASE_URL` | Supabase project → Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase project → Settings → API → anon/public key |
| `TELEGRAM_BOT_TOKEN` | From @BotFather on Telegram |
| `TELEGRAM_CHAT_ID` | Not used globally — stored per user in database (see below) |

In the frontend JS, read them as:
```javascript
const SUPABASE_URL = '__SUPABASE_URL__';
const SUPABASE_ANON_KEY = '__SUPABASE_ANON_KEY__';
```
Use Railway's variable injection OR embed them at build time. Since this is a static app with no build step, the cleanest approach is to create a `config.js` file that exports these, and instruct the user to fill in their values after deployment. Add `config.js` to `.gitignore`.

`config.js` template (committed as `config.example.js`, user copies and fills in):
```javascript
// Copy this file to config.js and fill in your values
export const SUPABASE_URL = 'https://your-project.supabase.co';
export const SUPABASE_ANON_KEY = 'your-anon-key-here';
```

---

## New File Structure

Add/modify these files. Everything else stays the same.

```
crypto tracker/
├── config.example.js               ← NEW: template for secrets (committed)
├── config.js                       ← NEW: actual secrets (gitignored)
│
├── api/
│   └── supabase-client.js          ← NEW: Supabase JS client init
│
├── supabase/
│   ├── schema.sql                  ← NEW: full database schema to run in Supabase SQL editor
│   └── functions/
│       └── telegram-notify/
│           └── index.ts            ← NEW: Edge Function for Telegram
│
├── ui/
│   ├── auth.js                     ← NEW: login screen + first-time profile setup
│   └── (all existing ui/*.js files modified to use Supabase)
│
├── storage/
│   └── trade-log.js                ← MODIFIED: replace localStorage with Supabase queries
│
├── app.js                          ← MODIFIED: add auth check on startup, init Supabase
├── index.html                      ← MODIFIED: add login screen HTML section
├── .gitignore                      ← MODIFIED: add config.js
└── CHANGE.md                       ← UPDATED as always
```

---

## Step 1 — Supabase Database Schema

Create the file `supabase/schema.sql`. This is run once in the Supabase SQL editor to set up the database.

```sql
-- ============================================================
-- USER PROFILES
-- ============================================================
create table public.user_profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  display_name text not null default 'Trader',
  telegram_chat_id text default null,
  account_size numeric(12,2) not null default 600.00,
  risk_percent numeric(5,2) not null default 10.00,
  default_leverage int not null default 7,
  created_at timestamptz not null default now()
);

-- RLS: users can only read/write their own profile
alter table public.user_profiles enable row level security;

create policy "Users can view own profile"
  on public.user_profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.user_profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.user_profiles for insert
  with check (auth.uid() = id);


-- ============================================================
-- TRADES
-- ============================================================
create table public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  pair text not null,
  direction text not null check (direction in ('LONG', 'SHORT')),
  entry_price numeric(18,6) not null,
  stop_loss numeric(18,6) not null,
  tp1 numeric(18,6) not null,
  tp2 numeric(18,6) not null,
  tp3 numeric(18,6) not null,
  sl_distance_pct numeric(8,4),
  leverage int not null default 7,
  confidence int not null default 70,
  margin_used numeric(12,2),
  signal_time timestamptz not null default now(),
  expires_at timestamptz,
  status text not null default 'paper' check (status in ('paper', 'taken', 'skipped', 'expired')),
  result text default null check (result in ('win', 'loss', 'partial', null)),
  exit_price numeric(18,6) default null,
  pnl_usdt numeric(12,2) default null,
  notes text default '',
  created_at timestamptz not null default now()
);

-- RLS: users can only access their own trades
alter table public.trades enable row level security;

create policy "Users can view own trades"
  on public.trades for select
  using (auth.uid() = user_id);

create policy "Users can insert own trades"
  on public.trades for insert
  with check (auth.uid() = user_id);

create policy "Users can update own trades"
  on public.trades for update
  using (auth.uid() = user_id);

create policy "Users can delete own trades"
  on public.trades for delete
  using (auth.uid() = user_id);


-- ============================================================
-- ALERTS
-- ============================================================
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  pair text not null,
  alert_type text not null,  -- 'new_signal' | 'tp1' | 'tp2' | 'tp3' | 'stop_loss' | 'loss_limit' | 'signal_expired'
  message text not null,
  price numeric(18,6) default null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- RLS: users can only access their own alerts
alter table public.alerts enable row level security;

create policy "Users can view own alerts"
  on public.alerts for select
  using (auth.uid() = user_id);

create policy "Users can insert own alerts"
  on public.alerts for insert
  with check (auth.uid() = user_id);

create policy "Users can update own alerts"
  on public.alerts for update
  using (auth.uid() = user_id);

-- Enable real-time on these tables
alter publication supabase_realtime add table public.trades;
alter publication supabase_realtime add table public.alerts;
```

---

## Step 2 — Supabase Client

Create `api/supabase-client.js`:

```javascript
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

---

## Step 3 — Authentication (Login Screen)

### index.html changes

Add a login screen section before the main `#app-container`. The app container starts hidden:

```html
<!-- Login Screen -->
<div id="login-screen" class="auth-screen">
  <div class="auth-card">
    <div class="auth-logo">
      <i class="ti ti-chart-candle"></i>
      <span>CryptoSignal</span>
    </div>
    <h2>Sign in</h2>
    <div id="auth-error" class="auth-error hidden"></div>
    <form id="login-form">
      <div class="form-group">
        <label for="login-email">Email</label>
        <input type="email" id="login-email" required autocomplete="email" />
      </div>
      <div class="form-group">
        <label for="login-password">Password</label>
        <input type="password" id="login-password" required autocomplete="current-password" />
      </div>
      <button type="submit" class="primary-btn" id="login-submit-btn">Sign in</button>
    </form>
  </div>
</div>

<!-- First-time Profile Setup Screen -->
<div id="profile-setup-screen" class="auth-screen hidden">
  <div class="auth-card">
    <h2>Complete your profile</h2>
    <p class="auth-subtitle">Set your trading preferences. You can change these anytime in Settings.</p>
    <form id="profile-setup-form">
      <div class="form-group">
        <label for="setup-name">Your Name</label>
        <input type="text" id="setup-name" required placeholder="e.g. Pichan" />
      </div>
      <div class="form-group">
        <label for="setup-account">Account Size (USDT)</label>
        <input type="number" id="setup-account" min="50" value="600" required />
      </div>
      <div class="form-group">
        <label for="setup-risk">Risk per Trade (%)</label>
        <input type="number" id="setup-risk" min="1" max="20" value="10" required />
      </div>
      <div class="form-group">
        <label for="setup-telegram">Your Telegram Chat ID</label>
        <input type="text" id="setup-telegram" placeholder="e.g. 123456789" />
        <small>Get this by messaging @userinfobot on Telegram. Leave blank to skip notifications.</small>
      </div>
      <button type="submit" class="primary-btn">Save & Enter App</button>
    </form>
  </div>
</div>
```

### ui/auth.js

```javascript
import { supabase } from '../api/supabase-client.js';

export async function initAuth(onAuthSuccess) {
  // Check existing session
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    await handleAuthSuccess(session.user, onAuthSuccess);
    return;
  }

  // Show login screen
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-container').classList.add('hidden');

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Signing in...';

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      showAuthError(error.message);
      btn.disabled = false;
      btn.textContent = 'Sign in';
      return;
    }
    await handleAuthSuccess(data.user, onAuthSuccess);
  });
}

async function handleAuthSuccess(user, onAuthSuccess) {
  // Check if user profile exists
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (!profile) {
    // First login — show profile setup
    showProfileSetup(user, onAuthSuccess);
    return;
  }

  // Profile exists — enter app
  hideAllAuthScreens();
  document.getElementById('app-container').classList.remove('hidden');
  onAuthSuccess(user, profile);
}

function showProfileSetup(user, onAuthSuccess) {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('profile-setup-screen').classList.remove('hidden');

  document.getElementById('profile-setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const profile = {
      id: user.id,
      display_name: document.getElementById('setup-name').value,
      account_size: parseFloat(document.getElementById('setup-account').value),
      risk_percent: parseFloat(document.getElementById('setup-risk').value),
      telegram_chat_id: document.getElementById('setup-telegram').value.trim() || null,
      default_leverage: 7
    };

    const { error } = await supabase.from('user_profiles').insert(profile);
    if (error) { showAuthError(error.message); return; }

    hideAllAuthScreens();
    document.getElementById('app-container').classList.remove('hidden');
    onAuthSuccess(user, profile);
  });
}

function hideAllAuthScreens() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('profile-setup-screen').classList.add('hidden');
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

export async function signOut() {
  await supabase.auth.signOut();
  location.reload();
}
```

---

## Step 4 — Replace localStorage with Supabase

Replace `storage/trade-log.js` entirely:

```javascript
import { supabase } from '../api/supabase-client.js';

// ── TRADES ──────────────────────────────────────────────────

export async function loadTrades() {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .order('signal_time', { ascending: false });
  if (error) { console.error('loadTrades error:', error); return []; }
  return data;
}

export async function logTrade(tradeObj) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('trades')
    .insert({ ...tradeObj, user_id: user.id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTrade(id, updates) {
  const { error } = await supabase
    .from('trades')
    .update(updates)
    .eq('id', id);
  if (error) throw error;
}

export async function clearTradeLog() {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('trades')
    .delete()
    .eq('user_id', user.id);
  if (error) throw error;
}

// ── ALERTS ──────────────────────────────────────────────────

export async function loadAlerts() {
  const { data, error } = await supabase
    .from('alerts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) { console.error('loadAlerts error:', error); return []; }
  return data;
}

export async function addAlert(alertObj) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('alerts')
    .insert({ ...alertObj, user_id: user.id });
  if (error) console.error('addAlert error:', error);
}

export async function markAlertsRead() {
  const { data: { user } } = await supabase.auth.getUser();
  await supabase
    .from('alerts')
    .update({ is_read: true })
    .eq('user_id', user.id)
    .eq('is_read', false);
}

// ── SETTINGS (user_profiles) ─────────────────────────────────

export async function loadSettings() {
  const { data: { user } } = await supabase.auth.getUser();
  const { data } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  return data;
}

export async function saveSettings(updates) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('user_profiles')
    .update(updates)
    .eq('id', user.id);
  if (error) throw error;
}
```

---

## Step 5 — Real-Time Sync

In `app.js`, after successful auth, subscribe to real-time changes:

```javascript
function initRealtimeSync() {
  // Trades channel — syncs trade log across all devices
  supabase
    .channel('trades-sync')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'trades' },
      (payload) => {
        // Reload trade log UI when any change happens (insert, update, delete)
        renderTradeLogTable(State.trades);
        renderBacktestStats(State.trades);
        // Refresh local state
        loadTrades().then(trades => { State.trades = trades; });
      }
    )
    .subscribe();

  // Alerts channel — syncs alerts across all devices
  supabase
    .channel('alerts-sync')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'alerts' },
      (payload) => {
        State.alerts.unshift(payload.new);
        State.unreadAlertsCount++;
        renderAlertsFeed(State.alerts);
        updateAlertBadge(State.unreadAlertsCount);
        playAlertSound();
      }
    )
    .subscribe();
}
```

---

## Step 6 — Telegram Edge Function

Create `supabase/functions/telegram-notify/index.ts`:

```typescript
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Direction emoji map
const DIRECTION_EMOJI: Record<string, string> = {
  LONG: '🟢',
  SHORT: '🔴',
};

// Alert type → emoji + label
const ALERT_META: Record<string, { emoji: string; label: string }> = {
  new_signal:     { emoji: '📡', label: 'NEW SIGNAL' },
  tp1:            { emoji: '🎯', label: 'TP1 HIT' },
  tp2:            { emoji: '🎯🎯', label: 'TP2 HIT' },
  tp3:            { emoji: '💰', label: 'TP3 HIT — FULL TARGET' },
  stop_loss:      { emoji: '🛑', label: 'STOP LOSS HIT' },
  loss_limit:     { emoji: '⛔', label: 'DAILY LOSS LIMIT' },
  signal_expired: { emoji: '⏰', label: 'SIGNAL EXPIRED' },
};

async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    }),
  });
}

serve(async (req) => {
  // This function is triggered by a Supabase database webhook on alerts INSERT
  const payload = await req.json();
  const alert = payload.record;

  if (!alert) return new Response('No record', { status: 400 });

  // Use service role to bypass RLS and fetch telegram_chat_id
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // For new_signal alerts: notify ALL users who have a telegram_chat_id
  // For all other alert types: notify only the user who owns the alert
  let chatIds: string[] = [];

  if (alert.alert_type === 'new_signal') {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('telegram_chat_id')
      .not('telegram_chat_id', 'is', null);
    chatIds = (profiles ?? []).map((p: any) => p.telegram_chat_id).filter(Boolean);
  } else {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('telegram_chat_id')
      .eq('id', alert.user_id)
      .single();
    if (profile?.telegram_chat_id) chatIds = [profile.telegram_chat_id];
  }

  if (chatIds.length === 0) return new Response('No telegram recipients', { status: 200 });

  const meta = ALERT_META[alert.alert_type] ?? { emoji: '🔔', label: alert.alert_type.toUpperCase() };
  const message = `${meta.emoji} <b>${meta.label}</b>\n${alert.message}`;

  await Promise.all(chatIds.map(chatId => sendTelegramMessage(chatId, message)));

  return new Response('OK', { status: 200 });
});
```

**To deploy this Edge Function:**
```bash
# Install Supabase CLI first: https://supabase.com/docs/guides/cli
supabase login
supabase functions deploy telegram-notify --project-ref YOUR_PROJECT_REF
```

**Then create a database webhook in Supabase dashboard:**
- Database → Webhooks → Create new webhook
- Table: `alerts` | Event: `INSERT`
- URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/telegram-notify`
- HTTP method: POST

**Add to Supabase Edge Function secrets** (not Railway):
- `TELEGRAM_BOT_TOKEN` = your bot token
- `SUPABASE_SERVICE_ROLE_KEY` = from Supabase → Settings → API → service_role key

---

## Step 7 — app.js Changes

Wrap the entire app init inside an auth check:

```javascript
import { initAuth, signOut } from './ui/auth.js';
import { initRealtimeSync } from './app.js'; // same file, export the function

// At the very top of app initialization, before anything else:
async function bootstrap() {
  toggleLoading(true);

  await initAuth(async (user, profile) => {
    // User is authenticated and has a profile
    // Load settings from profile instead of localStorage
    State.settings = {
      accountSize: profile.account_size,
      riskPercent: profile.risk_percent,
      defaultLeverage: profile.default_leverage,
      pairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'],
    };
    State.currentUser = user;
    State.userProfile = profile;

    // Load trades and alerts from Supabase
    State.trades = await loadTrades();
    State.alerts = await loadAlerts();

    // Init real-time subscriptions
    initRealtimeSync();

    // Continue with normal app initialization
    initApp();
  });
}

bootstrap();
```

Add sign-out button to the topbar (next to Settings icon):
```html
<button id="signout-btn" class="icon-btn" aria-label="Sign out" title="Sign out">
  <i class="ti ti-logout"></i>
</button>
```

---

## Step 8 — Settings Page Changes

The Settings page now saves to `user_profiles` via Supabase instead of localStorage.

Add a **Telegram Chat ID** field to the settings form:
```html
<div class="form-group">
  <label for="setting-telegram">Telegram Chat ID</label>
  <input type="text" id="setting-telegram" placeholder="e.g. 123456789">
  <small>Message @userinfobot on Telegram to get your Chat ID. Leave blank to disable notifications.</small>
</div>
```

On settings form submit, call `saveSettings({ account_size, risk_percent, default_leverage, telegram_chat_id })`.

---

## Step 9 — Alert Messages to Insert

When the signal engine fires or a price event occurs, insert into the `alerts` table (not just show in UI). This is what triggers the Telegram webhook automatically.

Example insert calls to add throughout app.js:

```javascript
// New signal fired
await addAlert({
  pair: signal.pair,
  alert_type: 'new_signal',
  message: `${signal.direction} signal on ${signal.pair}\nConfidence: ${signal.confidence}% | Entry: $${signal.entryPrice.toFixed(2)}\nSL: $${signal.stopLoss.toFixed(2)} | TP1: $${signal.tp1.toFixed(2)} | TP2: $${signal.tp2.toFixed(2)}\nR:R 1:3.0 | Expires in 3H`,
  price: signal.entryPrice,
});

// Stop loss hit (check in price monitoring loop)
await addAlert({
  pair: trade.pair,
  alert_type: 'stop_loss',
  message: `Stop loss hit on ${trade.pair} ${trade.direction}\nExit at $${currentPrice.toFixed(2)}\nLoss: -$${Math.abs(pnl).toFixed(2)} USDT`,
  price: currentPrice,
});

// TP1 hit
await addAlert({
  pair: trade.pair,
  alert_type: 'tp1',
  message: `TP1 hit on ${trade.pair} ${trade.direction} ✅\nPrice reached $${currentPrice.toFixed(2)} (+${pct.toFixed(1)}%)\nAction: Close 50% now. Move SL to breakeven.`,
  price: currentPrice,
});
```

---

## Summary of What to Do (Step by Step for AntiGravity)

1. Create `config.example.js` and add `config.js` to `.gitignore`
2. Create `api/supabase-client.js`
3. Create `supabase/schema.sql`
4. Create `supabase/functions/telegram-notify/index.ts`
5. Create `ui/auth.js` — login + profile setup screens
6. Update `index.html` — add login screen HTML, profile setup HTML, sign-out button
7. Replace `storage/trade-log.js` entirely with Supabase version
8. Update `app.js` — wrap init in `bootstrap()`, add `initRealtimeSync()`, replace all `State.settings` reads with profile data
9. Update `ui/` files — replace any remaining `localStorage` calls (settings reads) with Supabase
10. Update Settings page — add Telegram Chat ID field, save via `saveSettings()`
11. Add `alert` inserts throughout `app.js` for all 6 alert types
12. Push to GitHub → Railway auto-redeploys
13. Deploy Edge Function via Supabase CLI
14. Create database webhook in Supabase dashboard pointing to Edge Function
15. Add `TELEGRAM_BOT_TOKEN` and `SUPABASE_SERVICE_ROLE_KEY` to Supabase Edge Function secrets
16. Update `CHANGE.md` with all changes

---

## What to Ask Pichan Before Starting

1. **Supabase URL** — from Supabase → Settings → API
2. **Supabase Anon Key** — from Supabase → Settings → API
3. **Telegram Bot Token** — from @BotFather
4. His **Telegram Chat ID** — he gets it by messaging @userinfobot on Telegram

His friend will add their own Telegram Chat ID in the app's Settings page after logging in for the first time.

---

## Important Constraints

- Signal engine (`engine/` folder) — **do not touch**
- Binance WebSocket and REST API calls — **do not touch**
- The app remains a static site on Railway (nginx Dockerfile) — **no new server**
- No open signup — users are invited via Supabase dashboard only
- All Supabase secrets go in `config.js` (gitignored) or Railway variables — never committed to GitHub
- Keep `CHANGE.md` updated with every file changed
