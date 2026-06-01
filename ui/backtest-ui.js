/**
 * Backtest Stats Page UI Component
 * Computes trade metrics and renders custom canvas/HTML charts.
 */

/**
 * Render Backtest Stats page
 * @param {Array<Object>} trades - List of all logged trades
 */
export function renderBacktestStats(trades) {
  // Filter for closed trades (trades with a result logged)
  const closedTrades = trades.filter(t => t.result !== null && t.status !== 'skipped');
  
  // 1. Calculate Metric Cards
  const totalClosed = closedTrades.length;
  let winRate = 0;
  let avgRR = 0;
  let totalPnL = 0;

  if (totalClosed > 0) {
    const wins = closedTrades.filter(t => t.result === 'win' || t.result === 'partial').length;
    winRate = (wins / totalClosed) * 100;
    
    totalPnL = closedTrades.reduce((acc, t) => acc + (t.pnlUSDT || 0), 0);
    
    // Realized R:R calculation (average of wins PnL / riskAmount)
    let winningTrades = closedTrades.filter(t => (t.result === 'win' || t.result === 'partial') && t.pnlUSDT > 0);
    if (winningTrades.length > 0) {
      const rrSum = winningTrades.reduce((sum, t) => {
        const risk = t.riskAmount || 60; // fallback default
        return sum + (t.pnlUSDT / risk);
      }, 0);
      avgRR = rrSum / winningTrades.length;
    } else {
      avgRR = 3.0; // default R:R
    }
  }

  // Populate Metric DOM Elements
  document.getElementById('backtest-winrate').innerText = totalClosed > 0 ? `${winRate.toFixed(1)}%` : '--%';
  document.getElementById('backtest-avg-rr').innerText = totalClosed > 0 ? `1 : ${avgRR.toFixed(1)}` : '1 : --';
  
  const pnlEl = document.getElementById('backtest-pnl');
  pnlEl.innerText = `${totalPnL >= 0 ? '+' : ''}$${totalPnL.toFixed(2)}`;
  pnlEl.className = `metric-value ${totalPnL >= 0 ? 'success-text' : 'danger-text'}`;
  
  document.getElementById('backtest-total').innerText = totalClosed;

  // 2. Render Win/Loss dots (Last 20 trades)
  const dotsContainer = document.getElementById('backtest-dots-container');
  if (dotsContainer) {
    const last20 = closedTrades.slice(-20); // last 20 sorted oldest to newest
    if (last20.length === 0) {
      dotsContainer.innerHTML = `<span style="color: var(--text-muted); font-size: 12px;">No closed trades yet.</span>`;
    } else {
      dotsContainer.innerHTML = last20.map(trade => {
        let dotClass = 'open';
        let label = 'O';
        if (trade.result === 'win') { dotClass = 'win'; label = 'W'; }
        else if (trade.result === 'loss') { dotClass = 'loss'; label = 'L'; }
        else if (trade.result === 'partial') { dotClass = 'partial'; label = 'P'; }

        return `<span class="dot-stat ${dotClass}" title="${trade.pair} ${trade.direction} exit $${trade.exitPrice}">${label}</span>`;
      }).join('');
    }
  }

  // 3. Draw Equity Curve (Cumulative PnL) via Custom HTML Canvas
  drawEquityCurve(closedTrades);

  // 4. Render Confidence Score Distribution Bars
  renderConfidenceDistribution(trades);
}

/**
 * Draw custom Canvas line chart representing the equity curve
 * @param {Array<Object>} closedTrades 
 */
