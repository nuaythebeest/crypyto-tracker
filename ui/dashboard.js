/**
 * Dashboard UI Component orchestrator
 * Renders pair tabs, watchlist items, and indicator badge strips.
 */

/**
 * Render pair tabs in the topbar
 * @param {Array<string>} pairs - List of default/selected pairs
 * @param {string} activePair - Active selected pair
 * @param {Object} tickerPrices - Current prices: { BTCUSDT: { price, changePct } }
 * @param {Function} onSelect - Callback when tab clicked
 */
export function renderPairTabs(pairs, activePair, tickerPrices, onSelect) {
  const container = document.getElementById('pair-tabs');
  if (!container) return;

  container.innerHTML = '';

  pairs.forEach(pair => {
    const data = tickerPrices[pair] || { price: 0, changePct: 0 };
    const priceStr = data.price > 0 ? `$${data.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : 'Loading...';
    
    const pctStr = data.changePct >= 0 ? `+${data.changePct.toFixed(2)}%` : `${data.changePct.toFixed(2)}%`;
    const pctClass = data.changePct >= 0 ? 'badge-green' : 'badge-red';
    const isActive = pair === activePair;

    const tabButton = document.createElement('button');
    tabButton.className = `pair-tab ${isActive ? 'active' : ''}`;
    tabButton.innerHTML = `
      <span>${pair.replace('USDT', '')}</span>
      <span class="tab-price">${priceStr}</span>
      <span class="tab-pct ${pctClass}">${pctStr}</span>
    `;

    tabButton.addEventListener('click', () => onSelect(pair));
    container.appendChild(tabButton);
  });
}

/**
 * Render watchlist in sidebar
 */
export function renderWatchlist(pairs, activePair, tickerPrices, onSelect) {
  const container = document.getElementById('watchlist-container');
  if (!container) return;

  container.innerHTML = '';

  pairs.forEach(pair => {
    const data = tickerPrices[pair] || { price: 0, changePct: 0 };
    const priceStr = data.price > 0 ? `$${data.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--';
    const pctStr = data.changePct >= 0 ? `+${data.changePct.toFixed(2)}%` : `${data.changePct.toFixed(2)}%`;
    const pctClass = data.changePct >= 0 ? 'badge-green' : 'badge-red';
    const isActive = pair === activePair;

    const row = document.createElement('div');
    row.className = `watchlist-row ${isActive ? 'active' : ''}`;
    row.innerHTML = `
      <span class="watchlist-name">${pair.replace('USDT', '')}/USDT</span>
      <div class="watchlist-val-group">
        <span class="watchlist-price">${priceStr}</span>
        <span class="watchlist-change badge ${pctClass}">${pctStr}</span>
      </div>
    `;

    row.addEventListener('click', () => onSelect(pair));
    container.appendChild(row);
  });
}

/**
 * Render indicators badge strip based on the latest signal engine analysis values
 * @param {Object} analysis - The results object from evaluateMarket()
 */
export function renderIndicatorBadges(analysis) {
  const container = document.getElementById('indicator-badges-strip');
  if (!container) return;

  container.innerHTML = '';
  if (!analysis || !analysis.indicatorValues) return;

  const iv = analysis.indicatorValues;
  const isNeutral = analysis.dailyDirection === 'CONFLICT' || analysis.fourHDirection === 'CONFLICT';
  const primaryTrend = analysis.isTrendAligned ? analysis.dailyDirection : 'NEUTRAL';

  // Helper to create badge element
  const createBadge = (text, typeClass) => {
    const badge = document.createElement('span');
    badge.className = `indicator-badge ${typeClass}`;
    badge.innerText = text;
    return badge;
  };

  // 1. ADX Trend strength badge
  let adxText = `ADX: ${Math.round(iv.adx4h)} — `;
  let adxClass = 'badge-grey';
  if (iv.adx4h > 25) {
    adxText += 'Strong Trend';
    adxClass = 'badge-blue';
  } else if (iv.adx4h < 20) {
    adxText += 'Ranging';
    adxClass = 'badge-yellow';
  } else {
    adxText += 'Transitioning';
  }
  container.appendChild(createBadge(adxText, adxClass));

  // 2. Daily EMA 200 badge
  const dailyPriceEma = analysis.currPrice > iv.ema200_1d;
  const dailyEmaText = dailyPriceEma ? '1D Close > EMA 200 (Bullish)' : '1D Close < EMA 200 (Bearish)';
  container.appendChild(createBadge(dailyEmaText, dailyPriceEma ? 'badge-green' : 'badge-red'));

  // 3. Daily EMA Cross
  const dailyEMA20_50 = iv.ema20_1d > iv.ema50_1d;
  const dailyCrossText = dailyEMA20_50 ? 'Daily EMA 20/50 Cross: LONG' : 'Daily EMA 20/50 Cross: SHORT';
  container.appendChild(createBadge(dailyCrossText, dailyEMA20_50 ? 'badge-green' : 'badge-red'));

  // 4. Daily RSI value
  let rsi1dClass = 'badge-grey';
  if (iv.rsi1d >= 70) rsi1dClass = 'badge-red'; // overbought
  else if (iv.rsi1d <= 30) rsi1dClass = 'badge-green'; // oversold
  else if (iv.rsi1d >= 50) rsi1dClass = 'badge-green'; // neutral bullish
  container.appendChild(createBadge(`RSI 1D: ${Math.round(iv.rsi1d)}`, rsi1dClass));

  // 5. 4H EMA 50
  const fourHPriceEma = analysis.currPrice > iv.ema50_4h;
  container.appendChild(createBadge(
    fourHPriceEma ? '4H Close > EMA 50 (Bullish)' : '4H Close < EMA 50 (Bearish)',
    fourHPriceEma ? 'badge-green' : 'badge-red'
  ));

  // 6. 4H MACD histogram
  const macdIncreasing = iv.macdHist4h > 0; // standard indicator, simplified here
  container.appendChild(createBadge(
    macdIncreasing ? '4H MACD Hist: Increasing' : '4H MACD Hist: Decreasing',
    macdIncreasing ? 'badge-green' : 'badge-red'
  ));

  // 7. 4H RSI
  let rsi4hClass = 'badge-grey';
  if (iv.rsi4h >= 65) rsi4hClass = 'badge-red';
  else if (iv.rsi4h <= 35) rsi4hClass = 'badge-green';
  container.appendChild(createBadge(`RSI 4H: ${Math.round(iv.rsi4h)}`, rsi4hClass));

  // 8. 1H RSI
  let rsi1hClass = 'badge-grey';
  if (iv.rsi1h >= 50) rsi1hClass = 'badge-green';
  container.appendChild(createBadge(`RSI 1H: ${Math.round(iv.rsi1h)}`, rsi1hClass));

  // 9. Divergence (if any)
  if (analysis.signal && analysis.signal.indicators.divergence) {
    const div = analysis.signal.indicators.divergence;
    container.appendChild(createBadge(
      div === 'bullish' ? 'Bullish RSI Divergence (+10)' : 'Bearish RSI Divergence (+10)',
      div === 'bullish' ? 'badge-green' : 'badge-red'
    ));
  }

  // 10. BOS (if any)
  if (analysis.signal && analysis.signal.indicators.bos) {
    const bosType = analysis.signal.indicators.bos;
    container.appendChild(createBadge(
      bosType === 'bullish' ? 'Bullish BOS (+8)' : 'Bearish BOS (+8)',
      bosType === 'bullish' ? 'badge-green' : 'badge-red'
    ));
  }

  // 11. Funding rate
  const fundingRate = analysis.fundingRatePct;
  let fundClass = 'badge-green';
  if (Math.abs(fundingRate) > 0.05) {
    fundClass = 'badge-red'; // extreme
  } else if (Math.abs(fundingRate) > 0.03) {
    fundClass = 'badge-yellow'; // caution
  }
  container.appendChild(createBadge(`Funding Rate: ${fundingRate.toFixed(4)}%`, fundClass));
}

/**
 * Set Connection Status Label & Color
 */
export function setConnectionStatus(connected) {
  const dot = document.getElementById('status-dot');
  const label = document.getElementById('status-label');
  if (!dot || !label) return;

  if (connected) {
    dot.className = 'status-dot connected';
    label.innerText = 'Live Connected';
  } else {
    dot.className = 'status-dot disconnected';
    label.innerText = 'Disconnected';
  }
}
