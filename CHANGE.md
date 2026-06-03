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
