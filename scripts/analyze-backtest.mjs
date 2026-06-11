/**
 * Deeper analysis on the saved backtest dataset (backtest-results.json).
 * Hypothesis-driven config checks with train/holdout discipline.
 */
import { readFileSync } from 'node:fs';
import { evaluateConfig, LIVE_CONFIG, tuneConfigs } from '../engine/backtester.js';

const { meta, candidates } = JSON.parse(
  readFileSync(new URL('../backtest-results.json', import.meta.url), 'utf8'));

const splitTime = meta.simStartTime + (meta.endTime - meta.simStartTime) * 0.75;
const train = candidates.filter(c => c.t < splitTime);
const hold = candidates.filter(c => c.t >= splitTime);

const fmt = (s) => ({
  n: s.n, W: s.wins, L: s.losses, TO: s.timeouts,
  'win%': (s.winRate * 100).toFixed(1),
  'exp(R)': s.expR.toFixed(3),
  PF: s.profitFactor === Infinity ? 'inf' : s.profitFactor.toFixed(2)
});

const evalSplit = (cands, cfg, sub) => {
  const subset = sub ? cands.filter(sub) : cands;
  return fmt(evaluateConfig(subset, cfg));
};

console.log('=== LIVE CONFIG: train vs holdout ===');
console.table([
  { period: 'train (9mo)', ...evalSplit(train, LIVE_CONFIG) },
  { period: 'holdout (3mo)', ...evalSplit(hold, LIVE_CONFIG) }
]);

console.log('=== TUNER SHORTLIST top 12 (ranked by train exp, holdout shown) ===');
const tuned = tuneConfigs(candidates, splitTime);
console.table(tuned.shortlist.slice(0, 12).map(r => ({
  thr: r.cfg.threshold, adx: r.cfg.adxMin, rsi: r.cfg.rsiGate,
  wk: r.cfg.weeklyOn ? 'on' : 'off', sl: r.cfg.slMult, tp: r.cfg.tpR,
  trN: r.train.n, 'trWin%': (r.train.winRate * 100).toFixed(1), trExp: r.train.expR.toFixed(3),
  hoN: r.hold.n, 'hoWin%': (r.hold.winRate * 100).toFixed(1), hoExp: r.hold.expR.toFixed(3)
})));

console.log('=== REGIME ALIGNMENT: weekly trend vs direction (live config, full period) ===');
console.table([
  { subset: 'SHORT in weekly BEAR', ...evalSplit(candidates, LIVE_CONFIG, c => c.dir === 'SHORT' && c.weekly === 'BEAR') },
  { subset: 'SHORT in weekly NEUTRAL', ...evalSplit(candidates, LIVE_CONFIG, c => c.dir === 'SHORT' && c.weekly === 'NEUTRAL') },
  { subset: 'SHORT in weekly BULL', ...evalSplit(candidates, LIVE_CONFIG, c => c.dir === 'SHORT' && c.weekly === 'BULL') },
  { subset: 'LONG in weekly BULL', ...evalSplit(candidates, LIVE_CONFIG, c => c.dir === 'LONG' && c.weekly === 'BULL') },
  { subset: 'LONG in weekly NEUTRAL', ...evalSplit(candidates, LIVE_CONFIG, c => c.dir === 'LONG' && c.weekly === 'NEUTRAL') },
  { subset: 'LONG in weekly BEAR', ...evalSplit(candidates, LIVE_CONFIG, c => c.dir === 'LONG' && c.weekly === 'BEAR') }
]);

console.log('=== MARKET MODE (live config) ===');
console.table([
  { subset: 'TRENDING', ...evalSplit(candidates, LIVE_CONFIG, c => c.mode === 'TRENDING') },
  { subset: 'TRANSITIONING', ...evalSplit(candidates, LIVE_CONFIG, c => c.mode === 'TRANSITIONING') },
  { subset: 'RANGING', ...evalSplit(candidates, LIVE_CONFIG, c => c.mode === 'RANGING') }
]);

console.log('=== BONUS SIGNALS (live config) ===');
console.table([
  { subset: 'with divergence', ...evalSplit(candidates, LIVE_CONFIG, c => !!c.div) },
  { subset: 'without divergence', ...evalSplit(candidates, LIVE_CONFIG, c => !c.div) },
  { subset: 'with BOS', ...evalSplit(candidates, LIVE_CONFIG, c => !!c.bos) },
  { subset: 'without BOS', ...evalSplit(candidates, LIVE_CONFIG, c => !c.bos) }
]);

console.log('=== ADX LEVELS at TP 1.0R (other filters live) ===');
for (const adxMin of [18, 22, 25, 30]) {
  const cfg = { ...LIVE_CONFIG, adxMin, tpR: 1.0 };
  console.log(`ADX ≥ ${adxMin}:`,
    'train', JSON.stringify(evalSplit(train, cfg)),
    '| hold', JSON.stringify(evalSplit(hold, cfg)));
}

console.log('\n=== STRICT REGIME-ALIGNED config (SHORT only weekly BEAR, LONG only weekly BULL) ===');
const alignedSub = c => (c.dir === 'SHORT' && c.weekly === 'BEAR') || (c.dir === 'LONG' && c.weekly === 'BULL');
for (const tpR of [0.8, 1.0, 1.5]) {
  const cfg = { ...LIVE_CONFIG, tpR };
  console.log(`TP ${tpR}R:`,
    'train', JSON.stringify(evalSplit(train.filter(alignedSub), cfg)),
    '| hold', JSON.stringify(evalSplit(hold.filter(alignedSub), cfg)));
}

console.log('\n=== TRENDING-ONLY + TP variants (train | holdout) ===');
const trendSub = c => c.mode === 'TRENDING';
for (const tpR of [0.8, 1.0, 1.5]) {
  const cfg = { ...LIVE_CONFIG, tpR };
  console.log(`TP ${tpR}R:`,
    'train', JSON.stringify(evalSplit(train.filter(trendSub), cfg)),
    '| hold', JSON.stringify(evalSplit(hold.filter(trendSub), cfg)));
}

console.log('\n=== TRENDING + REGIME-ALIGNED combined (train | holdout) ===');
const comboSub = c => trendSub(c) && alignedSub(c);
for (const tpR of [0.8, 1.0, 1.5]) {
  const cfg = { ...LIVE_CONFIG, tpR };
  console.log(`TP ${tpR}R:`,
    'train', JSON.stringify(evalSplit(train.filter(comboSub), cfg)),
    '| hold', JSON.stringify(evalSplit(hold.filter(comboSub), cfg)));
}
