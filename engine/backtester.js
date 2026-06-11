/**
 * Historical Backtester — replays the live signal engine bar-by-bar over historical
 * Binance klines with NO lookahead: at every simulated 1H bar close, the engine sees
 * exactly the trailing 200 candles per timeframe (completed candles + an aggregated
 * partial candle for 4H/1D/1W), mirroring what the live app sees at that moment.
 *
 * Candidates are generated in candidateMode (score ≥ 60, hard blocks recorded but not
 * applied) so filter effectiveness can be measured post-hoc. Every candidate is graded
 * against a grid of SL-multiplier × TP-distance combinations by walking forward to the
 * first TP/SL touch (conservative: if both touch within one candle, it counts as a loss).
 *
 * Works in both browser and Node (no DOM access; progress via callback).
 */

import { analyzeMarket } from './signal-engine.js';

const SPOT_BASE = 'https://api.binance.com/api/v3';
const FUT_BASE = 'https://fapi.binance.com/fapi/v1';

const H1 = 3600000;
const INTERVAL_MS = { '1h': H1, '4h': 4 * H1, '1d': 24 * H1, '1w': 7 * 24 * H1 };

// Outcome grid axes — graded for every candidate in a single walk-forward pass
export const SL_MULTS = [1.0, 1.5, 2.0];          // × ATR(14) on 4H
export const TP_RS = [0.8, 1.0, 1.5, 2.0, 3.0];   // × SL distance (R-multiple targets)

// The configuration currently live in signal-engine.js + app.js
// (tuned 2026-06 from 12-month backtest: ADX 18→25, TP1 1.5R→1.0R — see CHANGE.md)
export const LIVE_CONFIG = {
  threshold: 77,
  adxMin: 25,
  rsiGate: 58,      // SHORT blocked if daily RSI > 58; LONG blocked if < 42 (symmetric)
  weeklyOn: true,   // weekly EMA20 macro filter
  fundOn: true,     // funding-rate extreme filter
  slMult: 1.5,
  tpR: 1.0
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function mapKline(c) {
  return [parseInt(c[0]), parseFloat(c[1]), parseFloat(c[2]), parseFloat(c[3]),
          parseFloat(c[4]), parseFloat(c[5]), parseInt(c[6])];
}

/**
 * Fetch klines page-by-page across an arbitrary time range (Binance caps 1000/request).
 */
export async function fetchKlinesPaged(symbol, interval, startTime, endTime, onProgress) {
  const out = [];
  let cursor = startTime;
  while (cursor < endTime) {
    const url = `${SPOT_BASE}/klines?symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${endTime}&limit=1000`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`klines ${symbol} ${interval}: HTTP ${res.status}`);
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const c of batch) out.push(mapKline(c));
    cursor = batch[batch.length - 1][0] + INTERVAL_MS[interval];
    if (onProgress) onProgress(out.length);
    await sleep(150); // stay far below Binance rate limits
  }
  return out;
}

/**
 * Fetch historical futures funding rates (8-hourly records).
 * Returns sorted [{ t, pct }] — pct as percentage (0.01 = 0.01%). [] on failure.
 */
export async function fetchFundingHistoryPaged(symbol, startTime, endTime) {
  const out = [];
  let cursor = startTime;
  try {
    while (cursor < endTime) {
      const url = `${FUT_BASE}/fundingRate?symbol=${symbol}&startTime=${cursor}&endTime=${endTime}&limit=1000`;
      const res = await fetch(url);
      if (!res.ok) break;
      const batch = await res.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      for (const f of batch) out.push({ t: parseInt(f.fundingTime), pct: parseFloat(f.fundingRate) * 100 });
      cursor = out[out.length - 1].t + 1;
      await sleep(150);
    }
  } catch (e) {
    // Funding history is a scoring nicety — simulate with 0 (neutral) if unavailable
  }
  return out;
}

/**
 * Build a trailing window of `size` candles ending at 1H bar index i1h:
 * trailing completed higher-TF candles + one partial candle aggregated from the
 * 1H bars that opened after the last completed higher-TF close (mirrors live,
 * where the most recent candle returned by the API is still forming).
 */
