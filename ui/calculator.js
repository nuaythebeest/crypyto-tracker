/**
 * Calculator UI component for the Right Panel
 */
import { calculatePosition } from '../risk/position-sizing.js';

let currentLeverage = 7; // Default initial leverage

/**
 * Render and initialize the position sizing calculator in the right panel
 * @param {Object} activeSignal - Active signal details if any, to pre-populate entry/SL
 * @param {Object} settings - Global settings: { accountSize, riskPercent, defaultLeverage }
 * @param {Function} onSettingsUpdate - Callback to save updated account size/risk back to storage
 */
export function initCalculator(activeSignal, settings, onSettingsUpdate) {
  const container = document.getElementById('calculator-container');
  if (!container) return;

  // Use values from settings if no user input overrides exist yet
  const accountSize = settings.accountSize || 600;
  const riskPercent = settings.riskPercent || 10;
  currentLeverage = settings.defaultLeverage || 7;

  // Grab entry and stop loss from active signal or use defaults
  const entryPrice = activeSignal ? activeSignal.entryPrice : 0;
  const stopLossPrice = activeSignal ? activeSignal.stopLoss : 0;
  const direction = activeSignal ? activeSignal.direction : 'LONG';
  const pair = activeSignal ? activeSignal.pair.replace('USDT', '') : 'BTC';

  container.innerHTML = `
    <form id="calc-form" style="display: flex; flex-direction: column; gap: 12px;">
      <div class="calc-inputs-grid">
        <div class="form-group">
          <label for="calc-acc-size">Account (USDT)</label>
          <input type="number" id="calc-acc-size" value="${accountSize}" min="50" step="50">
        </div>
        <div class="form-group">
          <label for="calc-risk-pct">Risk (%)</label>
          <input type="number" id="calc-risk-pct" value="${riskPercent}" min="1" max="20" step="1">
        </div>
      </div>
      
      <div class="form-group">
        <label>Leverage Selector</label>
        <div class="lev-toggle-buttons">
          <button type="button" class="lev-btn ${currentLeverage === 3 ? 'active' : ''}" data-lev="3">3x</button>
          <button type="button" class="lev-btn ${currentLeverage === 5 ? 'active' : ''}" data-lev="5">5x</button>
          <button type="button" class="lev-btn ${currentLeverage === 7 ? 'active' : ''}" data-lev="7">7x</button>
          <button type="button" class="lev-btn ${currentLeverage === 10 ? 'active' : ''}" data-lev="10">10x</button>
          <button type="button" class="lev-btn ${currentLeverage === 15 ? 'active' : ''}" data-lev="15">15x</button>
          <button type="button" class="lev-btn ${currentLeverage === 20 ? 'active' : ''}" data-lev="20">20x</button>
        </div>
      </div>

      <div class="calc-outputs">
        <div class="calc-row">
          <span>Risk Amount:</span>
          <strong id="calc-risk-usd">$--</strong>
        </div>
        <div class="calc-row">
          <span>Position Size:</span>
          <strong id="calc-pos-size">-- ${pair}</strong>
        </div>
        <div class="calc-row">
          <span>Notional Value:</span>
          <strong id="calc-notional">$--</strong>
        </div>
        <div class="calc-row">
          <span>Margin Required:</span>
          <strong id="calc-margin">$--</strong>
        </div>
        <div class="calc-row">
          <span>Liq Price (Isolated):</span>
          <strong id="calc-liq-price" class="danger-text">$--</strong>
        </div>
        <div class="calc-row">
          <span>Buffer to Liq:</span>
          <strong id="calc-liq-buffer">--%</strong>
        </div>
        <div class="calc-row">
          <span>SL to Liq Gap:</span>
          <strong id="calc-sl-liq-gap">--%</strong>
        </div>
      </div>

      <div id="calc-warning-container"></div>
    </form>
  `;

  // Attach event listeners
  const form = container.querySelector('#calc-form');
  const inputAccSize = form.querySelector('#calc-acc-size');
  const inputRiskPct = form.querySelector('#calc-risk-pct');
  const levButtons = form.querySelectorAll('.lev-btn');

  const recalculate = () => {
    const accSize = parseFloat(inputAccSize.value) || 50;
    const rPct = parseFloat(inputRiskPct.value) || 1;

    // Trigger settings update callback so main state knows settings changed
    onSettingsUpdate({
      accountSize: accSize,
      riskPercent: rPct,
      defaultLeverage: currentLeverage
    });

    if (entryPrice <= 0 || stopLossPrice <= 0) {
      // Clear outputs if no active signal is set
      form.querySelector('#calc-risk-usd').innerText = `$${(accSize * (rPct / 100)).toFixed(2)}`;
      form.querySelector('#calc-pos-size').innerText = `-- ${pair}`;
      form.querySelector('#calc-notional').innerText = `$--`;
      form.querySelector('#calc-margin').innerText = `$--`;
      form.querySelector('#calc-liq-price').innerText = `$--`;
      form.querySelector('#calc-liq-buffer').innerText = `--%`;
      form.querySelector('#calc-sl-liq-gap').innerText = `--%`;
      form.querySelector('#calc-warning-container').innerHTML = `
        <div class="warning-banner" style="background-color: var(--color-info-muted); border-color: hsla(210, 85%, 55%, 0.3); color: var(--color-info);">
          <i class="ti ti-info-circle"></i>
          <span>No active signal. Previewing risk size based on default settings.</span>
        </div>
      `;
      return;
    }

    // Run position sizing math
    const result = calculatePosition({
      accountSize: accSize,
      riskPercent: rPct,
      leverage: currentLeverage,
      entryPrice,
      stopLossPrice,
      direction
    });

    // Populate UI outputs
    form.querySelector('#calc-risk-usd').innerText = `$${result.riskAmount.toFixed(2)}`;
    form.querySelector('#calc-pos-size').innerText = `${result.positionSize} ${pair}`;
    form.querySelector('#calc-notional').innerText = `$${result.notionalValue.toLocaleString()}`;
    form.querySelector('#calc-margin').innerText = `$${result.marginRequired.toLocaleString()}`;
    
    form.querySelector('#calc-liq-price').innerText = `$${result.liquidationPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    
    // Color code liquidation buffer
    const bufferEl = form.querySelector('#calc-liq-buffer');
    bufferEl.innerText = `${result.bufferToLiqPct}%`;
    if (result.bufferStatus === 'Dangerous') {
      bufferEl.className = 'danger-text';
    } else if (result.bufferStatus === 'Caution') {
      bufferEl.className = 'warning-text'; // custom yellow or warning color
      bufferEl.style.color = 'var(--color-warning)';
    } else {
      bufferEl.className = 'success-text';
    }

    // SL to Liq gap
    const gapEl = form.querySelector('#calc-sl-liq-gap');
    gapEl.innerText = `${result.slToLiqBuffer}%`;
    if (result.isSLSafe) {
      gapEl.className = 'success-text';
    } else {
      gapEl.className = 'danger-text';
    }

    // Mark leverage buttons above the safe limit
    levButtons.forEach(btn => {
      const lev = parseInt(btn.dataset.lev);
      btn.classList.toggle('lev-unsafe', lev > result.maxSafeLeverage);
    });

    // Warning Banner rendering
    let warningHTML = '';

    if (result.isMarginWarning) {
      warningHTML += `
        <div class="warning-banner">
          <i class="ti ti-alert-triangle"></i>
          <span>Position too large — margin required exceeds 50% of account. Reduce risk or leverage!</span>
        </div>
      `;
    }

    if (!result.isSLSafe) {
      warningHTML += `
        <div class="warning-banner">
          <i class="ti ti-alert-octagon"></i>
          <span>⛔ LIQUIDATION RISK: at ${currentLeverage}x, price can liquidate you before the stop loss fires. Max safe leverage for this setup: <strong>${result.maxSafeLeverage}x</strong>.</span>
        </div>
      `;
    } else if (currentLeverage > 10) {
      warningHTML += `
        <div class="warning-banner">
          <i class="ti ti-alert-circle"></i>
          <span>High leverage warning: Isolated margin risk of complete position wipeout.</span>
        </div>
      `;
    }

    form.querySelector('#calc-warning-container').innerHTML = warningHTML;
  };

  // Bind leverage buttons
  levButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      levButtons.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentLeverage = parseInt(e.target.dataset.lev);
      recalculate();
    });
  });

  // Bind inputs events
  inputAccSize.addEventListener('input', recalculate);
  inputRiskPct.addEventListener('input', recalculate);

  // Initial calculation run
  recalculate();
}

/**
 * Get active leverage selected in calculator UI
 * @returns {number}
 */
export function getCalculatorLeverage() {
  return currentLeverage;
}
