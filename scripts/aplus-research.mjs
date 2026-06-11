/**
 * A+ setup research — disciplined high-precision subset discovery.
 *
 * Method (anti-data-mining):
 *  - Feature CONDITIONS are fixed a priori from trading hypotheses (no threshold search).
 *  - Features ranked on the TRAIN period only (first 6 months).
 *  - Final combined rule (max 3 conditions) validated on the last 6 months,
 *    split into 4 sequential out-of-sample windows.
 *  - Pass bar: resolved OOS n ≥ 60, Wilson 95% LB ≥ 60%, expectancy − 0.04R fees > 0,
 *    no window < 50% win rate, no pair > 50% of trades.
 *
 * Usage: node scripts/aplus-research.mjs
 */
import { readFileSync } from 'node:fs';
import { evaluateConfig, LIVE_CONFIG } from '../engine/backtester.js';

const { meta, candidates } = JSON.parse(
  readFileSync(new URL('../backtest-results.json', import.meta.url), 'utf8'));

const span = meta.endTime - meta.simStartTime;
const trainEnd = meta.simStartTime + span * 0.5;     // first 6 months: feature ranking
const oosWindows = [0, 1, 2, 3].map(k => ({          // last 6 months: 4 sequential OOS windows
  from: trainEnd + (span * 0.5 * k) / 4,
  to: trainEnd + (span * 0.5 * (k + 1)) / 4
}));

const FEE_R = 0.04;
const months = (cands) => cands.length ? (Math.max(...cands.map(c => c.t)) - Math.min(...cands.map(c => c.t))) / (30.44 * 24 * 3600000) : 0;

function wilsonLB(wins, n, z = 1.96) {
  if (n === 0) return 0;
  const p = wins / n;
  const d = 1 + z * z / n;
  const c = p + z * z / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return (c - m) / d;
}

/** Stats for a subset at a tp target. Win rate over resolved trades; expectancy over all. */
function stats(cands, tpR) {
  const cfg = { ...LIVE_CONFIG, tpR };
  const s = evaluateConfig(cands, cfg);
  const resolved = s.wins + s.losses;
  return {
    n: s.n, resolved, wins: s.wins,
    winRate: resolved ? s.wins / resolved : 0,
    wilson: wilsonLB(s.wins, resolved),
    expR: s.expR,
    expNet: s.expR - FEE_R,
    pf: s.profitFactor,
    maxDD: s.maxDD_R,
    perMonth: months(cands) > 0 ? s.n / months(cands) : 0
  };
}

const fmt = (label, s) => ({
  rule: label, n: s.n, res: s.resolved,
  'win%': (s.winRate * 100).toFixed(1),
  'wilsonLB%': (s.wilson * 100).toFixed(1),
  'exp(R)': s.expR.toFixed(3),
  'net(R)': s.expNet.toFixed(3),
  '/mo': s.perMonth.toFixed(1)
});

/* ---- Hypothesis features: fixed conditions, each with a stated rationale ---- */
const FEATURES = {
  btcAligned:   { test: c => c.bDir === c.dir,                          why: 'alts follow BTC daily trend' },
  btcTrending:  { test: c => c.bAdx >= 25,                              why: 'BTC itself in established trend' },
  btcWkAligned: { test: c => (c.dir === 'SHORT' ? c.bWk === 'BEAR' : c.bWk === 'BULL'), why: 'BTC weekly macro agrees' },
  freshTrend:   { test: c => c.cross4h <= 12,                           why: 'early in 4H trend (≤2 days since EMA50 cross)' },
  matureTrend:  { test: c => c.cross4h > 12,                            why: 'established 4H trend (counter-hypothesis)' },
  pullback:     { test: c => c.ext4h != null && c.ext4h <= 0.5,         why: 'entry near 4H EMA50, not chasing' },
  notExtended:  { test: c => c.ext4h != null && c.ext4h <= 1.5,         why: 'price <1.5 ATR beyond 4H EMA50' },
  extended:     { test: c => c.ext4h != null && c.ext4h > 1.5,          why: 'momentum continuation (counter-hypothesis)' },
  notExt1d:     { test: c => c.ext1d != null && c.ext1d <= 3,           why: 'not overextended vs daily EMA20' },
  midVol:       { test: c => c.atrPctile >= 25 && c.atrPctile <= 75,    why: 'normal volatility regime' },
  lowVol:       { test: c => c.atrPctile <= 50,                         why: 'calm regime, cleaner trends' },
  squeeze:      { test: c => c.bbwPctile <= 30,                         why: 'BB squeeze precedes expansion' },
  rsi4hRoom:    { test: c => c.dir === 'LONG' ? c.rsi4h <= 60 : c.rsi4h >= 40, why: 'RSI has room before exhaustion' },
  rsi1hRoom:    { test: c => c.dir === 'LONG' ? c.rsi1h <= 65 : c.rsi1h >= 35, why: '1H trigger not already stretched' },
  fundAligned:  { test: c => c.dir === 'SHORT' ? c.fund >= 0 : c.fund <= 0,    why: 'crowd positioned against trade (paid to fade)' },
  euUsSession:  { test: c => c.hour >= 7 && c.hour <= 20,               why: 'liquid sessions, cleaner follow-through' },
  weekday:      { test: c => c.dow >= 1 && c.dow <= 5,                  why: 'weekend = thin books, erratic moves' }
};

