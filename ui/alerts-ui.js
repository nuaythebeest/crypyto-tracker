/**
 * Alerts UI Feed Renderer
 */

/**
 * Format timestamps into human-readable local time
 * @param {number} timestamp - timestamp in ms
 */
function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Render Alerts Feed in the Right Panel
 * @param {Array<Object>} alerts - List of alerts
 */
export function renderAlertsFeed(alerts) {
  const container = document.getElementById('alerts-container');
  if (!container) return;

  if (alerts.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 24px; font-size: 12px;">
        No alerts triggered yet.
      </div>
    `;
    return;
  }

  container.innerHTML = alerts.map(alert => {
    let dotClass = 'info';
    if (alert.type === 'bullish') dotClass = 'bullish';
    else if (alert.type === 'bearish') dotClass = 'bearish';
    else if (alert.type === 'warning') dotClass = 'caution';

    return `
      <div class="alert-feed-item">
        <span class="alert-dot ${dotClass}"></span>
        <div class="alert-body">
          <span class="alert-text">${alert.text}</span>
          <span class="alert-time">${formatTime(alert.createdAt)}</span>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Render Alerts list inside the Topbar Popover
 * @param {Array<Object>} alerts 
 */
export function renderAlertsPopover(alerts) {
  const container = document.getElementById('popover-alerts-container');
  if (!container) return;

  if (alerts.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 16px; font-size: 11px;">
        No notifications.
      </div>
    `;
    return;
  }

  container.innerHTML = alerts.map(alert => {
    let dotClass = 'info';
    if (alert.type === 'bullish') dotClass = 'bullish';
    else if (alert.type === 'bearish') dotClass = 'bearish';
    else if (alert.type === 'warning') dotClass = 'caution';

    return `
      <div class="alert-feed-item" style="border: none; border-bottom: 1px solid var(--border-color); border-radius: 0; background: transparent; padding: 6px 0;">
        <span class="alert-dot ${dotClass}" style="margin-top: 4px;"></span>
        <div class="alert-body">
          <span class="alert-text" style="color: var(--text-primary); font-size: 11px;">${alert.text}</span>
          <span class="alert-time" style="font-size: 8px;">${formatTime(alert.createdAt)}</span>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Update the Topbar Notification Bell Badge
 * @param {number} count - Unread alerts count
 */
export function updateAlertBadge(count) {
  const badge = document.getElementById('alert-badge');
  if (!badge) return;

  if (count > 0) {
    badge.innerText = count > 9 ? '9+' : count;
    badge.classList.remove('hidden');
  } else {
    badge.innerText = '0';
    badge.classList.add('hidden');
  }
}

/**
 * Play Browser Notification Sound
 */
export function playAlertSound() {
  const audio = document.getElementById('signal-sound');
  if (audio) {
    audio.currentTime = 0;
    audio.play().catch(e => console.warn('Audio play blocked by browser autoplay policy:', e));
  }
}
