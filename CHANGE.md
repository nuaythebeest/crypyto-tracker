# Change Log

All modifications to the Crypto Futures Signal Tracker from this point forward will be logged here.

## 2026-06-01

### 1. Chart Auto-Scaling Fix
- **Problem**: The price graph Y-axis was scaling down to `0.00`, compressing price candles into a flat line. This occurred because indicator series (like Bollinger Bands or EMAs) contained `null` or `0` values during the initial candles.
- **Solution**: Updated `ui/chart.js` to filter out `null`, `undefined`, or `NaN` values before passing data to `setData`. The chart now correctly auto-scales to fit only the valid price range.

### 2. Signal Dismissal on Taken/Skip
- **Problem**: Active signal cards remained on the dashboard even after the user clicked "Taken" or "Skip" because signal IDs were randomly generated on every analysis run (leading to mismatch).
- **Solution**: 
  - Preserved signal identity (ID, signalTime, expiresAt) in `app.js` across consecutive analysis runs for the same pair and direction.
  - Implemented robust multi-criteria filtering in `app.js` to suppress signal cards if there is an active open trade for that pair and direction, or if a skipped trade for that pair and direction was logged within the last 3 hours.

### 3. Light Theme Refactor
- **Problem**: The app was built with a dark theme, but the user requested a clean light theme.
- **Solution**:
  - Overhauled CSS variables in `style.css` to adopt a premium light theme layout (white surfaces, soft off-white application backgrounds, clean slate border dividers, and high-contrast dark text).
  - Replaced translucent white hover backgrounds (`rgba(255, 255, 255, ...)`) in `style.css` with translucent slate-black equivalents (`rgba(0, 0, 0, ...)`) to ensure visibility on light surfaces.
  - Updated Bollinger Bands line series colors in `ui/chart.js` from translucent white to translucent dark slate so they are clearly visible on a light background.
  - Updated Take Profit (TP) overlay lines to be consistently colored green (`#22c55e`) and Stop Loss (SL) lines to be colored red (`#ef4444`) regardless of trade direction, ensuring short setups do not display confusing matching red lines for both targets and stops.
  - Updated hardcoded neon border colors on badges, banners, and buttons in `style.css` to use appropriate light-theme high-contrast color values.

### 4. Railway Deployment Files
- **Problem**: Need to deploy the pure static HTML/JS application to Railway.
- **Solution**: Added a custom `Dockerfile` using `nginx:alpine` to serve static files over HTTP, and added a `.gitignore` to prevent committing logs, environment files, or node modules.

### 5. Mobile iPhone Responsive Optimization
- **Problem**: The 3-column desktop layout was squashed and completely unusable on mobile devices (e.g. iPhone).
- **Solution**:
  - Implemented responsive CSS layout rules in `style.css` using media queries (`max-width: 992px` and `max-width: 768px`) that stack columns vertically without affecting the laptop layout.
  - Converted the sidebar into a sliding navigation drawer, toggled via a new hamburger menu button in the topbar and dismissed by clicking a blurred backdrop overlay.
  - Enabled swipeable/touch-scrolling behavior for the pair tab bar in the topbar on narrow viewports.
  - Compressed connection status label texts on mobile to prevent topbar overflow.
  - Allowed cards, visualization charts, and metrics tables to stretch and wrap naturally on small screens.

### 6. Desktop Layout Restoration (Grid Alignment Fix)
- **Problem**: On laptop/desktop viewports, the layout broke: the sidebar shifted to the center, the chart shifted to the narrow right column, and the calculator fell to the bottom. This happened because the newly added `#sidebar-backdrop` div participated in the 3-column desktop CSS Grid layout as the first child item, shifting all subsequent columns.
- **Solution**: Set `.sidebar-backdrop` to `display: none;` on desktop viewports. Since elements with `display: none` do not participate in CSS Grid positioning, the grid items naturally fall back into their correct desktop slots (Sidebar, Main Area, and Right Panel). On mobile, `display: block` is restored on `.sidebar-backdrop` when the navigation drawer is active.

---

## 2026-06-02 — V2 Upgrade: Supabase + Auth + Telegram + Multi-User

