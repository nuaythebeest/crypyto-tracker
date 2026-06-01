/**
 * Core Signal Engine
 * Runs multi-timeframe analysis (1D, 4H, 1H) for a given pair.
 * Scores indicators, checks trend confluence, applies filters,
 * and generates Long/Short signals.
 */

import { 
  calculateEMA, 
  calculateRSI, 
  calculateMACD, 
  calculateBollingerBands, 
  calculateATR, 
  calculateADX 
} from './indicators.js';

import { detectDivergence } from './divergence.js';
import { detectBOS } from './market-structure.js';

/**
 * Run complete analysis for a pair
 * @param {string} symbol - e.g. 'BTCUSDT'
 * @param {Object} data - Candle data: { klines1d, klines4h, klines1h }
 * @param {number} fundingRatePct - Current funding rate as percentage (e.g. 0.012 for 0.012%)
 * @returns {Object} Analysis result containing status, signals, and current indicator values
 */
export function analyzeMarket(symbol, data, fundingRatePct) {
  const { klines1d, klines4h, klines1h } = data;
  
  if (!klines1d || klines1d.length < 200 || 
      !klines4h || klines4h.length < 200 || 
      !klines1h || klines1h.length < 200) {
    throw new Error('Insufficient historical candle data for analysis (requires 200 candles minimum).');
  }

  // 1. Process Daily Timeframe Indicators
  const dailyCloses = klines1d.map(c => c[4]);
  const dailyEMA20 = calculateEMA(dailyCloses, 20);
  const dailyEMA50 = calculateEMA(dailyCloses, 50);
  const dailyEMA200 = calculateEMA(dailyCloses, 200);
  const dailyRSI = calculateRSI(dailyCloses, 14);

  // 2. Process 4H Timeframe Indicators
  const fourHCloses = klines4h.map(c => c[4]);
  const fourHHighs = klines4h.map(c => c[2]);
  const fourHLows = klines4h.map(c => c[3]);
  
  const fourHEMA50 = calculateEMA(fourHCloses, 50);
  const fourHRSI = calculateRSI(fourHCloses, 14);
  const fourHMACD = calculateMACD(fourHCloses);
  const fourHATR = calculateATR(fourHHighs, fourHLows, fourHCloses, 14);
  const fourHADX = calculateADX(fourHHighs, fourHLows, fourHCloses, 14);

  // 3. Process 1H Timeframe Indicators (Trigger Timeframe)
  const oneHCloses = klines1h.map(c => c[4]);
  const oneHHighs = klines1h.map(c => c[2]);
  const oneHLows = klines1h.map(c => c[3]);
  const oneHVolumes = klines1h.map(c => c[5]);
  
  const oneHRSI = calculateRSI(oneHCloses, 14);
  const oneHBB = calculateBollingerBands(oneHCloses, 20, 2);

  // Get current indices
  const idx1d = dailyCloses.length - 1;
  const idx4h = fourHCloses.length - 1;
  const idx1h = oneHCloses.length - 1;

  // Calculate 20-period average volume on 1H (excluding current candle)
  const recentVolumes = oneHVolumes.slice(Math.max(0, idx1h - 20), idx1h);
  const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / (recentVolumes.length || 1);

  // Extract latest indicator values
  const currPrice = oneHCloses[idx1h];
  const currRsi1d = dailyRSI[idx1d];
  const currRsi4h = fourHRSI[idx4h];
  const currRsi1h = oneHRSI[idx1h];
  const prevRsi1h = oneHRSI[idx1h - 1];
  
  const currMacdHist4h = fourHMACD.histogram[idx4h];
  const prevMacdHist4h = fourHMACD.histogram[idx4h - 1];
  
  const currAtr4h = fourHATR[idx4h];
  const currAdx4h = fourHADX[idx4h];

  // Divergence and BOS on 4H
  const divergence = detectDivergence(fourHHighs, fourHLows, fourHCloses, fourHRSI);
  const bos = detectBOS(fourHHighs, fourHLows, fourHCloses);

  // Determine market mode (ADX-based)
  let marketMode = 'TRANSITIONING';
  if (currAdx4h > 25) marketMode = 'TRENDING';
  else if (currAdx4h < 20) marketMode = 'RANGING';

  // --- Confluence Scoring ---

  // Determine Direction Confluence (Daily vs 4H)
  // Daily LONG: Close > EMA200 AND EMA20 > EMA50
  // Daily SHORT: Close < EMA200 AND EMA20 < EMA50
  const dailyLong = (dailyCloses[idx1d] > dailyEMA200[idx1d]) && (dailyEMA20[idx1d] > dailyEMA50[idx1d]);
  const dailyShort = (dailyCloses[idx1d] < dailyEMA200[idx1d]) && (dailyEMA20[idx1d] < dailyEMA50[idx1d]);
  
  const dailyDirection = dailyLong ? 'LONG' : (dailyShort ? 'SHORT' : 'CONFLICT');

  // 4H LONG: Close > EMA50
  // 4H SHORT: Close < EMA50
  const fourHLong = fourHCloses[idx4h] > fourHEMA50[idx4h];
  const fourHShort = fourHCloses[idx4h] < fourHEMA50[idx4h];
  const fourHDirection = fourHLong ? 'LONG' : (fourHShort ? 'SHORT' : 'CONFLICT');

  // Verify trend agreement (Conflict check)
  const isTrendAligned = (dailyDirection === 'LONG' && fourHDirection === 'LONG') || 
                         (dailyDirection === 'SHORT' && fourHDirection === 'SHORT');
  
  const alignedDirection = isTrendAligned ? dailyDirection : null;

  // Function to score a potential direction
  const evaluateScore = (dir) => {
    let dailyScore = 0;
    let fourHScore = 0;
    let oneHScore = 0;
    let externalScore = 0;
    let bonusScore = 0;

    const isLong = dir === 'LONG';

    // Daily Score (max 30 points)
    // 1. Price relative to EMA 200 (+15)
    if (isLong ? (dailyCloses[idx1d] > dailyEMA200[idx1d]) : (dailyCloses[idx1d] < dailyEMA200[idx1d])) {
      dailyScore += 15;
    }
    // 2. EMA 20 relative to EMA 50 (+10)
    if (isLong ? (dailyEMA20[idx1d] > dailyEMA50[idx1d]) : (dailyEMA20[idx1d] < dailyEMA50[idx1d])) {
      dailyScore += 10;
    }
    // 3. RSI Daily range (+5)
    if (isLong ? (currRsi1d >= 40 && currRsi1d <= 70) : (currRsi1d >= 30 && currRsi1d <= 60)) {
      dailyScore += 5;
    }

    // 4H Score (max 35 points)
    // 1. MACD histogram trending (+15)
    if (isLong ? (currMacdHist4h > prevMacdHist4h) : (currMacdHist4h < prevMacdHist4h)) {
      fourHScore += 15;
    }
    // 2. RSI 4H range (+10)
    if (isLong ? (currRsi4h >= 45 && currRsi4h <= 65) : (currRsi4h >= 35 && currRsi4h <= 55)) {
      fourHScore += 10;
    }
    // 3. Price relative to EMA 50 (+10)
    if (isLong ? (fourHCloses[idx4h] > fourHEMA50[idx4h]) : (fourHCloses[idx4h] < fourHEMA50[idx4h])) {
      fourHScore += 10;
    }

    // 1H Trigger Score (max 20 points)
    // 1. RSI 50 cross on this candle (+10)
    if (prevRsi1h !== null && currRsi1h !== null) {
      if (isLong ? (currRsi1h >= 50 && prevRsi1h < 50) : (currRsi1h <= 50 && prevRsi1h > 50)) {
        oneHScore += 10;
      }
    }
    // 2. BB Bounce / Rejection (+10)
    // BB Bounce Long: low touched or went under BB middle, but close is above middle
    // BB Rejection Short: high touched or went above BB upper, but close is below upper
    if (oneHBB.middle[idx1h] !== null && oneHBB.upper[idx1h] !== null) {
      if (isLong) {
        if (oneHLows[idx1h] <= oneHBB.middle[idx1h] && currPrice > oneHBB.middle[idx1h]) {
          oneHScore += 10;
        }
      } else {
        if (oneHHighs[idx1h] >= oneHBB.upper[idx1h] && currPrice < oneHBB.upper[idx1h]) {
          oneHScore += 10;
        }
      }
    }

    // External Filters (max 15 points)
    // 1. Volume confirmation (>1.2x of 20-period average) (+10)
    if (oneHVolumes[idx1h] > 1.2 * avgVolume) {
      externalScore += 10;
    }
    // 2. Funding rate neutral (-0.03% to +0.03%) (+5)
    if (fundingRatePct >= -0.03 && fundingRatePct <= 0.03) {
      externalScore += 5;
    }

    // Bonuses
    // 1. RSI Divergence (+10)
    if (isLong ? divergence.bullish : divergence.bearish) {
      bonusScore += 10;
    }
    // 2. Break of Structure (+8)
    if (isLong ? bos.bullish : bos.bearish) {
      bonusScore += 8;
    }

    const baseScore = dailyScore + fourHScore + oneHScore + externalScore;
    const totalScore = Math.min(100, baseScore + bonusScore);

    return {
      total: totalScore,
      breakdown: { daily: dailyScore, fourH: fourHScore, oneH: oneHScore, external: externalScore, bonus: bonusScore }
    };
  };

  // Evaluate scores for both directions
  const longEvaluation = evaluateScore('LONG');
  const shortEvaluation = evaluateScore('SHORT');

  // Hard Block: Funding Rate Filter
  let isFundingBlocked = false;
  let blockReason = '';
  
  if (alignedDirection === 'LONG' && fundingRatePct > 0.05) {
    isFundingBlocked = true;
    blockReason = 'Signal suppressed — funding rate extreme (market overleveraged longs)';
  } else if (alignedDirection === 'SHORT' && fundingRatePct < -0.05) {
    isFundingBlocked = true;
    blockReason = 'Signal suppressed — funding rate extreme (market overleveraged shorts)';
  }

  // Build the signal object if rules met
  let activeSignal = null;
  
  if (alignedDirection && !isFundingBlocked) {
    const evaluation = alignedDirection === 'LONG' ? longEvaluation : shortEvaluation;
    
    // Confidence score must be >= 70% to trigger signal display
    if (evaluation.total >= 70) {
      // Calculate SL (1.5x ATR-14 on 4H)
      // LONG: Stop Loss = Entry - (1.5 * ATR)
      // SHORT: Stop Loss = Entry + (1.5 * ATR)
      const entryPrice = currPrice;
      const stopLoss = alignedDirection === 'LONG' 
        ? entryPrice - (1.5 * currAtr4h) 
        : entryPrice + (1.5 * currAtr4h);
      
      const slDistancePct = Math.abs(entryPrice - stopLoss) / entryPrice * 100;
      const slDistancePrice = Math.abs(entryPrice - stopLoss);

      // Take Profits
      const tp1 = alignedDirection === 'LONG' ? entryPrice + (slDistancePrice * 1.5) : entryPrice - (slDistancePrice * 1.5);
      const tp2 = alignedDirection === 'LONG' ? entryPrice + (slDistancePrice * 3.0) : entryPrice - (slDistancePrice * 3.0);
      const tp3 = alignedDirection === 'LONG' ? entryPrice + (slDistancePrice * 5.0) : entryPrice - (slDistancePrice * 5.0);

      const tp1Pct = Math.abs(tp1 - entryPrice) / entryPrice * 100;
      const tp2Pct = Math.abs(tp2 - entryPrice) / entryPrice * 100;
      const tp3Pct = Math.abs(tp3 - entryPrice) / entryPrice * 100;

      // Construct rationale statement
      let rationale = `Confluence of aligned ${alignedDirection} trend on 1D/4H with entry momentum on 1H. `;
      if (alignedDirection === 'LONG') {
        if (divergence.bullish) rationale += 'Bullish RSI Divergence detected. ';
        if (bos.bullish) rationale += 'Bullish Break of Structure confirmed. ';
      } else {
        if (divergence.bearish) rationale += 'Bearish RSI Divergence detected. ';
        if (bos.bearish) rationale += 'Bearish Break of Structure confirmed. ';
      }

      activeSignal = {
        id: crypto.randomUUID(),
        pair: symbol,
        direction: alignedDirection,
        confidence: evaluation.total,
        entryPrice: entryPrice,
        entryZone: { low: entryPrice * 0.998, high: entryPrice * 1.002 },
        stopLoss: stopLoss,
        slDistancePct: parseFloat(slDistancePct.toFixed(2)),
        tp1: parseFloat(tp1.toFixed(4)),
        tp1Pct: parseFloat(tp1Pct.toFixed(2)),
        tp2: parseFloat(tp2.toFixed(4)),
        tp2Pct: parseFloat(tp2Pct.toFixed(2)),
        tp3: parseFloat(tp3.toFixed(4)),
        tp3Pct: parseFloat(tp3Pct.toFixed(2)),
        atr4h: parseFloat(currAtr4h.toFixed(4)),
        riskReward: 3.0, // fixed RR ratio at TP2
        indicators: {
          daily: {
            ema200: currPrice > dailyEMA200[idx1d] ? 'above' : 'below',
            emaCross: dailyEMA20[idx1d] > dailyEMA50[idx1d] ? 'bullish' : 'bearish',
            rsi: Math.round(currRsi1d)
          },
          fourH: {
            macd: currMacdHist4h > prevMacdHist4h ? 'bullish' : 'bearish',
            rsi: Math.round(currRsi4h),
            ema50: currPrice > fourHEMA50[idx4h] ? 'above' : 'below'
          },
          oneH: {
            rsiCross: (prevRsi1h < 50 && currRsi1h >= 50) || (prevRsi1h > 50 && currRsi1h <= 50),
            bbBounce: (alignedDirection === 'LONG' && oneHLows[idx1h] <= oneHBB.middle[idx1h] && currPrice > oneHBB.middle[idx1h]) ||
                      (alignedDirection === 'SHORT' && oneHHighs[idx1h] >= oneHBB.upper[idx1h] && currPrice < oneHBB.upper[idx1h])
          },
          volume: oneHVolumes[idx1h] > 1.2 * avgVolume ? 'above_avg' : 'normal',
          fundingRate: fundingRatePct,
          divergence: (alignedDirection === 'LONG' && divergence.bullish) ? 'bullish' : ((alignedDirection === 'SHORT' && divergence.bearish) ? 'bearish' : null),
          bos: (alignedDirection === 'LONG' && bos.bullish) ? 'bullish' : ((alignedDirection === 'SHORT' && bos.bearish) ? 'bearish' : null),
          adx: Math.round(currAdx4h)
        },
        scoreBreakdown: evaluation.breakdown,
        rationale: rationale.trim(),
        signalTime: Date.now(),
        expiresAt: Date.now() + 3 * 3600000, // +3 Hours
        status: 'active'
      };
    }
  }

  // Return the full analysis package
  return {
    symbol,
    currPrice,
    marketMode,
    fundingRatePct,
    isTrendAligned,
    dailyDirection,
    fourHDirection,
    isFundingBlocked,
    blockReason,
    scores: {
      long: longEvaluation.total,
      short: shortEvaluation.total,
      breakdownLong: longEvaluation.breakdown,
      breakdownShort: shortEvaluation.breakdown
    },
    indicatorValues: {
      rsi1d: currRsi1d,
      rsi4h: currRsi4h,
      rsi1h: currRsi1h,
      ema20_1d: dailyEMA20[idx1d],
      ema50_1d: dailyEMA50[idx1d],
      ema200_1d: dailyEMA200[idx1d],
      ema50_4h: fourHEMA50[idx4h],
      macdHist4h: currMacdHist4h,
      bbUpper1h: oneHBB.upper[idx1h],
      bbMiddle1h: oneHBB.middle[idx1h],
      bbLower1h: oneHBB.lower[idx1h],
      adx4h: currAdx4h,
      atr4h: currAtr4h
    },
    signal: activeSignal
  };
}
