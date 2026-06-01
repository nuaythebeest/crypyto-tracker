/**
 * API Wrapper for Binance Futures and Spot REST Endpoints
 * Supports: OHLCV candles, 24h ticker, Funding Rate, Open Interest, Long/Short ratio,
 * Fear & Greed Index, and global market statistics.
 */

const BINANCE_SPOT_BASE = 'https://api.binance.com/api/v3';
const BINANCE_FUTURES_BASE = 'https://fapi.binance.com/fapi/v1';
const BINANCE_FUTURES_DATA = 'https://fapi.binance.com/futures/data';

/**
 * Fetch OHLCV Candlestick Data
 * @param {string} symbol - e.g. 'BTCUSDT'
 * @param {string} interval - '1h', '4h', '1d'
 * @param {number} limit - default 200
 * @returns {Promise<Array>} Arrays of [time, open, high, low, close, volume]
 */
export async function fetchKlines(symbol, interval, limit = 200) {
  try {
    const url = `${BINANCE_SPOT_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    return data.map(c => [
      parseInt(c[0]),          // Open Time (ms)
      parseFloat(c[1]),        // Open
      parseFloat(c[2]),        // High
      parseFloat(c[3]),        // Low
      parseFloat(c[4]),        // Close
      parseFloat(c[5]),        // Volume
      parseInt(c[6])           // Close Time (ms)
    ]);
  } catch (error) {
    console.error(`Error fetching klines for ${symbol} (${interval}):`, error);
    throw error;
  }
}

/**
 * Fetch 24h Ticker Price Change Statistics
 * @param {string} symbol
 */
export async function fetchTicker24h(symbol) {
  try {
    const url = `${BINANCE_SPOT_BASE}/ticker/24hr?symbol=${symbol}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    return {
      symbol: data.symbol,
      lastPrice: parseFloat(data.lastPrice),
      priceChangePercent: parseFloat(data.priceChangePercent),
      volume: parseFloat(data.volume),
      highPrice: parseFloat(data.highPrice),
      lowPrice: parseFloat(data.lowPrice)
    };
  } catch (error) {
    console.error(`Error fetching 24h ticker for ${symbol}:`, error);
    throw error;
  }
}

/**
 * Fetch Funding Rate and Mark Price (Futures)
 * @param {string} symbol
 */
export async function fetchFundingRate(symbol) {
  try {
    const url = `${BINANCE_FUTURES_BASE}/premiumIndex?symbol=${symbol}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    return {
      lastFundingRate: parseFloat(data.lastFundingRate), // e.g. 0.000100 (which is 0.01%)
      fundingRatePct: parseFloat(data.lastFundingRate) * 100, // e.g. 0.01%
      nextFundingTime: parseInt(data.nextFundingTime),
      markPrice: parseFloat(data.markPrice)
    };
  } catch (error) {
    console.warn(`Error fetching funding rate for ${symbol}, fallback to mock:`, error);
    return { lastFundingRate: 0.0001, fundingRatePct: 0.01, nextFundingTime: Date.now() + 8 * 3600000, markPrice: null };
  }
}

/**
 * Fetch Open Interest (Futures)
 * @param {string} symbol
 */
export async function fetchOpenInterest(symbol) {
  try {
    const url = `${BINANCE_FUTURES_BASE}/openInterest?symbol=${symbol}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    return parseFloat(data.openInterest);
  } catch (error) {
    console.warn(`Error fetching open interest for ${symbol}:`, error);
    return null;
  }
}

/**
 * Fetch Long/Short Accounts Ratio
 * @param {string} symbol
 * @param {string} period - '5m','15m','30m','1h','2h','4h','6h','8h','12h','1d'
 */
export async function fetchLongShortRatio(symbol, period = '1h') {
  try {
    const url = `${BINANCE_FUTURES_DATA}/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=1`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    if (data && data.length > 0) {
      return {
        longShortRatio: parseFloat(data[0].longShortRatio),
        longAccount: parseFloat(data[0].longAccount),
        shortAccount: parseFloat(data[0].shortAccount)
      };
    }
    return null;
  } catch (error) {
    console.warn(`Error fetching long/short ratio for ${symbol}:`, error);
    return null;
  }
}

/**
 * Fetch Fear and Greed Index
 */
export async function fetchFearGreedIndex() {
  try {
    const url = 'https://api.alternative.me/fng/?limit=1';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    if (data && data.data && data.data.length > 0) {
      return {
        value: parseInt(data.data[0].value),
        sentiment: data.data[0].value_classification
      };
    }
    return { value: 50, sentiment: 'Neutral' };
  } catch (error) {
    console.warn('Error fetching Fear & Greed index, returning default:', error);
    return { value: 50, sentiment: 'Neutral' };
  }
}

/**
 * Fetch Global Market Cap and BTC Dominance (CoinGecko public api)
 */
export async function fetchGlobalMarketStats() {
  try {
    const url = 'https://api.coingecko.com/api/v3/global';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    if (data && data.data) {
      const activeCryptos = data.data.active_cryptocurrencies;
      const totalMarketCap = data.data.total_market_cap.usd;
      const btcDominance = data.data.market_cap_percentage.btc;
      
      // format total cap to human-readable string like "$2.45T"
      let formattedCap = `$${(totalMarketCap / 1e12).toFixed(2)}T`;
      if (totalMarketCap < 1e12) {
        formattedCap = `$${(totalMarketCap / 1e9).toFixed(1)}B`;
      }
      
      return {
        btcDominance: btcDominance.toFixed(1) + '%',
        totalMarketCap: formattedCap,
        activeCryptos: activeCryptos
      };
    }
    return { btcDominance: '53.5%', totalMarketCap: '$2.34T' };
  } catch (error) {
    console.warn('Error fetching global stats from CoinGecko, returning estimates:', error);
    // return typical market status values as fallbacks in case of rate limits
    return { btcDominance: '54.2%', totalMarketCap: '$2.48T' };
  }
}