### 7. Supabase Database Integration
- **Problem**: All data (settings, trades, alerts) was stored in `localStorage`, making it browser-only with no cross-device sync or multi-user support.
- **Solution**:
  - Created `supabase/schema.sql` with 3 tables: `user_profiles`, `trades`, `alerts` — each with Row-Level Security (RLS) policies ensuring users can only access their own data.
  - Created `api/supabase-client.js` importing `@supabase/supabase-js` from CDN (ESM) to initialize a singleton client.
  - Created `config.example.js` (committed template) and `config.js` (gitignored) for Supabase credentials.
  - Added `config.js` to `.gitignore`.

### 8. Authentication (Login + Profile Setup)
- **Problem**: No user authentication — anyone could access the app.
- **Solution**:
  - Created `ui/auth.js` with `initAuth()`, `signOut()`, and first-login profile setup flow.
  - Updated `index.html` to add `#login-screen` and `#profile-setup-screen` sections before `#app-container`. The app container starts hidden until auth succeeds.
  - Added a sign-out button (`#signout-btn`) to the topbar.
  - Added premium auth screen CSS styles with glassmorphic card, entrance animation, error shake, and focus ring effects.
  - Users are invite-only — created via the Supabase dashboard (Authentication → Invite User).

### 9. Storage Layer Rewrite (localStorage → Supabase)
- **Problem**: `storage/trade-log.js` used synchronous `localStorage` API for all CRUD.
- **Solution**:
  - Completely rewrote `storage/trade-log.js` — all 10 functions are now `async` and query Supabase PostgreSQL.
  - Added camelCase ↔ snake_case field mapping between app and database schemas.
  - Removed `saveTrades()` and `saveAlerts()` (no longer needed with per-operation persistence).
  - Added new functions: `updateTrade()`, `markAlertsRead()`, `clearAlerts()`.
  - All callers in `app.js` updated to `await` the now-async functions.

### 10. App Controller V2 Rewrite
- **Problem**: `app.js` initialized directly on DOMContentLoaded with no auth check, used synchronous storage calls, and had no real-time sync.
- **Solution**:
  - Wrapped initialization in `bootstrap()` → `initAuth()` → `initApp()` flow.
  - All storage calls converted to `async/await`.
  - Added `initRealtimeSync()` subscribing to Postgres changes on `trades` and `alerts` tables for cross-device sync.
  - `triggerAlert()` now inserts structured alerts into Supabase (pair, alert_type, message, price) which triggers the Telegram webhook.
  - Alert types: `new_signal`, `tp1`, `tp2`, `stop_loss`, `signal_expired`.
  - Fixed existing bug: `updateTrade` was used but never imported.
  - Removed direct `localStorage.removeItem()` call in clear-alerts handler.
  - Added State fields: `currentUser`, `userProfile`.

### 11. Settings Page — Telegram Integration
- **Problem**: No way for users to configure Telegram notifications.
- **Solution**:
  - Added Telegram Chat ID field (`#setting-telegram`) to the Settings form in `index.html`.
  - `loadSettingsForm()` and `handleSettingsSubmit()` in `app.js` now read/write the `telegram_chat_id` field.
  - Settings save to `user_profiles` table via Supabase instead of localStorage.

### 12. Telegram Edge Function
- **Problem**: No push notifications for trading signals and alerts.
- **Solution**:
  - Created `supabase/functions/telegram-notify/index.ts` — a Deno Edge Function triggered by database webhook on `alerts` INSERT.
  - For `new_signal` alerts: broadcasts to ALL users with a Telegram Chat ID configured.
  - For personal alerts (TP hit, SL hit): sends only to the trade owner.
  - Formatted with emoji-rich HTML messages.

### Files Changed
| Action | File |
|---|---|
| NEW | `config.example.js` |
| NEW | `config.js` (gitignored) |
| NEW | `api/supabase-client.js` |
| NEW | `supabase/schema.sql` |
| NEW | `supabase/functions/telegram-notify/index.ts` |
| NEW | `ui/auth.js` |
| MODIFIED | `.gitignore` |
| MODIFIED | `index.html` |
| MODIFIED | `style.css` |
| REWRITTEN | `storage/trade-log.js` |
| REWRITTEN | `app.js` |
| UPDATED | `CHANGE.md` |

