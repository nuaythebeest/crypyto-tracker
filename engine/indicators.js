/**
 * Mathematical Indicators Library for Candlestick Charts
 * All formulas are standard implementations.
 * Inputs: Arrays of highs, lows, closes, or volumes.
 * Outputs: Arrays of same length as input, with nulls for indices where indicators are undefined.
 */

/**
 * Exponential Moving Average (EMA)
 * Starts with closes[0] as the initial EMA value and smooths.
 * @param {Array<number>} closes
 * @param {number} period
 */
export function calculateEMA(closes, period) {
  const emaValues = [];
  if (closes.length === 0) return emaValues;
  
  const k = 2 / (period + 1);
  let emaVal = closes[0];
  emaValues.push(emaVal);
  
  for (let i = 1; i < closes.length; i++) {
    emaVal = closes[i] * k + emaVal * (1 - k);
    emaValues.push(emaVal);
  }
  return emaValues;
}

/**
 * Relative Strength Index (RSI)
 * Standard Wilder's smoothing technique.
 * @param {Array<number>} closes
 * @param {number} period
 */
export function calculateRSI(closes, period = 14) {
  const rsiValues = new Array(closes.length).fill(null);
  if (closes.length <= period) return rsiValues;
  
  let gains = 0;
  let losses = 0;
  
  // First RSI value calculations (simple average of gains and losses)
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) {
      gains += diff;
    } else {
      losses -= diff;
    }
  }
  
  let avgGain = gains / period;
  let avgLoss = losses / period;
  
  rsiValues[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
  
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    rsiValues[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
  }
  
  return rsiValues;
}

/**
 * Moving Average Convergence Divergence (MACD)
 * @param {Array<number>} closes
 * @param {number} fastPeriod - 12
 * @param {number} slowPeriod - 26
 * @param {number} signalPeriod - 9
 * @returns {Object} { macdLine: Array, signalLine: Array, histogram: Array }
 */
export function calculateMACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const macdLine = [];
  const signalLine = new Array(closes.length).fill(null);
  const histogram = new Array(closes.length).fill(null);
  
  if (closes.length < slowPeriod) {
    return { macdLine, signalLine, histogram };
  }
  
  const fastEMA = calculateEMA(closes, fastPeriod);
  const slowEMA = calculateEMA(closes, slowPeriod);
  
  for (let i = 0; i < closes.length; i++) {
    macdLine.push(fastEMA[i] - slowEMA[i]);
  }
  
  // Calculate Signal line as EMA of macdLine
  // We start the Signal Line calculation at the index where MACD becomes valid (index slowPeriod - 1)
  const startIdx = slowPeriod - 1;
  let signalVal = macdLine[startIdx];
  signalLine[startIdx] = signalVal;
  
  const k = 2 / (signalPeriod + 1);
  for (let i = startIdx + 1; i < closes.length; i++) {
    signalVal = macdLine[i] * k + signalVal * (1 - k);
    signalLine[i] = signalVal;
  }
  
  // Calculate Histogram
  for (let i = startIdx; i < closes.length; i++) {
    histogram[i] = macdLine[i] - signalLine[i];
  }
  
  return { macdLine, signalLine, histogram };
}

/**
 * Bollinger Bands (BB)
 * @param {Array<number>} closes
 * @param {number} period - 20
 * @param {number} stdDev - 2
 * @returns {Object} { upper: Array, middle: Array, lower: Array }
 */
export function calculateBollingerBands(closes, period = 20, stdDev = 2) {
  const upper = new Array(closes.length).fill(null);
  const middle = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  
  if (closes.length < period) {
    return { upper, middle, lower };
  }
  
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const sma = slice.reduce((a, b) => a + b) / period;
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period;
    const std = Math.sqrt(variance);
    
    middle[i] = sma;
    upper[i] = sma + stdDev * std;
    lower[i] = sma - stdDev * std;
  }
  
  return { upper, middle, lower };
}

