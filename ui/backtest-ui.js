/**
 * Backtest Stats Page UI Component
 * Computes trade metrics and renders custom canvas/HTML charts.
 */

/**
 * Render Backtest Stats page
 * @param {Array<Object>} trades - List of all logged trades
 */
export function renderBacktestStats(trades) {
  // All signals fired (everything except 'active' status edge cases)
  const allSignals = trades.filter(t => t.status !== 'active');
  // All signals with an outcome: manually closed OR auto-backtested observed signals
  const evaluatedSignals = allSignals.filter(t => t.result !== null);
  // Taken trades: manually entered positions (for capture rate)
  const takenTrades = trades.filter(t => t.status === 'taken');

  // 1. Calculate Metric Cards
  const totalTaken = takenTrades.length;
  const totalSignals = allSignals.length;
  let winRate = 0;
  let avgRR = 0;
  let totalPnL = 0;

  // Wins = any evaluated signal (taken OR auto-backtested observed) with win/partial result
  const wins = evaluatedSignals.filter(t => t.result === 'win' || t.result === 'partial').length;

  if (totalSignals > 0) {
    // Effective win rate: wins ÷ ALL signals fired (unevaluated/skipped = non-wins)
    winRate = (wins / totalSignals) * 100;
  }

  if (evaluatedSignals.length > 0) {
    totalPnL = evaluatedSignals.reduce((acc, t) => acc + (t.pnlUSDT || 0), 0);

    const winningSignals = evaluatedSignals.filter(t => (t.result === 'win' || t.result === 'partial') && t.pnlUSDT > 0);
    if (winningSignals.length > 0) {
      const rrSum = winningSignals.reduce((sum, t) => {
        const risk = t.riskAmount || 60;
        return sum + (t.pnlUSDT / risk);
      }, 0);
      avgRR = rrSum / winningSignals.length;
    } else {
      avgRR = 3.0;
    }
  }

  // Capture rate = manually taken / all signals fired
  const captureRate = totalSignals > 0 ? ((totalTaken / totalSignals) * 100).toFixed(0) : 0;
  // Evaluation rate = signals with outcomes / all signals
  const evalRate = totalSignals > 0 ? ((evaluatedSignals.length / totalSignals) * 100).toFixed(0) : 0;

  // Populate Metric DOM Elements
  document.getElementById('backtest-winrate').innerText = evaluatedSignals.length > 0 ? `${winRate.toFixed(1)}%` : '--%';
  document.getElementById('backtest-avg-rr').innerText = evaluatedSignals.length > 0 ? `1 : ${avgRR.toFixed(1)}` : '1 : --';

  const pnlEl = document.getElementById('backtest-pnl');
  pnlEl.innerText = `${totalPnL >= 0 ? '+' : ''}$${totalPnL.toFixed(2)}`;
  pnlEl.className = `metric-value ${totalPnL >= 0 ? 'success-text' : 'danger-text'}`;

  const totalEl = document.getElementById('backtest-total');
  totalEl.innerText = totalSignals > 0 ? `${wins} / ${totalSignals}` : '0 / 0';
  const captureSub = document.getElementById('backtest-capture-sub');
  if (captureSub) captureSub.innerText = `${evalRate}% evaluated · ${captureRate}% taken (${evaluatedSignals.length} of ${totalSignals} signals)`;

  // 2. Render sequence dots (Last 20 all-signal history: taken+observed+skipped)
  const dotsContainer = document.getElementById('backtest-dots-container');
  if (dotsContainer) {
    const sorted = [...allSignals].sort((a, b) => (a.signalTime || 0) - (b.signalTime || 0));
    const last20 = sorted.slice(-20);
    if (last20.length === 0) {
      dotsContainer.innerHTML = `<span style="color: var(--text-muted); font-size: 12px;">No signals recorded yet.</span>`;
    } else {
      dotsContainer.innerHTML = last20.map(trade => {
        let dotClass = 'observed';
        let label = '?';
        let titleStr = `${trade.pair} ${trade.direction} — ${trade.status}`;

        if (trade.status === 'skipped') { dotClass = 'skipped'; label = '—'; }
        else if (trade.result === 'win') {
          dotClass = 'win'; label = 'W';
          titleStr += `${trade.backtestEvaluated ? ' [BT]' : ''} | +$${trade.pnlUSDT?.toFixed(2)}`;
        } else if (trade.result === 'loss') {
          dotClass = 'loss'; label = 'L';
          titleStr += `${trade.backtestEvaluated ? ' [BT]' : ''} | -$${Math.abs(trade.pnlUSDT || 0).toFixed(2)}`;
        } else if (trade.result === 'partial') {
          dotClass = 'partial'; label = 'P';
        } else if (trade.status === 'taken' && !trade.result) {
          dotClass = 'open'; label = 'O';
        }

        return `<span class="dot-stat ${dotClass}" title="${titleStr}">${label}</span>`;
      }).join('');
    }

    // Legend
    dotsContainer.innerHTML += `
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;font-size:11px;color:var(--text-muted);">
        <span><span class="dot-stat win" style="width:14px;height:14px;font-size:9px;">W</span> Win</span>
        <span><span class="dot-stat loss" style="width:14px;height:14px;font-size:9px;">L</span> Loss</span>
        <span><span class="dot-stat partial" style="width:14px;height:14px;font-size:9px;">P</span> Partial</span>
        <span><span class="dot-stat open" style="width:14px;height:14px;font-size:9px;">O</span> Open</span>
        <span><span class="dot-stat skipped" style="width:14px;height:14px;font-size:9px;">—</span> Skipped</span>
        <span><span class="dot-stat observed" style="width:14px;height:14px;font-size:9px;">?</span> Observed</span>
      </div>
    `;
  }

  // 3. Draw Equity Curve (Cumulative PnL) — all signals chronologically, observed/skipped = 0
  const allSortedForCurve = [...allSignals].sort((a, b) => (a.signalTime || 0) - (b.signalTime || 0));
  drawEquityCurve(allSortedForCurve);

  // 4. Render Confidence Score Distribution Bars (all signals, wins from evaluated)
  renderConfidenceDistribution(allSignals, evaluatedSignals);
}