---

## 2026-06-03 — V3: Telegram Notifications + Security Hardening

### 13. Direct Telegram Notifications from Browser
- **Problem**: No push notifications when signals fire, TP/SL are hit, or daily loss limit is reached.
- **Solution**:
  - Created `api/telegram.js` — calls Telegram Bot API directly from browser JS using credentials from `config.js`.
  - Added `sendTelegram()` import to `app.js` and placed it at 4 call sites:
    1. **New signal fires** (confidence ≥ 70%) — sends full signal details (pair, direction, entry, SL, TP1-3, R:R)
    2. **TP1 hit** — notifies to close 50% and move SL to breakeven
    3. **Stop loss hit** — sends exit price and loss amount
    4. **Daily loss limit reached** — warns to step away until 00:00 UTC
  - Updated `config.example.js` with Telegram placeholder lines.
  - Updated `config.js` with real bot token and chat ID.

### 14. HTTP Basic Auth (nginx level)
- **Problem**: Anyone who finds the Railway URL can access the app — bot tokens and trade signals exposed.
- **Solution**:
  - Created `nginx.conf` with `auth_basic` directive — prompts browser login before any content loads.
  - Created `entrypoint.sh` — generates `.htpasswd` at container startup from `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` Railway environment variables. Falls back to no-auth if vars are missing.
  - Replaced `Dockerfile` — installs `apache2-utils` for `htpasswd`, copies custom nginx config, and uses entrypoint script.
  - Added `.htpasswd` to `.gitignore`.

### 15. Security Headers
- **Problem**: No protection against clickjacking, XSS, MIME sniffing, or fingerprinting.
- **Solution**: Added 6 security headers in `nginx.conf`:
  - `X-Frame-Options: DENY` — prevents iframe embedding
  - `X-Content-Type-Options: nosniff` — blocks MIME sniffing
  - `X-XSS-Protection: 1; mode=block` — legacy XSS filter
  - `Referrer-Policy: no-referrer` — hides referer
  - `Permissions-Policy` — disables camera/mic/geolocation
  - `Content-Security-Policy` — restricts scripts/styles/fonts to known CDNs only

### Files Changed
| Action | File |
|---|---|
| NEW | `api/telegram.js` |
| NEW | `nginx.conf` |
| NEW | `entrypoint.sh` |
| REPLACED | `Dockerfile` |
| MODIFIED | `config.example.js` |
| MODIFIED | `config.js` |
| MODIFIED | `.gitignore` |
| MODIFIED | `app.js` (4 sendTelegram call sites + import) |
| UPDATED | `CHANGE.md` |

### After Push — Railway Setup Required
Set these in Railway → Variables:
- `BASIC_AUTH_USER` — your chosen username
- `BASIC_AUTH_PASSWORD` — strong password (min 12 chars)

### 16. V2 Revert — Blank Page Fix
- **Problem**: V2 Supabase code (auth, realtime sync, Supabase-backed storage) was layered into the app, but V3 instructions explicitly specified "No backend, no database, no Supabase." The Supabase auth flow hid all screens on failure (CSP blocked connections + placeholder credentials), causing a blank page on Railway.
- **Solution**:
  - Restored `app.js`, `storage/trade-log.js`, `index.html`, `style.css`, and `ui/trade-log-ui.js` to their pre-V2 state (localStorage-based, no auth).
  - Re-applied only V3 changes: `sendTelegram` import + 4 call sites.
  - Removed V2-only files: `api/supabase-client.js`, `ui/auth.js`, `supabase/` directory.
  - Kept V3 files: `api/telegram.js`, `nginx.conf`, `entrypoint.sh`, updated `Dockerfile`.

---

## 2026-06-03 — Bug Fixes: Token Security, Telegram, Chrome Session