function windowWithPartial(klines, completedCount, klines1h, i1h, size) {
  const lastCompleteClose = completedCount > 0 ? klines[completedCount - 1][6] : -Infinity;

  // Collect 1H bars belonging to the currently-forming higher-TF candle
  let j = i1h;
  while (j >= 0 && klines1h[j][0] > lastCompleteClose) j--;
  const firstPartialIdx = j + 1;

  let partial = null;
  if (firstPartialIdx <= i1h) {
    let high = -Infinity, low = Infinity, vol = 0;
    for (let k = firstPartialIdx; k <= i1h; k++) {
      if (klines1h[k][2] > high) high = klines1h[k][2];
      if (klines1h[k][3] < low) low = klines1h[k][3];
      vol += klines1h[k][5];
    }
    partial = [
      klines1h[firstPartialIdx][0],      // openTime
      klines1h[firstPartialIdx][1],      // open
      high, low,
      klines1h[i1h][4],                  // close = latest 1H close
      vol,
      klines1h[i1h][6]                   // closeTime so far
    ];
  }

  const need = partial ? size - 1 : size;
  const base = klines.slice(Math.max(0, completedCount - need), completedCount);
  return partial ? [...base, partial] : base;
}

/**
 * Grade one candidate against the full SL × TP outcome grid by walking forward
 * on 1H candles to the first touch. Conservative: SL checked before TP, so a candle
 * that spans both counts as a loss. Timeout = mark-to-market R at window end.
 */
function gradeCandidate(klines1h, i, sig, horizonBars) {
  const entry = sig.entryPrice;
  const isLong = sig.direction === 'LONG';
  const atr = sig.atr4h;
  const lastIdx = Math.min(klines1h.length - 1, i + horizonBars);
  const grid = {};

  for (const sm of SL_MULTS) {
    const slDist = sm * atr;
    const sl = isLong ? entry - slDist : entry + slDist;
    for (const tr of TP_RS) {
      const tp = isLong ? entry + tr * slDist : entry - tr * slDist;
      let result = 't'; // timeout
      let exitR = null;

      for (let k = i + 1; k <= lastIdx; k++) {
        const hi = klines1h[k][2], lo = klines1h[k][3];
        if (isLong ? lo <= sl : hi >= sl) { result = 'l'; exitR = -1; break; }
        if (isLong ? hi >= tp : lo <= tp) { result = 'w'; exitR = tr; break; }
      }
      if (result === 't') {
        const px = klines1h[lastIdx][4];
        exitR = (isLong ? px - entry : entry - px) / slDist;
      }
      grid[`${sm}|${tr}`] = { r: result, x: parseFloat(exitR.toFixed(3)) };
    }
  }
  return grid;
}

/**
 * Simulate one pair bar-by-bar. Returns candidate records.
 * @param {string} symbol
 * @param {Object} data - { klines1h, klines4h, klines1d, klines1w } covering warmup + test period
 * @param {Array} funding - sorted [{ t, pct }]
 * @param {Object} opts - { simStartTime, minScore, horizonBars, onProgress }
 */
export async function simulatePair(symbol, data, funding, opts = {}) {
  const { klines1h, klines4h, klines1d, klines1w } = data;
  const simStartTime = opts.simStartTime ?? 0;
  const horizonBars = opts.horizonBars ?? 48;
  const minScore = opts.minScore ?? 60;

  const candidates = [];
  const suppressUntil = {}; // direction → time (mirror live 3H same-signal window)
  let p4 = 0, p1d = 0, p1w = 0, pf = 0;

  for (let i = 0; i < klines1h.length; i++) {
    const T = klines1h[i][6]; // bar close time

    // Advance completed-candle pointers (closeTime ≤ T)
    while (p4 < klines4h.length && klines4h[p4][6] <= T) p4++;
    while (p1d < klines1d.length && klines1d[p1d][6] <= T) p1d++;
    while (p1w < klines1w.length && klines1w[p1w][6] <= T) p1w++;
    while (pf < funding.length && funding[pf].t <= T) pf++;

    // Yield to the event loop periodically so browser UI stays responsive
    if (i % 500 === 0) await sleep(0);

    if (T < simStartTime) continue;
    if (i + 1 < 200 || p4 < 200 || p1d < 200 || p1w < 21) continue;

    const w1h = klines1h.slice(i - 199, i + 1);
    const w4h = windowWithPartial(klines4h, p4, klines1h, i, 200);
    const w1d = windowWithPartial(klines1d, p1d, klines1h, i, 200);
    const w1w = windowWithPartial(klines1w, p1w, klines1h, i, 30);
    const fundingPct = pf > 0 ? funding[pf - 1].pct : 0;

    let analysis;
    try {
      analysis = analyzeMarket(symbol,
        { klines1d: w1d, klines4h: w4h, klines1h: w1h, klines1w: w1w },
        fundingPct,
        { candidateMode: true, minScore });
    } catch (e) {
      continue;
    }

    if (opts.onProgress && i % 500 === 0) opts.onProgress(symbol, i, klines1h.length);

    const sig = analysis.signal;
    if (!sig) continue;
    if ((suppressUntil[sig.direction] ?? 0) > T) continue;
    suppressUntil[sig.direction] = T + 3 * H1;

    candidates.push({
      pair: symbol,
      dir: sig.direction,
      t: T,
      entry: sig.entryPrice,
      atr: sig.atr4h,
      conf: sig.confidence,
      adx: analysis.indicatorValues.adx4h,
      rsi1d: analysis.indicatorValues.rsi1d,
      weekly: analysis.weeklyTrend,
      fund: fundingPct,
      mode: analysis.marketMode,
      div: sig.indicators.divergence,
      bos: sig.indicators.bos,
      blocked: {
        fund: analysis.isFundingBlocked,
        wk: analysis.isWeeklyBlocked,
        rsi: analysis.isRsiBlocked,
        adx: analysis.isAdxBlocked
      },
      grid: gradeCandidate(klines1h, i, sig, horizonBars)
    });
  }

  return candidates;
}

