/**
 * Engine Historical Backtest UI — runs the bar-by-bar simulator in the browser
 * and renders the full report (overall stats, breakdowns, filter impact,
 * TP trade-off, tuned configs). Last report persists to localStorage.
 */
import {
  runFullBacktest, evaluateConfig, tuneConfigs, tpTradeoffTable,
  filterImpactReport, groupStats, LIVE_CONFIG
} from '../engine/backtester.js';

const REPORT_KEY = 'crypto_signal_tracker_engine_backtest';

/**
 * Wire the Run button. @param {Function} getPairs - returns configured pairs array
 */
export function initEngineBacktest(getPairs) {
  const btn = document.getElementById('run-engine-backtest-btn');
  const statusEl = document.getElementById('engine-backtest-status');
  const reportEl = document.getElementById('engine-backtest-report');
  if (!btn || !reportEl) return;

  // Restore last saved report
  try {
    const saved = localStorage.getItem(REPORT_KEY);
    if (saved) renderReport(reportEl, JSON.parse(saved));
  } catch (e) { /* corrupt report — ignore */ }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.innerHTML = '<i class="ti ti-loader"></i> Running…';
    try {
      const pairs = getPairs();
      const { candidates, meta } = await runFullBacktest(pairs, {
        months: 12,
        onStatus: (t) => { if (statusEl) statusEl.innerText = t; }
      });
      if (statusEl) statusEl.innerText = `Analyzing ${candidates.length} candidates…`;
      const report = buildReport(candidates, meta);
      try { localStorage.setItem(REPORT_KEY, JSON.stringify(report)); } catch (e) { /* quota */ }
      renderReport(reportEl, report);
      if (statusEl) statusEl.innerText = `Done — ${candidates.length} signals simulated over ${meta.months} months.`;
    } catch (e) {
      if (statusEl) statusEl.innerText = `Failed: ${e.message}`;
      console.error('Engine backtest failed:', e);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-player-play"></i> Run 12-Month Simulation';
    }
  });
}