### 17. Telegram Bot Token — Remove from Git (Security Fix)
- **Problem**: Real Telegram bot token and chat ID were committed in `config.js` (commit 15f88e2), triggering a GitHub secret scanning warning. The token was exposed in git history.
- **Solution**:
  - Replaced real credentials in `config.js` with placeholder values. The file is now safe to track.
  - `entrypoint.sh` already generates `config.js` at container startup from Railway environment variables — this is the correct secure flow.
  - **Action required**: Regenerate your Telegram bot token via BotFather (`/revoke` then create new token) since the old token is in git history. Set the new token in Railway → Variables → `TELEGRAM_BOT_TOKEN`.

### 18. Telegram Alerts — Missing `updateTrade` Import (Code Bug Fix)
- **Problem**: `updateTrade` was called in `checkLivePriceAlerts()` (`app.js:483`) when auto-closing a stop-loss trade, but was never imported from `storage/trade-log.js`. This caused a `ReferenceError` crash every time a stop-loss was hit, leaving the trade stuck as "open" in localStorage and potentially spamming the SL alert on every price tick.
- **Solution**: Added `updateTrade` to the import statement in `app.js`.
- **Note**: The `sendTelegram()` call for SL notification runs before `updateTrade`, so Telegram messages were being sent. The crash happened after the Telegram send — resulting in duplicate SL alerts until the app was reloaded.

### 19. Telegram Alerts — Railway Environment Variables Required
- **Problem**: When deployed to Railway, `entrypoint.sh` generates `config.js` from `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` environment variables. If these are not set, the generated config has empty strings and `sendTelegram()` silently bails out.
- **Solution**: No code change needed — architecture is correct. Set these in Railway → Variables:
  - `TELEGRAM_BOT_TOKEN` — your new bot token from BotFather
  - `TELEGRAM_CHAT_ID` — your Telegram user or group chat ID
  - Get your chat ID: message `@userinfobot` on Telegram, or start your bot and call `https://api.telegram.org/bot<TOKEN>/getUpdates`

### 20. Chrome Session — Stale Cache + CSP Malformed Header Fix
- **Problem 1 (Cache)**: Chrome cached the V2 blank-page version of the app (deployed 2026-06-02). Subsequent visits in regular Chrome loaded the broken cached version. Incognito has no cache, so it loaded the correct V3 app.
- **Problem 2 (CSP)**: The `Content-Security-Policy` header in `nginx.conf` spanned multiple lines with embedded newlines — this produces a malformed HTTP header. Chrome may reject or truncate it, potentially blocking scripts from loading.
- **Solution**:
  - Added `Cache-Control: no-cache, must-revalidate` header in `nginx.conf` — forces browsers to revalidate app files on every load instead of serving stale cached versions.
  - Flattened the `Content-Security-Policy` header to a single line to produce a valid HTTP header.
  - Added `/logout` endpoint in `nginx.conf` — visit `https://your-railway-url/logout` to force Chrome to forget its cached Basic Auth credentials and re-prompt for login.

### Files Changed
| Action | File |
|---|---|
| MODIFIED | `config.js` (placeholder credentials — real token removed) |
| MODIFIED | `app.js` (added `updateTrade` to imports) |
| MODIFIED | `nginx.conf` (Cache-Control header, flattened CSP, /logout endpoint) |
| UPDATED | `CHANGE.md` |

### After Push — Action Required
1. **Regenerate Telegram bot token** via BotFather (old token is in git history)
2. **Set Railway env vars**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
3. **Fix Chrome**: visit `https://your-railway-url/logout`, then reload the app

---

## 2026-06-03 — Telegram Test Button + Silent Alert Refactor

### 21. Telegram Test Button in Settings
- **Problem**: No way to verify Telegram credentials are working without waiting for a real signal to fire.
- **Solution**:
  - Added "Send Test Message" button to Settings page (`index.html`) with inline status feedback.
  - Button calls `sendTelegram()` directly — shows `✓ Sent!` on success or `✗ Failed: <reason>` on error (e.g. wrong token, invalid chat ID).
  - Status message uses `--color-bullish` / `--color-bearish` CSS variables for visual clarity.

