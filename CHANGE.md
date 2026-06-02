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