/** Compute every report table into one serializable object. */
function buildReport(candidates, meta) {
  const splitTime = meta.simStartTime + (meta.endTime - meta.simStartTime) * 0.75;
  const tuned = tuneConfigs(candidates, splitTime);
  const bucketCfg = { ...LIVE_CONFIG, threshold: 60 };

  return {
    generatedAt: Date.now(),
    months: meta.months,
    pairs: meta.pairs,
    totalCandidates: candidates.length,
    live: evaluateConfig(candidates, LIVE_CONFIG),
    liveConfig: LIVE_CONFIG,
    byDirection: groupStats(candidates, LIVE_CONFIG, c => c.dir)
      .map(g => ({ label: g.group, ...g.stats })),
    byPair: groupStats(candidates, LIVE_CONFIG, c => c.pair)
      .map(g => ({ label: g.group, ...g.stats })),
    byConfidence: groupStats(candidates, bucketCfg, c =>
      c.conf >= 90 ? '90+' : c.conf >= 85 ? '85-89' : c.conf >= 80 ? '80-84'
        : c.conf >= 75 ? '75-79' : c.conf >= 70 ? '70-74' : '60-69')
      .map(g => ({ label: g.group, ...g.stats }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    filterImpact: filterImpactReport(candidates, LIVE_CONFIG)
      .map(r => ({ label: r.label, ...r.stats })),
    tpTradeoff: tpTradeoffTable(candidates, LIVE_CONFIG)
      .map(r => ({ label: `${r.tpR}R`, ...r })),
    tunedTop: tuned.top.map(r => ({
      label: `thr ${r.cfg.threshold} · ADX ${r.cfg.adxMin} · RSI ${r.cfg.rsiGate === 100 ? 'off' : r.cfg.rsiGate} · wk ${r.cfg.weeklyOn ? 'on' : 'off'} · SL ${r.cfg.slMult}× · TP ${r.cfg.tpR}R`,
      cfg: r.cfg, train: r.train, hold: r.hold
    })),
    trainCount: tuned.trainCount,
    holdCount: tuned.holdCount
  };
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const num = (x, d = 2) => x === Infinity ? '∞' : Number(x).toFixed(d);

function statsRow(label, s) {
  const expClass = s.expR > 0 ? 'success-text' : 'danger-text';
  return `<tr>
    <td>${label}</td>
    <td>${s.n}</td>
    <td>${s.wins}W / ${s.losses}L / ${s.timeouts}T</td>
    <td><strong>${pct(s.winRate)}</strong></td>
    <td class="${expClass}"><strong>${num(s.expR, 3)}R</strong></td>
    <td>${num(s.profitFactor)}</td>
    <td>${num(s.totalR, 1)}R</td>
    <td>${num(s.maxDD_R, 1)}R</td>
  </tr>`;
}

function statsTable(title, rows) {
  return `
    <h4 style="margin:16px 0 8px;">${title}</h4>
    <div style="overflow-x:auto;">
    <table class="data-table" style="font-size:12px;">
      <thead><tr>
        <th></th><th>Signals</th><th>W/L/Timeout</th><th>Win Rate</th>
        <th>Expectancy</th><th>Profit Factor</th><th>Total R</th><th>Max DD</th>
      </tr></thead>
      <tbody>${rows.map(r => statsRow(r.label, r)).join('')}</tbody>
    </table>
    </div>`;
}

function renderReport(container, rpt) {
  const dt = new Date(rpt.generatedAt).toLocaleString();
  container.innerHTML = `
    <div style="margin-top:12px;font-size:12px;color:var(--text-muted);">
      Generated ${dt} · ${rpt.months} months · ${rpt.pairs.join(', ')} ·
      ${rpt.totalCandidates} candidate signals (score ≥ 60) ·
      Win = TP hit before SL within 48H · R = risk unit (distance to SL)
    </div>

    ${statsTable('Current Live Config', [{ label: `thr ${rpt.liveConfig.threshold} · all filters · SL ${rpt.liveConfig.slMult}× · TP ${rpt.liveConfig.tpR}R`, ...rpt.live }])}
    ${statsTable('By Direction', rpt.byDirection)}
    ${statsTable('By Pair', rpt.byPair)}
    ${statsTable('By Confidence Bucket (filters on, threshold off)', rpt.byConfidence)}
    ${statsTable('Filter Impact (one removed at a time)', rpt.filterImpact)}
    ${statsTable('TP Distance Trade-off (closer TP → higher win rate, smaller wins)', rpt.tpTradeoff)}

    <h4 style="margin:16px 0 8px;">Top Tuned Configs (trained on first 9 months, validated on last 3)</h4>
    <div style="overflow-x:auto;">
    <table class="data-table" style="font-size:12px;">
      <thead><tr>
        <th>Config</th><th>Train N</th><th>Train Win</th><th>Train Exp</th>
        <th>Holdout N</th><th>Holdout Win</th><th>Holdout Exp</th><th>Holdout PF</th>
      </tr></thead>
      <tbody>
        ${rpt.tunedTop.length === 0
          ? '<tr><td colspan="8" style="color:var(--text-muted);">No config passed validation (insufficient sample or negative holdout expectancy).</td></tr>'
          : rpt.tunedTop.map(r => `<tr>
              <td>${r.label}</td>
              <td>${r.train.n}</td><td>${pct(r.train.winRate)}</td><td>${num(r.train.expR, 3)}R</td>
              <td>${r.hold.n}</td><td><strong>${pct(r.hold.winRate)}</strong></td>
              <td class="${r.hold.expR > 0 ? 'success-text' : 'danger-text'}"><strong>${num(r.hold.expR, 3)}R</strong></td>
              <td>${num(r.hold.profitFactor)}</td>
            </tr>`).join('')}
      </tbody>
    </table>
    </div>`;
}