### 22. Telegram Silent vs Throwing Split (`api/telegram.js`)
- **Problem**: `sendTelegram` swallowed all errors silently — test button would show success even when credentials were wrong or API returned an error. Also, a Telegram failure in the signal engine would crash unrelated logic if errors were not caught.
- **Solution**:
  - `sendTelegram(message)` — now throws `Error` with Telegram API error description on failure. Used by test button so errors surface to UI.
  - `sendTelegramSilent(message)` — wraps `sendTelegram`, catches and logs errors. Used by all 4 fire-and-forget alert sites (new signal, SL hit, TP1 hit, daily loss limit) so a Telegram failure never interrupts the trading engine.
  - Updated all 4 call sites in `app.js` to use `sendTelegramSilent`.

### Files Changed
| Action | File |
|---|---|
| MODIFIED | `index.html` (Test Telegram button in Settings) |
| MODIFIED | `api/telegram.js` (split into sendTelegram + sendTelegramSilent) |
| MODIFIED | `app.js` (import sendTelegramSilent, swap 4 call sites, wire test button) |
| UPDATED | `CHANGE.md` |

---

## 2026-06-04 — Signal History, Market Scanner, Backtest Capture Rate

### 23. Complete Signal History — Auto-Log All Signals as 'Observed'
- **Problem**: Trade log only recorded signals you explicitly took or skipped. Ignored signals were lost. Backtest had no visibility into full signal stream.
- **Solution**:
  - Every signal firing (confidence ≥ 70%) is now auto-logged with `status: 'observed'` — full entry/SL/TP/confidence captured at fire time.
  - `'observed'` rows appear dimmed/italic in trade log — visually distinct from entered trades.
  - Clicking "Take" on dashboard updates the existing `'observed'` record to `'taken'` (no duplicates). "Skip" similarly updates to `'skipped'`.
  - `'observed'` status does **not** suppress the signal card — card stays visible until explicitly taken or skipped.
  - Telegram alert and in-app notification fire exactly once per new signal (`isNewSignal` flag tracks first-seen).

### 24. Trade Log — "Enter Trade" Button for Observed Signals
- **Problem**: No way to retroactively log entry for an auto-observed signal (e.g. entered on exchange but missed the dashboard "Take" button).
- **Solution**:
  - Added "Enter Trade" button on every `'observed'` row in trade log table.
  - Opens same "Take Signal Setup" modal used on dashboard.
  - On confirm, updates `'observed'` record to `'taken'` with full sizing info. No duplicate rows.

### 25. Backtest — Signal Capture Rate + All-Signal Visualization
- **Problem**: Backtest showed only taken trades. No visibility into how many signals fired vs entered (capture rate). Confidence distribution skipped observed/skipped signals.
- **Solution**:
  - "Total Signals" card renamed to **Signal Capture** — shows `taken / total_fired` (e.g. `3 / 8`) with capture rate % subtitle.
  - Win/Loss dots now show all signals (last 20): `W` win, `L` loss, `P` partial, `O` open taken, `—` skipped, `?` observed. Legend added below dots.
  - Confidence distribution now counts all signals per bucket (observed + skipped + taken), showing taken count and win rate per bucket.

### 26. Market Scanner — All-Pairs Overview Page
- **Problem**: "AI Signals" nav item was never implemented — clicking it showed empty page. Users clicked each pair individually to check signal status.
- **Solution**:
  - Repurposed empty page as **Market Scanner**. Nav icon → radar, label → "Market Scanner".
  - Shows all configured pairs as cards: price, 24h change %, signal (LONG/SHORT/No Signal + confidence %), market mode, 4H RSI, daily trend.
  - Clicking a card switches to that pair on Dashboard.
  - "Refresh Scan" button re-runs analysis.
  - Signals discovered during scan auto-logged as `'observed'`.

### Files Changed
| Action | File |
|---|---|
| MODIFIED | `index.html` (nav rename, Market Scanner page, Backtest capture metric) |
| MODIFIED | `style.css` (scanner grid/card styles, observed row, dot classes) |
| MODIFIED | `app.js` (auto-log observed, isNewSignal, isLogged fix, skip/take updates, renderMarketScanner) |
| MODIFIED | `ui/trade-log-ui.js` (observed row, Enter Trade button, onMarkTaken callback) |
| MODIFIED | `ui/backtest-ui.js` (capture rate, all-signal dots, confidence distribution) |
| UPDATED | `CHANGE.md` |

---