function drawEquityCurve(closedTrades) {
  const container = document.getElementById('equity-chart-container');
  if (!container) return;

  // Clear previous canvas
  container.innerHTML = '';

  const canvas = document.createElement('canvas');
  canvas.width = container.clientWidth * window.devicePixelRatio;
  canvas.height = 250 * window.devicePixelRatio;
  canvas.style.width = '100%';
  canvas.style.height = '250px';
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  const width = container.clientWidth;
  const height = 250;
  const padding = { top: 20, right: 30, bottom: 30, left: 50 };

  // Calculate cumulative PnL series starting at 0
  const data = [0];
  let currentPnL = 0;
  closedTrades.forEach(t => {
    currentPnL += t.pnlUSDT || 0;
    data.push(currentPnL);
  });

  const numPoints = data.length;
  const minVal = Math.min(0, ...data);
  const maxVal = Math.max(0, ...data);
  const valRange = maxVal - minVal || 10; // prevent divide-by-zero

  // Draw background grid lines
  ctx.strokeStyle = 'hsl(222, 15%, 15%)';
  ctx.lineWidth = 1;
  
  // Y-axis grid lines (3 divisions)
  for (let i = 0; i <= 4; i++) {
    const yVal = minVal + (valRange * (i / 4));
    const yPos = padding.top + (height - padding.top - padding.bottom) * (1 - (i / 4));
    
    ctx.beginPath();
    ctx.moveTo(padding.left, yPos);
    ctx.lineTo(width - padding.right, yPos);
    ctx.stroke();

    // Draw Y label
    ctx.fillStyle = 'hsl(220, 10%, 48%)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`$${yVal.toFixed(0)}`, padding.left - 8, yPos + 3);
  }

  // Draw data line
  if (numPoints > 1) {
    const getX = (index) => padding.left + (width - padding.left - padding.right) * (index / (numPoints - 1));
    const getY = (value) => padding.top + (height - padding.top - padding.bottom) * (1 - (value - minVal) / valRange);

    // Draw area under curve gradient
    const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.25)'); // Info blue transparent
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0.0)');

    ctx.beginPath();
    ctx.moveTo(getX(0), getY(data[0]));
    for (let i = 1; i < numPoints; i++) {
      ctx.lineTo(getX(i), getY(data[i]));
    }
    ctx.lineTo(getX(numPoints - 1), getY(minVal));
    ctx.lineTo(getX(0), getY(minVal));
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw stroke line
    ctx.strokeStyle = 'hsl(210, 85%, 55%)'; // Info blue
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(data[0]));
    for (let i = 1; i < numPoints; i++) {
      ctx.lineTo(getX(i), getY(data[i]));
    }
    ctx.stroke();

    // Draw zero baseline
    if (minVal < 0) {
      const zeroY = getY(0);
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)'; // red dotted baseline
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padding.left, zeroY);
      ctx.lineTo(width - padding.right, zeroY);
      ctx.stroke();
      ctx.setLineDash([]); // reset
    }

    // Draw data points markers
    ctx.fillStyle = 'hsl(210, 85%, 55%)';
    for (let i = 0; i < numPoints; i++) {
      ctx.beginPath();
      ctx.arc(getX(i), getY(data[i]), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Draw placeholder text if no data points
    ctx.fillStyle = 'hsl(220, 10%, 48%)';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Awaiting trade logs to plot equity curve.', width / 2, height / 2);
  }
}

/**
 * Render Confidence Score Distribution Chart
 * @param {Array<Object>} trades 
 */
function renderConfidenceDistribution(trades) {
  const container = document.getElementById('confidence-distribution-container');
  if (!container) return;

  // Buckets: 70–74%, 75–79%, 80–84%, 85–89%, 90%+
  const buckets = [
    { label: '70–74%', min: 70, max: 74, count: 0, wins: 0 },
    { label: '75–79%', min: 75, max: 79, count: 0, wins: 0 },
    { label: '80–84%', min: 80, max: 84, count: 0, wins: 0 },
    { label: '85–89%', min: 85, max: 89, count: 0, wins: 0 },
    { label: '90%+', min: 90, max: 100, count: 0, wins: 0 }
  ];

  // Populate counts from trade logs
  trades.forEach(t => {
    if (t.status === 'skipped') return; // only taken / active
    const conf = t.confidence;
    const bucket = buckets.find(b => conf >= b.min && conf <= b.max);
    if (bucket) {
      bucket.count++;
      if (t.result === 'win' || t.result === 'partial') {
        bucket.wins++;
      }
    }
  });

  const maxCount = Math.max(...buckets.map(b => b.count), 1); // prevent divide-by-zero

  container.innerHTML = buckets.map(b => {
    const widthPct = (b.count / maxCount) * 100;
    const wr = b.count > 0 ? ((b.wins / b.count) * 100).toFixed(0) : 0;
    
    // Choose theme color for bar
    let barColor = 'var(--color-conf-low)';
    if (b.min >= 90) barColor = 'var(--color-conf-high)';
    else if (b.min >= 80) barColor = 'var(--color-conf-med)';

    return `
      <div class="dist-row">
        <span class="dist-range">${b.label}</span>
        <div class="dist-bar-track">
          <div class="dist-bar-fill" style="width: ${widthPct}%; background-color: ${barColor}"></div>
        </div>
        <span class="dist-count" title="Win Rate: ${wr}%">${b.count} (${wr}%)</span>
      </div>
    `;
  }).join('');
}