/**
 * Draw custom Canvas line chart representing the equity curve.
 * Accepts ALL signals sorted by time. Observed/skipped signals have pnlUSDT = null → 0 (flat step).
 * @param {Array<Object>} allSortedSignals
 */
function drawEquityCurve(allSortedSignals) {
  const closedTrades = allSortedSignals; // renamed param — kept for internal reuse below
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
    ctx.fillText('Awaiting signals to plot equity curve.', width / 2, height / 2);
  }
}

/**
 * Render Confidence Score Distribution Chart
 * @param {Array<Object>} allSignals - All signals (observed + skipped + taken)
 * @param {Array<Object>} closedTrades - Closed taken trades (for win rate overlay)
 */
function renderConfidenceDistribution(allSignals, closedTrades) {
  const container = document.getElementById('confidence-distribution-container');
  if (!container) return;

  // Buckets: 70–74%, 75–79%, 80–84%, 85–89%, 90%+
  const buckets = [
    { label: '70–74%', min: 70, max: 74, count: 0, taken: 0, wins: 0 },
    { label: '75–79%', min: 75, max: 79, count: 0, taken: 0, wins: 0 },
    { label: '80–84%', min: 80, max: 84, count: 0, taken: 0, wins: 0 },
    { label: '85–89%', min: 85, max: 89, count: 0, taken: 0, wins: 0 },
    { label: '90%+', min: 90, max: 100, count: 0, taken: 0, wins: 0 }
  ];

  // Count all signals (observed + skipped + taken)
  allSignals.forEach(t => {
    const conf = t.confidence;
    const bucket = buckets.find(b => conf >= b.min && conf <= b.max);
    if (bucket) {
      bucket.count++;
      if (t.status === 'taken') bucket.taken++;
    }
  });

  // Win rate from closed taken trades
  closedTrades.forEach(t => {
    const conf = t.confidence;
    const bucket = buckets.find(b => conf >= b.min && conf <= b.max);
    if (bucket && (t.result === 'win' || t.result === 'partial')) {
      bucket.wins++;
    }
  });

  const maxCount = Math.max(...buckets.map(b => b.count), 1);

  container.innerHTML = buckets.map(b => {
    const widthPct = (b.count / maxCount) * 100;
    const wr = b.taken > 0 ? ((b.wins / b.taken) * 100).toFixed(0) : '—';

    let barColor = 'var(--color-conf-low)';
    if (b.min >= 90) barColor = 'var(--color-conf-high)';
    else if (b.min >= 80) barColor = 'var(--color-conf-med)';

    const takenLabel = b.count > 0 ? `${b.taken}/${b.count} taken` : '0 signals';

    return `
      <div class="dist-row">
        <span class="dist-range">${b.label}</span>
        <div class="dist-bar-track">
          <div class="dist-bar-fill" style="width: ${widthPct}%; background-color: ${barColor}"></div>
        </div>
        <span class="dist-count" title="Win Rate of taken trades: ${wr}%">${takenLabel} (WR: ${wr}%)</span>
      </div>
    `;
  }).join('');
}