## 2026-06-04 — Backtest: Effective Win Rate Over All Signals

### 27. Effective Win Rate — All Signals as Denominator
- **Problem**: Win rate was calculated as `wins ÷ closed_taken_trades`, which only reflected performance of trades you chose to enter. Missed signals (observed/skipped) were invisible to the metric — making win rate look artificially high.
- **Solution**:
  - Win rate now uses **all signals fired** as denominator: `wins ÷ total_signals_fired` (observed + skipped + taken).
  - Observed/skipped signals count as non-wins. This gives the true "effective system win rate" — how good the overall signal engine + your discipline combination actually is.
  - Average R:R and Total PnL remain based on actual closed taken trades (we have no real exit data for unobserved signals).
  - Equity curve now plots **all signals chronologically** — observed/skipped signals appear as flat (0-PnL) steps, visually showing where opportunities were passed up or missed.
  - Metric renamed "Effective Win Rate" with subtitle "Wins ÷ All Signals Fired" for clarity.

### Files Changed
| Action | File |
|---|---|
| MODIFIED | `index.html` (Win Rate label + subtitle updated) |
| MODIFIED | `ui/backtest-ui.js` (win rate denominator, equity curve includes all signals) |
| UPDATED | `CHANGE.md` |

---

## 2026-06-06 — Alert Flood Fix, Telegram Reply Commands, Multi-Pair Scan

### 28. Alert Flood Fix — 5-Minute Cooldown Per Alert Type
- **Problem**: `checkLivePriceAlerts` fires on every WebSocket price tick with no throttle. Price hovering at TP1 for a few seconds produces 4–10 identical Telegram messages simultaneously.
- **Solution**:
  - Added `State.alertCooldowns = {}` — in-memory map of `"tradeId:alertType" → lastFiredTimestamp`.
  - Each alert type (`:tp1`, `:tp2`, `:sl`) per trade is gated by `ALERT_COOLDOWN_MS = 5 minutes`.
  - Telegram messages for TP1 and TP2 now include `Reply close to stop further alerts.` hint.
  - SL alert still auto-closes the trade (drops from `openTrades` filter), cooldown adds safety margin for the race window between alert and `State.trades = loadTrades()`.

### 29. New Signal Re-Alert Fix — Reconnect / Page Reload De-Duplication
- **Problem**: On WebSocket reconnect or hard page reload, `State.allAnalysis` is cleared. Signal engine generates a new UUID for the same continuing signal. `alreadyLogged` check (ID-based) misses it → Telegram fires "NEW SIGNAL" again, creating hourly duplicates.
- **Solution**:
  - Added secondary guard in `runAnalysisForPair`: after ID-based check fails, look for a recent `observed`/`taken` (non-closed) signal for the same pair+direction within the last 3 hours in localStorage.
  - If found: silently update prices on existing record (entry/SL/TP drift with market) and adopt its persisted ID — no new alert fires.
  - If not found: genuinely new signal → log + alert as before.

### 30. Telegram Reply Commands — Control Trades from Telegram
- **Problem**: App could only send alerts to Telegram. Users had to open the app to mark signals as taken/skipped or to close trades and stop TP spam.
- **Solution**:
  - Added `fetchTelegramUpdates(offset)` to `api/telegram.js` — polls `getUpdates` API for incoming messages.
  - Added `processTelegramReplies()` to `app.js` — runs every 60 seconds.
  - Parses `reply_to_message.text` to identify which pair+direction the reply refers to.
  - Supported commands (reply to any bot alert):
    | Reply | Action |
    |---|---|
    | `taken` / `take` / `yes` | Mark most recent observed signal as taken |
    | `skip` / `pass` / `no` | Mark observed signal as skipped |
    | `close` / `sold` / `done` / `closed` | Close open taken trade, compute PnL, stop TP alerts |
  - Sends confirmation back to Telegram after each action.
  - Runs initial pass on app startup to catch replies sent while app was offline.