/**
 * Average True Range (ATR)
 * Wilder's smoothed ATR.
 * @param {Array<number>} highs
 * @param {Array<number>} lows
 * @param {Array<number>} closes
 * @param {number} period - 14
 */
export function calculateATR(highs, lows, closes, period = 14) {
  const atrValues = new Array(closes.length).fill(null);
  if (closes.length <= period) return atrValues;
  
  const trueRanges = [];
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);
  }
  
  // Simple average of first 'period' true ranges
  let atrVal = trueRanges.slice(0, period).reduce((a, b) => a + b) / period;
  atrValues[period] = atrVal;
  
  for (let i = period; i < trueRanges.length; i++) {
    atrVal = (atrVal * (period - 1) + trueRanges[i]) / period;
    // Offset by 1 because trueRanges indices start at candle index 1
    atrValues[i + 1] = atrVal;
  }
  
  return atrValues;
}

/**
 * Average Directional Index (ADX)
 * Wilder's ADX formula using directional movement +DI and -DI.
 * @param {Array<number>} highs
 * @param {Array<number>} lows
 * @param {Array<number>} closes
 * @param {number} period - 14
 */
export function calculateADX(highs, lows, closes, period = 14) {
  const adxValues = new Array(closes.length).fill(null);
  if (closes.length < period * 2) return adxValues;
  
  const tr = [];
  const plusDM = [];
  const minusDM = [];
  
  for (let i = 1; i < closes.length; i++) {
    const currentTR = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    tr.push(currentTR);
    
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  
  const smoothedTR = new Array(tr.length).fill(0);
  const smoothedPlusDM = new Array(tr.length).fill(0);
  const smoothedMinusDM = new Array(tr.length).fill(0);
  
  let sumTR = 0;
  let sumPlusDM = 0;
  let sumMinusDM = 0;
  
  for (let i = 0; i < period; i++) {
    sumTR += tr[i];
    sumPlusDM += plusDM[i];
    sumMinusDM += minusDM[i];
  }
  
  smoothedTR[period - 1] = sumTR / period;
  smoothedPlusDM[period - 1] = sumPlusDM / period;
  smoothedMinusDM[period - 1] = sumMinusDM / period;
  
  for (let i = period; i < tr.length; i++) {
    smoothedTR[i] = (smoothedTR[i - 1] * (period - 1) + tr[i]) / period;
    smoothedPlusDM[i] = (smoothedPlusDM[i - 1] * (period - 1) + plusDM[i]) / period;
    smoothedMinusDM[i] = (smoothedMinusDM[i - 1] * (period - 1) + minusDM[i]) / period;
  }
  
  const dx = new Array(tr.length).fill(null);
  for (let i = period - 1; i < tr.length; i++) {
    const trVal = smoothedTR[i] || 1e-9;
    const plusDI = 100 * (smoothedPlusDM[i] / trVal);
    const minusDI = 100 * (smoothedMinusDM[i] / trVal);
    const diSum = plusDI + minusDI || 1e-9;
    dx[i] = 100 * Math.abs(plusDI - minusDI) / diSum;
  }
  
  let sumDX = 0;
  let validDXCount = 0;
  let firstADXIndex = -1;
  
  for (let i = 0; i < dx.length; i++) {
    if (dx[i] !== null) {
      sumDX += dx[i];
      validDXCount++;
      if (validDXCount === period) {
        firstADXIndex = i;
        break;
      }
    }
  }
  
  if (firstADXIndex === -1) return adxValues;
  
  let adxVal = sumDX / period;
  adxValues[firstADXIndex + 1] = adxVal;
  
  for (let i = firstADXIndex + 1; i < dx.length; i++) {
    adxVal = (adxVal * (period - 1) + dx[i]) / period;
    adxValues[i + 1] = adxVal;
  }
  
  return adxValues;
}
