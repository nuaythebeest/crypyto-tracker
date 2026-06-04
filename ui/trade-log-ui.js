/**
 * Trade Log Page UI Component
 */
import { updateTrade, loadTrades, clearTradeLog } from '../storage/trade-log.js';

let activeExitTradeId = null;

/**
 * Render the Trade Log Table
 * @param {Array<Object>} trades - All logged trades
 * @param {Object} callbacks - callbacks: { onExitConfirm, onReload, onMarkTaken }
 *   onMarkTaken(trade) — called when user clicks "Enter Trade" on an observed row
 */
export function renderTradeLogTable(trades, callbacks) {
  const tbody = document.getElementById('trade-log-tbody');
  if (!tbody) return;

  if (trades.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="14" style="text-align: center; color: var(--text-muted); padding: 32px;">
          No signals recorded yet. Signals fire automatically when confidence ≥ 70%.
        </td>
      </tr>
    `;
    return;
  }

  // Filter out skipped trades from the table to avoid clutter, or show them?
  // Let's show all trades. Sorted newest first.
  const sortedTrades = [...trades].sort((a, b) => b.signalTime - a.signalTime);

  tbody.innerHTML = sortedTrades.map(trade => {
    const isLong = trade.direction === 'LONG';
    const dateStr = new Date(trade.signalTime).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const dirClass = isLong ? 'success-text' : 'danger-text';
    
    // Result styling
    let resultText = '--';
    let pnlText = '--';
    let pnlClass = 'neutral';
    
    if (trade.result) {
      resultText = trade.result.toUpperCase();
      pnlClass = trade.result === 'win' ? 'win' : (trade.result === 'loss' ? 'loss' : 'partial');
      pnlText = `${trade.pnlUSDT >= 0 ? '+' : ''}$${trade.pnlUSDT.toFixed(2)}`;
    }

    // Action button or text
    let actionHTML = '';
    if (trade.status === 'observed') {
      actionHTML = `<button class="secondary-btn btn-enter-trade" data-id="${trade.id}" style="padding: 4px 8px; font-size: 11px; white-space: nowrap;">Enter Trade</button>`;
    } else if (trade.status === 'taken' && !trade.result) {
      actionHTML = `<button class="primary-btn btn-exit-trade" data-id="${trade.id}" style="padding: 4px 8px; font-size: 11px;">Close Trade</button>`;
    } else if (trade.status === 'skipped') {
      actionHTML = `<span style="color: var(--text-muted);">Skipped</span>`;
    } else if (trade.result) {
      actionHTML = `<span style="color: var(--text-muted); font-size: 11px;">Exit: $${trade.exitPrice.toLocaleString()}<br>${trade.notes ? '✓ Notes' : ''}</span>`;
    } else {
      actionHTML = `<span style="color: var(--text-muted);">Open Setup</span>`;
    }

    // Status formatting
    let statusClass = 'badge-grey';
    if (trade.status === 'taken') statusClass = 'badge-blue';
    else if (trade.status === 'active') statusClass = 'badge-yellow';
    else if (trade.status === 'skipped') statusClass = 'badge-grey';
    // 'observed' stays badge-grey

    const leverageDisplay = trade.leverage != null ? `${trade.leverage}x` : '--';

    return `
      <tr data-trade-id="${trade.id}" class="${trade.status === 'observed' ? 'trade-observed' : ''}">
        <td>${dateStr}</td>
        <td><strong>${trade.pair.replace('USDT', '')}</strong></td>
        <td class="${dirClass}"><strong>${trade.direction}</strong></td>
        <td>$${trade.entryPrice.toLocaleString()}</td>
        <td class="danger-text">$${trade.stopLoss.toLocaleString()}</td>
        <td>$${trade.tp1.toLocaleString()}</td>
        <td>$${trade.tp2.toLocaleString()}</td>
        <td>$${trade.tp3.toLocaleString()}</td>
        <td>${leverageDisplay}</td>
        <td>${trade.confidence}%</td>
        <td><span class="badge ${statusClass}">${trade.status.toUpperCase()}</span></td>
        <td><span class="pnl-text ${pnlClass}">${resultText}</span></td>
        <td class="pnl-text ${pnlClass}"><strong>${pnlText}</strong></td>
        <td>${actionHTML}</td>
      </tr>
    `;
  }).join('');

  // Attach exit trade event listeners
  tbody.querySelectorAll('.btn-exit-trade').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tradeId = e.target.dataset.id;
      const trade = trades.find(t => t.id === tradeId);
      if (trade) {
        openExitTradeModal(trade, callbacks.onExitConfirm);
      }
    });
  });

  // Attach "Enter Trade" button listeners for observed rows
  if (callbacks.onMarkTaken) {
    tbody.querySelectorAll('.btn-enter-trade').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tradeId = e.target.dataset.id;
        const trade = trades.find(t => t.id === tradeId);
        if (trade) callbacks.onMarkTaken(trade);
      });
    });
  }
}

/**
 * Open Exit Trade modal to record final PnL
 */
function openExitTradeModal(trade, onConfirm) {
  activeExitTradeId = trade.id;
  
  const dialog = document.getElementById('exit-trade-dialog');
  const form = document.getElementById('exit-trade-form');
  
  document.getElementById('exit-modal-pair').innerText = trade.pair;
  document.getElementById('exit-modal-entry').innerText = `$${trade.entryPrice.toLocaleString()}`;
  
  // Set default exit price input to entry price to help typing
  document.getElementById('exit-modal-price').value = trade.entryPrice;

  dialog.showModal();

  // Handle close action buttons
  const cancelBtn = form.querySelector('.secondary-btn');
  const handleCancel = () => {
    dialog.close();
    cleanup();
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const result = document.getElementById('exit-modal-result').value;
    const exitPrice = parseFloat(document.getElementById('exit-modal-price').value);
    const notes = document.getElementById('exit-modal-notes').value;

    // Run PnL math
    // PnL Long = (Exit - Entry) * PositionSize * Leverage?
    // Wait! isolated margin position sizing math:
    // PnL in USDT = (Exit - Entry) * PositionSize for LONG
    // PnL in USDT = (Entry - Exit) * PositionSize for SHORT
    const entryPrice = trade.entryPrice;
    // Calculate position size
    // Wait, the position size was recorded on the trade object
    // Wait! Let's check how position size is loaded.
    const isLong = trade.direction === 'LONG';
    const positionSize = trade.positionSize || (trade.marginUsed * trade.leverage / entryPrice);
    
    let pnlUSDT = 0;
    if (isLong) {
      pnlUSDT = (exitPrice - entryPrice) * positionSize;
    } else {
      pnlUSDT = (entryPrice - exitPrice) * positionSize;
    }

    // Apply partial profit logic multiplier if selected
    // Note: if user hit partial profit, we close 50% at TP1, 30% at TP2, 20% at TP3.
    // If they manually exited, PnL is the simple difference.
    
    // Save exit info
    const updates = {
      result,
      exitPrice,
      pnlUSDT: parseFloat(pnlUSDT.toFixed(2)),
      notes,
      status: 'taken' // keep taken status
    };

    updateTrade(activeExitTradeId, updates);
    
    dialog.close();
    cleanup();
    onConfirm(); // refresh UI
  };

  const cleanup = () => {
    cancelBtn.removeEventListener('click', handleCancel);
    form.removeEventListener('submit', handleSubmit);
  };

  cancelBtn.addEventListener('click', handleCancel);
  form.addEventListener('submit', handleSubmit);
}

/**
 * Set up Export CSV functionality
 */
export function initExportCSV(btnId) {
  const btn = document.getElementById(btnId);
  if (!btn) return;

  btn.addEventListener('click', () => {
    const trades = loadTrades();
    if (trades.length === 0) {
      alert('No trades available to export.');
      return;
    }

    // Format headers and rows
    const headers = ['Date', 'Pair', 'Direction', 'Entry Price', 'Stop Loss', 'TP1', 'TP2', 'TP3', 'Leverage', 'Confidence', 'Status', 'Result', 'PnL (USDT)', 'Notes'];
    const rows = trades.map(t => [
      new Date(t.signalTime).toISOString(),
      t.pair,
      t.direction,
      t.entryPrice,
      t.stopLoss,
      t.tp1,
      t.tp2,
      t.tp3,
      t.leverage,
      t.confidence,
      t.status,
      t.result || '--',
      t.pnlUSDT !== null ? t.pnlUSDT : '--',
      t.notes || ''
    ]);

    let csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(','), ...rows.map(e => e.map(val => `"${val}"`).join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `crypto_signal_trade_log_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link); // Required for FF
    link.click();
    document.body.removeChild(link);
  });
}