### 31. Multi-Pair Background Scan — All Pairs Get Signals
- **Problem**: Signal analysis only ran for `State.activePair`. ETH, SOL, BNB, XRP were never analyzed unless user clicked them or opened Market Scanner. Users only saw BTC signals in Telegram.
- **Solution**:
  - Added 10-minute background timer in `init()` that runs `runAnalysisForPair` for every configured pair **except the active pair** (active pair is already refreshed by dashboard interactions).
  - API load: 5 pairs × 4 calls = 20 requests per 10 minutes — well within Binance limits (1200/min).
  - New signals on any pair now auto-log as `observed` and fire Telegram alerts regardless of which pair is currently displayed on screen.

### Files Changed
| Action | File |
|---|---|
| MODIFIED | `app.js` (State: alertCooldowns+lastTelegramUpdateId, cooldown logic, re-alert guard, processTelegramReplies, background scan timer) |
| MODIFIED | `api/telegram.js` (add fetchTelegramUpdates export) |
| UPDATED | `CHANGE.md` |

### 32. Trade Log Scroll + Trade-Log Auto-Backtest (commit fbc5ac0)
- **Problem**: Trade log table clipped (no horizontal/vertical scroll); Backtest page always showed 0/0 because all signals were `observed` and never evaluated.
- **Solution**: `.table-container` overflow fixed; `#page-tradelog`/`#page-backtest` height freed for scrolling. Added `fetchKlinesRange` + `autoEvaluateExpiredSignals()` — "Auto-Backtest" button grades expired observed signals by first TP1/SL touch on 1H candles and writes simulated PnL into the log.

### 33. Liquidation Guard — Leverage Capped by Stop-Loss Distance
- **Problem**: Repeated real liquidations. With e.g. SL at −3.5% and 20x leverage, the liquidation price (~−4.5%) sits close behind the stop; any wick through both kills the whole margin instead of a controlled SL exit. Old guard only required a 2% price gap.
- **Solution** (`risk/position-sizing.js`, `ui/calculator.js`, `app.js`, `index.html`):
  - New rule: liquidation distance must be ≥ **1.3× SL distance** (`maxLev = 1 / (1.3 × slDist + 0.5% MMR)`).
  - `getMaxSafeLeverage(entry, sl)` exported and shown in calculator + take-trade modal.
  - Calculator marks unsafe leverage buttons red/struck-through with explicit warning.
  - Take-trade modal: pre-selected leverage auto-clamped to safe value; selecting an unsafe leverage disables the Confirm button (hard block) and shows the max safe value.

### 34. Historical Backtester + Data-Driven Engine Retune
- **Problem**: Engine parameters (threshold, filters, TP distances) were guesses. Live results: losing streaks, especially shorts. Needed measured evidence.
- **Solution**:
  - `engine/backtester.js` — replays `analyzeMarket()` bar-by-bar over 12 months × 5 pairs with **no lookahead** (trailing 200-candle windows incl. aggregated partial 4H/1D/1W candles, mirrors live exactly). Candidates captured at score ≥ 60 with all block flags (candidateMode in `signal-engine.js`), each graded against a 3 SL-mult × 5 TP-distance outcome grid by first-touch walk-forward (48H horizon, both-touch = loss, conservative). Funding history included.
  - `scripts/run-backtest.mjs` + `scripts/analyze-backtest.mjs` — headless Node runners; `ui/engine-backtest-ui.js` + Backtest page section — in-browser simulation + full report (persisted to localStorage).
  - Tuner: grid search over 2,400 configs, trained on first 9 months, validated on last 3 (holdout).
- **Measured results (5,945 candidate signals, Jun 2025 → Jun 2026)**:
  | Config | Win rate | Expectancy | Holdout |
  |---|---|---|---|
  | Original (thr 70, no filters, TP 1.5R) | 40.1% | +0.05R | — |
  | Previous live (thr 77 + filters, TP 1.5R) | 42.7% | +0.09R | **−0.08R (LOSES)** |
  | **New live (ADX ≥ 25, TP1 = 1.0R)** | **56.1% train** | **+0.11R train** | **57.9% / +0.08R (HOLDS)** |