// Universe = candidates passing the live base config filters (thr 77, ADX 25, etc.)
const base = candidates.filter(c =>
  c.conf >= LIVE_CONFIG.threshold && c.adx >= LIVE_CONFIG.adxMin &&
  (c.dir === 'SHORT' ? c.rsi1d <= LIVE_CONFIG.rsiGate : c.rsi1d >= 100 - LIVE_CONFIG.rsiGate) &&
  (c.dir === 'SHORT' ? c.weekly !== 'BULL' : c.weekly !== 'BEAR') &&
  (c.dir === 'LONG' ? c.fund <= 0.05 : c.fund >= -0.05)
);
const train = base.filter(c => c.t < trainEnd);
const oosAll = base.filter(c => c.t >= trainEnd);

console.log(`Universe: ${base.length} base signals (live config) | train ${train.length} | OOS ${oosAll.length}\n`);

for (const tpR of [0.8, 1.0]) {
  console.log(`=== BASELINE TP ${tpR}R — train | OOS ===`);
  console.table([
    { period: 'train', ...fmt('baseline', stats(train, tpR)) },
    { period: 'OOS', ...fmt('baseline', stats(oosAll, tpR)) }
  ]);
}

console.log('=== SINGLE-FEATURE RANKING (TRAIN period only, TP 0.8R) ===');
const ranking = Object.entries(FEATURES).map(([name, f]) => {
  const s = stats(train.filter(f.test), 0.8);
  const sBase = stats(train, 0.8);
  return { name, why: f.why, s, lift: s.winRate - sBase.winRate };
}).sort((a, b) => b.lift - a.lift);
console.table(ranking.map(r => ({
  feature: r.name, ...fmt(r.why.slice(0, 38), r.s),
  'lift%': (r.lift * 100).toFixed(1)
})));

/* ---- Combo evaluation: top hypothesis features with independent rationale ---- */
function evalRule(label, test) {
  const tr = stats(train.filter(test), 0.8);
  const oos = stats(oosAll.filter(test), 0.8);
  const windows = oosWindows.map(w => {
    const sub = oosAll.filter(test).filter(c => c.t >= w.from && c.t < w.to);
    const s = stats(sub, 0.8);
    return { n: s.n, res: s.resolved, win: s.resolved ? (s.winRate * 100).toFixed(0) : '--' };
  });
  // pair concentration on OOS
  const byPair = {};
  for (const c of oosAll.filter(test)) byPair[c.pair] = (byPair[c.pair] || 0) + 1;
  const maxPairShare = oos.n ? Math.max(0, ...Object.values(byPair)) / oos.n : 0;

  const pass = oos.resolved >= 60 && oos.wilson >= 0.60 && oos.expNet > 0 &&
    windows.every(w => w.res < 8 || parseFloat(w.win) >= 50) && maxPairShare <= 0.5;

  return { label, tr, oos, windows, maxPairShare, pass };
}

const R = [];
R.push(evalRule('A: notExtended + rsi4hRoom', c => FEATURES.notExtended.test(c) && FEATURES.rsi4hRoom.test(c)));
R.push(evalRule('B: notExtended + rsi4hRoom + btcAligned', c => FEATURES.notExtended.test(c) && FEATURES.rsi4hRoom.test(c) && FEATURES.btcAligned.test(c)));
R.push(evalRule('C: pullback + rsi4hRoom', c => FEATURES.pullback.test(c) && FEATURES.rsi4hRoom.test(c)));
R.push(evalRule('D: notExtended + midVol', c => FEATURES.notExtended.test(c) && FEATURES.midVol.test(c)));
R.push(evalRule('E: notExtended + rsi4hRoom + weekday', c => FEATURES.notExtended.test(c) && FEATURES.rsi4hRoom.test(c) && FEATURES.weekday.test(c)));
R.push(evalRule('F: btcAligned + freshTrend', c => FEATURES.btcAligned.test(c) && FEATURES.freshTrend.test(c)));
R.push(evalRule('G: notExtended + btcAligned + midVol', c => FEATURES.notExtended.test(c) && FEATURES.btcAligned.test(c) && FEATURES.midVol.test(c)));

console.log('\n=== COMBO RULES (TP 0.8R) — train then OOS + 4 windows ===');
for (const r of R) {
  console.log(`\n${r.label}  →  ${r.pass ? '✅ PASSES BAR' : '✗ fails bar'}`);
  console.table([
    { period: 'train', ...fmt(r.label, r.tr) },
    { period: 'OOS', ...fmt(r.label, r.oos) }
  ]);
  console.log('  OOS windows:', r.windows.map((w, k) => `W${k + 1}: ${w.win}% (n=${w.res})`).join('  '),
    `| max pair share ${(r.maxPairShare * 100).toFixed(0)}%`);
}
