/**
 * Risk Management Calculator
 * Handles position sizing, margin, liquidation prices, stop loss safety,
 * daily loss limits, and correlation alerts.
 */

const MAINTENANCE_MARGIN_RATE = 0.005; // 0.50% standard tier for BTC, ETH, SOL, BNB, XRP
const LIQ_SAFETY_FACTOR = 1.3;         // liquidation must sit ≥ 1.3× SL distance from entry

/**
 * Max leverage that keeps liquidation price at least 30% beyond the stop loss.
 * @param {number} entryPrice
 * @param {number} stopLossPrice
 * @returns {number} integer leverage 1–20
 */
export function getMaxSafeLeverage(entryPrice, stopLossPrice) {
  const slDistFraction = Math.abs(entryPrice - stopLossPrice) / entryPrice;
  if (!isFinite(slDistFraction) || slDistFraction <= 0) return 20;
  return Math.min(20, Math.max(1,
    Math.floor(1 / (LIQ_SAFETY_FACTOR * slDistFraction + MAINTENANCE_MARGIN_RATE))
  ));
}

const CORRELATION_GROUPS = {
  high: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
  medium: ['BNBUSDT'],
  low: ['XRPUSDT']
};

/**
 * Calculate Position Size, Margin, and Risk Stats
 * @param {Object} params - { accountSize, riskPercent, leverage, entryPrice, stopLossPrice, direction }
 */
export function calculatePosition(params) {
  const { accountSize, riskPercent, leverage, entryPrice, stopLossPrice, direction } = params;

  const riskAmount = accountSize * (riskPercent / 100);
  const slDistancePrice = Math.abs(entryPrice - stopLossPrice);
  const slDistancePct = (slDistancePrice / entryPrice) * 100;

  // Position size in crypto units (e.g. BTC)
  const positionSize = riskAmount / slDistancePrice;
  const notionalValue = positionSize * entryPrice;
  const marginRequired = notionalValue / leverage;

  // Liquidation Price calculation
  let liquidationPrice = 0;
  if (direction === 'LONG') {
    liquidationPrice = entryPrice * (1 - (1 / leverage) + MAINTENANCE_MARGIN_RATE);
  } else {
    liquidationPrice = entryPrice * (1 + (1 / leverage) - MAINTENANCE_MARGIN_RATE);
  }

  // Buffer to Liquidation %
  const bufferToLiqPct = (Math.abs(entryPrice - liquidationPrice) / entryPrice) * 100;

  let bufferStatus = 'Safe';
  if (bufferToLiqPct < 5) {
    bufferStatus = 'Dangerous';
  } else if (bufferToLiqPct >= 5 && bufferToLiqPct <= 10) {
    bufferStatus = 'Caution';
  }

  // Margin warning
  const isMarginWarning = marginRequired > (accountSize * 0.5);

  // Stop Loss safety buffer
  let slToLiqBuffer = 0;
  if (direction === 'LONG') {
    slToLiqBuffer = ((stopLossPrice - liquidationPrice) / stopLossPrice) * 100;
  } else {
    slToLiqBuffer = ((liquidationPrice - stopLossPrice) / stopLossPrice) * 100;
  }

  // Liquidation guard: liquidation distance must be ≥ 1.3 × SL distance,
  // i.e. even if price blows 30% past the stop, the position is stopped out — never liquidated.
  // liqDistance(fraction) = 1/leverage − MMR  ⟹  maxLev = 1 / (1.3 × slDist + MMR)
  const slDistFraction = slDistancePrice / entryPrice;
  const maxSafeLeverage = Math.min(20, Math.max(1,
    Math.floor(1 / (LIQ_SAFETY_FACTOR * slDistFraction + MAINTENANCE_MARGIN_RATE))
  ));
  const liqDistFraction = (1 / leverage) - MAINTENANCE_MARGIN_RATE;
  const isSLSafe = liqDistFraction >= LIQ_SAFETY_FACTOR * slDistFraction;

  return {
    riskAmount: parseFloat(riskAmount.toFixed(2)),
    positionSize: parseFloat(positionSize.toFixed(6)),
    notionalValue: parseFloat(notionalValue.toFixed(2)),
    marginRequired: parseFloat(marginRequired.toFixed(2)),
    liquidationPrice: parseFloat(liquidationPrice.toFixed(4)),
    bufferToLiqPct: parseFloat(bufferToLiqPct.toFixed(2)),
    bufferStatus,
    slDistancePct: parseFloat(slDistancePct.toFixed(2)),
    slToLiqBuffer: parseFloat(slToLiqBuffer.toFixed(2)),
    isSLSafe,
    maxSafeLeverage,
    isMarginWarning
  };
}

/**
 * Check Correlation Warnings
 * @param {string} newPair
 * @param {string} newDirection - 'LONG' | 'SHORT'
 * @param {Array<Object>} openPositions - Array of currently open trades from trade log
 * @returns {string|null} Warning message if correlation threshold violated, else null
 */
export function checkCorrelation(newPair, newDirection, openPositions) {
  const activePositions = openPositions.filter(pos => pos.status === 'taken');
  if (activePositions.length === 0) return null;

  const isNewInHighGroup = CORRELATION_GROUPS.high.includes(newPair);
  if (!isNewInHighGroup) return null;

  // Filter existing open positions in the high correlation group pointing in the same direction
  const correlated = activePositions.filter(pos => 
    CORRELATION_GROUPS.high.includes(pos.pair) && 
    pos.direction === newDirection
  );

  if (correlated.length > 0) {
    const list = correlated.map(pos => pos.pair.replace('USDT', '')).join(', ');
    return `⚠️ Correlation Exposure: You already have a ${newDirection} on ${list}. Adding ${newPair.replace('USDT', '')} increases your net exposure to the high-correlation major market trend.`;
  }

  return null;
}

/**
 * Determine if Daily Loss Limit was hit
 * Daily limit: 2 consecutive losses. Resets at 00:00 UTC.
 * @param {Array<Object>} trades - All logged trades from storage
 * @param {number} dailyLimit - Consecutive losses allowed (default 2)
 * @returns {boolean} True if loss limit reached and active signals should be blocked
 */
export function isDailyLossLimitReached(trades, dailyLimit = 2) {
  // Reset time calculation (00:00 UTC today)
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);

  // Filter trades logged today (UTC)
  const todaysTrades = trades.filter(t => t.signalTime >= todayUTC && t.status !== 'skipped');
  
  if (todaysTrades.length < dailyLimit) return false;

  // Sort by date ascending to check consecutive results
  todaysTrades.sort((a, b) => a.signalTime - b.signalTime);

  let consecutiveLosses = 0;
  for (let i = 0; i < todaysTrades.length; i++) {
    if (todaysTrades[i].result === 'loss') {
      consecutiveLosses++;
      if (consecutiveLosses >= dailyLimit) {
        return true;
      }
    } else if (todaysTrades[i].result === 'win' || todaysTrades[i].result === 'partial') {
      // win or partial profit breaks consecutive loss streak
      consecutiveLosses = 0;
    }
  }

  return false;
}