- **Key findings (honest)**:
  - Confidence score has ~no predictive power: 42–45% win rate in every bucket 60→90+. Threshold is volume control only.
  - ADX ≥ 25 was the **only** filter improving both train and holdout. Weekly/RSI/funding filters never bind at thr 77 (kept as free safety rails).
  - TP distance is the real win-rate lever: 0.8R ≈ 61%, 1.0R ≈ 55–58%, 1.5R ≈ 43%, 3R ≈ 22% — the old 1.5R/3R/5R ladder failed out-of-sample.
  - **70–80% win rate with positive expectancy was NOT achievable** on 12-month data. Best robust: ~56–65% (recent 3-month BTC sample: 76%, n=23 — small sample, do not extrapolate).
  - Naive grid-tuning overfits: top train configs (TP 3R) all lost on holdout. Watch item: BOS-flagged signals underperform (not blocked yet, sample too small).
- **Applied to live engine**: ADX gate 18 → **25**; TP ladder 1.5/3/5R → **1.0/2.0/3.0R**; R:R label 1:3 → 1:2; threshold stays 77.
- Fees note: ~0.04R/trade round-trip taker fees not modeled; net expectancy ≈ +0.02–0.07R/trade. Prefer limit entries.

### Files Changed
| Action | File |
|---|---|
| NEW | `engine/backtester.js`, `ui/engine-backtest-ui.js`, `scripts/run-backtest.mjs`, `scripts/analyze-backtest.mjs` |
| MODIFIED | `engine/signal-engine.js` (candidateMode, ADX 25, TP 1.0/2.0/3.0R) |
| MODIFIED | `risk/position-sizing.js`, `ui/calculator.js`, `app.js`, `index.html`, `style.css` (liquidation guard, backtest UI) |

### 35. A+ Setup Research — Result: Baseline IS the A+ Tier (TP1 → 0.8R)
- **Goal**: find a hypothesis-driven signal subset with OOS win rate ≥ 65-70% (accept low frequency). Validation bar: resolved OOS n ≥ 60, Wilson 95% lower bound ≥ 60%, expectancy − 0.04R fees > 0, all 4 sequential OOS windows ≥ 50%, no pair > 50% of trades.
- **Method**: backtester v2 records 12 new features per candidate (BTC daily/4H-ADX/weekly context via BTC-first simulation pass, bars-since-4H-EMA50-cross, directional extension vs 4H EMA50 + daily EMA20 in ATR units, ATR percentile 90d, BB-width percentile 90d, continuous 4H/1H RSI, UTC hour, weekday). 17 fixed a-priori feature conditions ranked on first 6 months only; combos (max 3 conditions) validated on last 6 months in 4 sequential windows. `scripts/aplus-research.mjs`.
- **Measured findings**:
  - Engine is a **momentum-continuation** system: "extended >1.5 ATR past 4H EMA50" (+6.2% lift) and "mature trend" (+4.0%) ranked top in train; pullback/fresh-trend/RSI-room hypotheses all NEGATIVE (pullback −24.9%).
  - All 15 tested combo rules FAILED the bar — either train/OOS regime flips (A-G) or OOS Wilson LB < 60% (H-N momentum family, train 67-72% that didn't generalize).
  - **The full baseline signal set itself passed every criterion** at TP 0.8R: OOS 256 resolved, 66.4% win, Wilson LB 60.4%, net +0.106R after fees, windows 53/78/51/85%, max pair share 23%. No subset beat it — extra conditions shrank samples without adding robust edge.
- **Applied**: TP1 0.8R (was 1.0R) — wins on win rate in BOTH periods (train 59.3% vs 53.5%; OOS 66.4% vs 60.9%), net-positive after fees in both. TP2 2R / TP3 3R unchanged. No A+ badge shipped: every signal already is the validated tier; a separating badge would imply an edge the data does not support.
- **Honest caveats**: net expectancy at 1.0R was slightly higher in OOS (+0.123R vs +0.106R) — 0.8R chosen because the stated objective is win rate with positive expectancy, not max expectancy. 66% is an OOS estimate, not a promise; Wilson floor is 60%.

### Files Changed
| Action | File |
|---|---|
| MODIFIED | `engine/backtester.js` (v2 features, BTC context pass, LIVE_CONFIG tpR 0.8) |
| MODIFIED | `engine/signal-engine.js` (TP1 0.8R) |
| NEW | `scripts/aplus-research.mjs` |
