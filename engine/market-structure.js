/**
 * Market Structure — Break of Structure (BOS) Detection
 * Run on 4H candles.
 * 
 * Swing point detection is imported from divergence.js.
 */
import { findSwingPoints } from './divergence.js';

/**
 * Detect Break of Structure (BOS) on 4H
 * @param {Array<number>} highs
 * @param {Array<number>} lows
 * @param {Array<number>} closes
 * @returns {Object} { bullishBOS: boolean, bearishBOS: boolean, recentHigh: number|null, recentLow: number|null }
 */
export function detectBOS(highs, lows, closes) {
  const N = closes.length - 1;
  const { swingHighs, swingLows } = findSwingPoints(highs, lows);
  
  let bullishBOS = false;
  let bearishBOS = false;
  let recentHigh = null;
  let recentLow = null;
  
  // Bullish BOS: current candle closes ABOVE the most recent swing high
  if (swingHighs.length > 0) {
    const mostRecentHigh = swingHighs[swingHighs.length - 1];
    recentHigh = mostRecentHigh.price;
    // Current candle is N
    if (closes[N] > mostRecentHigh.price) {
      bullishBOS = true;
    }
  }
  
  // Bearish BOS: current candle closes BELOW the most recent swing low
  if (swingLows.length > 0) {
    const mostRecentLow = swingLows[swingLows.length - 1];
    recentLow = mostRecentLow.price;
    if (closes[N] < mostRecentLow.price) {
      bearishBOS = true;
    }
  }
  
  return {
    bullish: bullishBOS,
    bearish: bearishBOS,
    recentHigh,
    recentLow
  };
}
