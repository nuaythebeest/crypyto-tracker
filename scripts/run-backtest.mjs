/**
 * Headless 12-month backtest runner (Node ≥ 18).
 * Usage: node scripts/run-backtest.mjs [months] [--quick]
 *   --quick: BTC only, 3 months (smoke test)
 * Writes full candidate dataset to backtest-results.json and prints the report.
 */
import { writeFileSync } from 'node:fs';
import {
  runFullBacktest, evaluateConfig, tuneConfigs, tpTradeoffTable,
  filterImpactReport, groupStats, LIVE_CONFIG
} from '../engine/backtester.js';

const quick = process.argv.includes('--quick');
const months = quick ? 3 : (parseInt(process.argv[2]) || 12);
const pairs = quick ? ['BTCUSDT'] : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];

const fmt = (s) => ({
  n: s.n, W: s.wins, L: s.losses, TO: s.timeouts,
  'win%': (s.winRate * 100).toFixed(1),
  'exp(R)': s.expR.toFixed(3),
  PF: s.profitFactor === Infinity ? 'inf' : s.profitFactor.toFixed(2),
  totR: s.totalR.toFixed(1),
  maxDD: s.maxDD_R.toFixed(1)
});

let lastStatus = '';
const onStatus = (txt) => {
  if (txt !== lastStatus) { console.log(`[bt] ${txt}`); lastStatus = txt; }
};

console.log(`Running ${months}-month backtest on ${pairs.join(', ')}…`);
const t0 = Date.now();
const { candidates, meta } = await runFullBacktest(pairs, { months, onStatus });
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(0)}s — ${candidates.length} candidates total.\n`);

writeFileSync(new URL('../backtest-results.json', import.meta.url),
  JSON.stringify({ meta, candidates }));
console.log('Dataset saved to backtest-results.json\n');

// ---- Report ----
const OLD_CONFIG = { threshold: 70, adxMin: 0, rsiGate: 100, weeklyOn: false, fundOn: true, slMult: 1.5, tpR: 1.5 };

console.log('=== ORIGINAL CONFIG (threshold 70, no filters) ===');
console.table([fmt(evaluateConfig(candidates, OLD_CONFIG))]);

console.log('=== CURRENT LIVE CONFIG (77 + all filters) ===');
console.table([fmt(evaluateConfig(candidates, LIVE_CONFIG))]);

console.log('=== PER DIRECTION (live config) ===');
console.table(groupStats(candidates, LIVE_CONFIG, c => c.dir)
  .map(g => ({ dir: g.group, ...fmt(g.stats) })));

console.log('=== PER PAIR (live config) ===');
console.table(groupStats(candidates, LIVE_CONFIG, c => c.pair)
  .map(g => ({ pair: g.group, ...fmt(g.stats) })));

console.log('=== PER CONFIDENCE BUCKET (filters on, threshold off) ===');
const bucketCfg = { ...LIVE_CONFIG, threshold: 60 };
console.table(groupStats(candidates, bucketCfg, c =>
  c.conf >= 90 ? '90+' : c.conf >= 85 ? '85-89' : c.conf >= 80 ? '80-84' : c.conf >= 75 ? '75-79' : c.conf >= 70 ? '70-74' : '60-69')
  .map(g => ({ conf: g.group, ...fmt(g.stats) })));

console.log('=== FILTER IMPACT (remove one at a time from live config) ===');
console.table(filterImpactReport(candidates, LIVE_CONFIG)
  .map(r => ({ config: r.label, ...fmt(r.stats) })));

console.log('=== TP DISTANCE TRADE-OFF (live filters, SL 1.5×ATR) ===');
console.table(tpTradeoffTable(candidates, LIVE_CONFIG)
  .map(r => ({ 'TP(R)': r.tpR, ...fmt(r) })));

console.log('=== TUNER: train (first 9mo) → holdout (last 3mo) ===');
const splitTime = meta.simStartTime + (meta.endTime - meta.simStartTime) * 0.75;
const tuned = tuneConfigs(candidates, splitTime);
console.log(`configs tested: ${tuned.configsTested}, train candidates: ${tuned.trainCount}, holdout: ${tuned.holdCount}`);
console.table(tuned.top.map(r => ({
  thr: r.cfg.threshold, adx: r.cfg.adxMin, rsi: r.cfg.rsiGate,
  wk: r.cfg.weeklyOn ? 'on' : 'off', sl: r.cfg.slMult, tp: r.cfg.tpR,
  trainN: r.train.n, 'trainWin%': (r.train.winRate * 100).toFixed(1), trainExp: r.train.expR.toFixed(3),
  holdN: r.hold.n, 'holdWin%': (r.hold.winRate * 100).toFixed(1), holdExp: r.hold.expR.toFixed(3),
  holdPF: r.hold.profitFactor === Infinity ? 'inf' : r.hold.profitFactor.toFixed(2)
})));
