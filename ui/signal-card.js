/**
 * Signal Card Component Renderer
 */

/**
 * Render a trade setup card or a "No Signal" placeholder
 * @param {Object} signal - Signal object from engine
 * @param {string} direction - 'LONG' | 'SHORT'
 * @param {number} defaultLeverage - Default leverage from settings to compute preview liquidation
 * @param {string} reason - Optional message for why signal was suppressed (e.g. funding extreme)
 * @param {Object} callbacks - Action callbacks: { onTake, onSkip }
 * @returns {string} HTML content representing the card state
 */
export function renderSignalCard(signal, direction, defaultLeverage, reason = '', callbacks) {
  const isLong = direction === 'LONG';
  const containerId = isLong ? 'long-signal-container' : 'short-signal-container';
  const container = document.getElementById(containerId);
  if (!container) return;

  // 1. If NO signal, render placeholder
  if (!signal) {
    let placeholderText = 'Awaiting trend confluence and trigger candle confirmations...';
    let iconClass = 'ti ti-loader';
    
    if (reason) {
      placeholderText = reason;
      iconClass = 'ti ti-alert-triangle';
    }

    container.innerHTML = `
      <div class="no-signal-placeholder">
        <i class="${iconClass}"></i>
        <p>${placeholderText}</p>
      </div>
    `;
    return;
  }

  // 2. Compute liquidation price using the active signal params and default leverage
  const MMR = 0.005;
  const entryPrice = signal.entryPrice;
  let liqPrice = 0;
  if (isLong) {
    liqPrice = entryPrice * (1 - (1 / defaultLeverage) + MMR);
  } else {
    liqPrice = entryPrice * (1 + (1 / defaultLeverage) - MMR);
  }

  // Color coding for confidence bar
  let confColorClass = 'bg-yellow';
  if (signal.confidence >= 90) confColorClass = 'bg-green';
  else if (signal.confidence >= 80) confColorClass = 'bg-green'; // lighter green

  // Dynamic status badges
  let statusBadge = '';
  if (signal.status === 'taken') {
    statusBadge = `<span class="badge badge-blue">LOGGED TAKEN</span>`;
  } else if (signal.status === 'skipped') {
    statusBadge = `<span class="badge badge-grey">SKIPPED</span>`;
  }

  // Draw card HTML
  container.innerHTML = `
    <div class="signal-card ${isLong ? 'long' : 'short'}">
      <div class="signal-card-header">
        <span class="signal-dir-label">${isLong ? 'LONG / CALL' : 'SHORT / PUT'}</span>
        <div style="display: flex; gap: 8px; align-items: center;">
          ${statusBadge}
          <span class="signal-lev-badge">Rec: ${defaultLeverage}x Isolated</span>
        </div>
      </div>
      
      <div class="signal-card-grid">
        <div class="grid-item">
          <span class="label">Entry Zone</span>
          <span class="val">$${signal.entryZone.low.toFixed(2)} - $${signal.entryZone.high.toFixed(2)}</span>
        </div>
        <div class="grid-item">
          <span class="label">Stop Loss</span>
          <span class="val danger-text">$${signal.stopLoss.toFixed(2)} (${signal.slDistancePct}%)</span>
        </div>
        <div class="grid-item">
          <span class="label">Liq. Price (Est)</span>
          <span class="val danger-text">$${liqPrice.toFixed(2)}</span>
        </div>
        <div class="grid-item">
          <span class="label">Risk/Reward</span>
          <span class="val success-text">1 : ${signal.riskReward} (at TP2)</span>
        </div>
      </div>

      <div class="tp-container">
        <h4>Take Profit Targets</h4>
        <div class="tp-targets">
          <div class="tp-target-box">
            <span class="tp-label">TP1 (50%)</span>
            <span class="tp-price">$${signal.tp1.toFixed(2)}</span>
            <span class="tp-pct">+${signal.tp1Pct}%</span>
          </div>
          <div class="tp-target-box">
            <span class="tp-label">TP2 (30%)</span>
            <span class="tp-price">$${signal.tp2.toFixed(2)}</span>
            <span class="tp-pct">+${signal.tp2Pct}%</span>
          </div>
          <div class="tp-target-box">
            <span class="tp-label">TP3 (20%)</span>
            <span class="tp-price">$${signal.tp3.toFixed(2)}</span>
            <span class="tp-pct">+${signal.tp3Pct}%</span>
          </div>
        </div>
      </div>

      <div class="confidence-bar-area">
        <div class="confidence-label-row">
          <span class="confidence-title">Confidence Level</span>
          <span class="confidence-value">${signal.confidence}%</span>
        </div>
        <div class="confidence-track">
          <div class="confidence-fill" style="width: ${signal.confidence}%; background-color: var(--color-conf-${signal.confidence >= 80 ? 'high' : 'low'})"></div>
        </div>
        <div class="score-breakdown-text">
          Confluence: Daily ${signal.scoreBreakdown.daily} | 4H ${signal.scoreBreakdown.fourH} | 1H ${signal.scoreBreakdown.oneH} | Ext ${signal.scoreBreakdown.external} | Bonus +${signal.scoreBreakdown.bonus}
        </div>
      </div>

      <div class="rational-box">
        <strong>Rationale:</strong> ${signal.rationale}
      </div>

      <div class="partial-tp-plan">
        <h5>Execution Plan:</h5>
        <ul>
          <li>Reach TP1: Close 50% position, move SL to entry (breakeven).</li>
          <li>Reach TP2: Close 30% position, trail SL 1x ATR below price.</li>
          <li>Reach TP3: Close final 20% position.</li>
        </ul>
      </div>

      <div class="signal-card-actions">
        ${signal.status === 'active' ? `
          <button class="primary-btn btn-take" style="flex: 1;">
            <i class="ti ti-check"></i> Mark as Taken
          </button>
          <button class="secondary-btn btn-skip" style="padding: 8px 12px;">
            <i class="ti ti-x"></i> Skip
          </button>
        ` : `
          <button class="secondary-btn" style="flex: 1;" disabled>Logged & Closed</button>
        `}
      </div>
    </div>
  `;

  // Attach event listeners dynamically if the signal is active
  if (signal.status === 'active') {
    const cardEl = container.querySelector('.signal-card');
    
    cardEl.querySelector('.btn-take').addEventListener('click', () => {
      callbacks.onTake(signal);
    });

    cardEl.querySelector('.btn-skip').addEventListener('click', () => {
      callbacks.onSkip(signal);
    });
  }
}