/**
 * Full multi-pair backtest: fetch everything, simulate every pair.
 * @param {Array<string>} pairs
 * @param {Object} opts - { months (test period, default 12), warmupDays (200), minScore, onStatus(text), onProgress }
 * @returns {{ candidates: Array, meta: Object }}
 */
export async function runFullBacktest(pairs, opts = {}) {
  const months = opts.months ?? 12;
  const warmupDays = opts.warmupDays ?? 200;
  const endTime = Date.now();
  const simStartTime = endTime - months * 30.44 * 24 * H1;
  const fetchStart = simStartTime - warmupDays * 24 * H1;
  const status = opts.onStatus || (() => {});

  const all = [];
  for (const pair of pairs) {
    status(`Fetching ${pair} history…`);
    const [klines1h, klines4h, klines1d, klines1w, funding] = [
      await fetchKlinesPaged(pair, '1h', fetchStart, endTime, n => status(`Fetching ${pair} 1H… ${n} candles`)),
      await fetchKlinesPaged(pair, '4h', fetchStart, endTime),
      await fetchKlinesPaged(pair, '1d', fetchStart, endTime),
      await fetchKlinesPaged(pair, '1w', fetchStart - 60 * 24 * H1, endTime),
      await fetchFundingHistoryPaged(pair, fetchStart, endTime)
    ];

    status(`Simulating ${pair} (${klines1h.length} bars)…`);
    const cands = await simulatePair(pair,
      { klines1h, klines4h, klines1d, klines1w },
      funding,
      {
        simStartTime,
        minScore: opts.minScore ?? 60,
        horizonBars: opts.horizonBars ?? 48,
        onProgress: (sym, i, total) => status(`Simulating ${sym}… ${Math.round(100 * i / total)}%`)
      });
    all.push(...cands);
    status(`${pair}: ${cands.length} candidates found.`);
  }

  all.sort((a, b) => a.t - b.t);
  return {
    candidates: all,
    meta: { pairs, months, simStartTime, endTime, generatedAt: Date.now() }
  };
}

/* ============================== ANALYSIS / TUNING ============================== */

/**
 * Apply a filter config to the candidate set and compute performance stats
 * at the config's (slMult, tpR) grid cell.
 * cfg: { threshold, adxMin, rsiGate (100 = off), weeklyOn, fundOn, slMult, tpR }
 */
