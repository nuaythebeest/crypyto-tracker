/**
 * RSI Divergence Detection
 * Run on 4H timeframe candles.
 * 
 * Bullish Divergence:
 * - Price makes LOWER LOW compared to previous swing low.
 * - RSI makes HIGHER LOW at the same points.
 * 
 * Bearish Divergence:
 * - Price makes HIGHER HIGH compared to previous swing high.
 * - RSI makes LOWER HIGH at the same points.
 */

/**
 * Find local swing high and swing low points in candles.
 * A swing point is a candle where:
 * - High is greater than previous 2 highs and next 2 highs.
 * - Low is less than previous 2 lows and next 2 lows.
 * @param {Array<number>} highs
 * @param {Array<number>} lows
 */
export function findSwingPoints(highs, lows) {
  const swingHighs = []; // Array of { index, price }
  const swingLows = [];  // Array of { index, price }
  
  if (highs.length < 5) return { swingHighs, swingLows };
  
  // We can search up to index - 2 because swing point confirmation requires 2 candles ahead.
  const lastIndex = highs.length - 1;
  for (let j = 2; j <= lastIndex - 2; j++) {
    const isSwingHigh = highs[j] > highs[j-1] && highs[j] > highs[j-2] &&
                        highs[j] > highs[j+1] && highs[j] > highs[j+2];
    if (isSwingHigh) {
      swingHighs.push({ index: j, price: highs[j] });
    }
    
    const isSwingLow = lows[j] < lows[j-1] && lows[j] < lows[j-2] &&
                       lows[j] < lows[j+1] && lows[j] < lows[j+2];
    if (isSwingLow) {
      swingLows.push({ index: j, price: lows[j] });
    }
  }
  
  return { swingHighs, swingLows };
}

/**
 * Detect RSI Divergence on the last 20 candles
 * @param {Array<number>} highs
 * @param {Array<number>} lows
 * @param {Array<number>} closes
 * @param {Array<number>} rsiValues
 * @returns {Object} { bullish: boolean, bearish: boolean }
 */
export function detectDivergence(highs, lows, closes, rsiValues) {
  const N = closes.length - 1;
  const { swingHighs, swingLows } = findSwingPoints(highs, lows);
  
  // Filter for swing points that occurred within the last 20 candles of the 4H timeframe
  const recentHighs = swingHighs.filter(h => h.index >= N - 20);
  const recentLows = swingLows.filter(l => l.index >= N - 20);
  
  let bullish = false;
  let bearish = false;
  
  // Bullish divergence check (comparing last two swing lows)
  if (recentLows.length >= 2) {
    const low2 = recentLows[recentLows.length - 1]; // most recent swing low
    const low1 = recentLows[recentLows.length - 2]; // previous swing low
    
    // Check if both points have valid RSI values
    if (rsiValues[low1.index] !== null && rsiValues[low2.index] !== null) {
      const priceLowerLow = low2.price < low1.price;
      const rsiHigherLow = rsiValues[low2.index] > rsiValues[low1.index];
      
      if (priceLowerLow && rsiHigherLow) {
        bullish = true;
      }
    }
  }
  
  // Bearish divergence check (comparing last two swing highs)
  if (recentHighs.length >= 2) {
    const high2 = recentHighs[recentHighs.length - 1]; // most recent swing high
    const high1 = recentHighs[recentHighs.length - 2]; // previous swing high
    
    // Check if both points have valid RSI values
    if (rsiValues[high1.index] !== null && rsiValues[high2.index] !== null) {
      const priceHigherHigh = high2.price > high1.price;
      const rsiLowerHigh = rsiValues[high2.index] < rsiValues[high1.index];
      
      if (priceHigherHigh && rsiLowerHigh) {
        bearish = true;
      }
    }
  }
  
  return { bullish, bearish };
}