export function evaluateConfig(candidates, cfg) {
  const sel = candidates.filter(c =>
    c.conf >= cfg.threshold &&
    c.adx >= cfg.adxMin &&
    (cfg.rsiGate >= 100 ||
      (c.dir === 'SHORT' ? c.rsi1d <= cfg.rsiGate : c.rsi1d >= 100 - cfg.rsiGate)) &&
    (!cfg.weeklyOn ||
      (c.dir === 'SHORT' ? c.weekly !== 'BULL' : c.weekly !== 'BEAR')) &&
    (!cfg.fundOn ||
      (c.dir === 'LONG' ? c.fund <= 0.05 : c.fund >= -0.05))
  );

  const key = `${cfg.slMult}|${cfg.tpR}`;
  let wins = 0, losses = 0, timeouts = 0, sumR = 0, grossWin = 0, grossLoss = 0;
  let cum = 0, peak = 0, maxDD = 0;

  for (const c of sel) {
    const cell = c.grid[key];
    if (!cell) continue;
    if (cell.r === 'w') wins++;
    else if (cell.r === 'l') losses++;
    else timeouts++;
    sumR += cell.x;
    if (cell.x > 0) grossWin += cell.x; else grossLoss += -cell.x;
    cum += cell.x;
    if (cum > peak) peak = cum;
    if (peak - cum > maxDD) maxDD = peak - cum;
  }

  const resolved = wins + losses;
  return {
    n: sel.length,
    wins, losses, timeouts,
    winRate: resolved > 0 ? wins / resolved : 0,
    expR: sel.length > 0 ? sumR / sel.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0),
    totalR: cum,
    maxDD_R: maxDD
  };
}

/**
 * Grid-search tuner with chronological train/holdout split.
 * Ranks by train expectancy (min sample enforced), then validates the top
 * configs on the holdout period and re-ranks by holdout expectancy.
 */
export function tuneConfigs(candidates, splitTime, opts = {}) {
  const train = candidates.filter(c => c.t < splitTime);
  const hold = candidates.filter(c => c.t >= splitTime);
  const minTrainN = opts.minTrainN ?? 80;
  const minHoldN = opts.minHoldN ?? 20;

  const results = [];
  for (const threshold of [70, 74, 77, 80, 85])
    for (const adxMin of [0, 18, 22, 25])
      for (const rsiGate of [55, 58, 62, 100])
        for (const weeklyOn of [true, false])
          for (const slMult of SL_MULTS)
            for (const tpR of TP_RS) {
              const cfg = { threshold, adxMin, rsiGate, weeklyOn, fundOn: true, slMult, tpR };
              const tr = evaluateConfig(train, cfg);
              if (tr.n < minTrainN) continue;
              results.push({ cfg, train: tr });
            }

  results.sort((a, b) => b.train.expR - a.train.expR);
  const shortlist = results.slice(0, 30).map(r => ({ ...r, hold: evaluateConfig(hold, r.cfg) }));
  const validated = shortlist
    .filter(r => r.hold.n >= minHoldN && r.hold.expR > 0)
    .sort((a, b) => b.hold.expR - a.hold.expR);

  return {
    top: validated.slice(0, 5),
    shortlist,
    configsTested: results.length,
    trainCount: train.length,
    holdCount: hold.length
  };
}

/**
 * TP distance vs hit-rate trade-off table at a fixed filter config + SL multiplier.
 */
export function tpTradeoffTable(candidates, cfg) {
  return TP_RS.map(tpR => {
    const stats = evaluateConfig(candidates, { ...cfg, tpR });
    return { tpR, ...stats };
  });
}

/**
 * Per-filter impact report: stats with the full config, with each filter removed,
 * and for the subset each filter would have blocked (what the filter "saved you from").
 */
export function filterImpactReport(candidates, cfg) {
  const rows = [];
  rows.push({ label: 'Full config (all filters)', stats: evaluateConfig(candidates, cfg) });
  rows.push({ label: 'Without weekly trend filter', stats: evaluateConfig(candidates, { ...cfg, weeklyOn: false }) });
  rows.push({ label: 'Without daily RSI gate', stats: evaluateConfig(candidates, { ...cfg, rsiGate: 100 }) });
  rows.push({ label: 'Without ADX minimum', stats: evaluateConfig(candidates, { ...cfg, adxMin: 0 }) });
  rows.push({ label: 'Without funding filter', stats: evaluateConfig(candidates, { ...cfg, fundOn: false }) });
  return rows;
}

/**
 * Group stats helper — slice candidates by a key function, evaluate each group.
 */
export function groupStats(candidates, cfg, keyFn) {
  const groups = {};
  for (const c of candidates) {
    const k = keyFn(c);
    (groups[k] = groups[k] || []).push(c);
  }
  return Object.entries(groups)
    .map(([k, list]) => ({ group: k, stats: evaluateConfig(list, cfg) }))
    .sort((a, b) => b.stats.n - a.stats.n);
}
