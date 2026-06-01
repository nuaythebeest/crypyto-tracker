// Test script for verifying REST calls and indicator calculations
import { fetchKlines, fetchFundingRate } from './api/binance-rest.js';
import { analyzeMarket } from './engine/signal-engine.js';

async function test() {
  console.log('--- STARTING ENGINE INTEGRATION TEST ---');
  const symbol = 'BTCUSDT';
  
  try {
    console.log(`1. Fetching historical candle data for ${symbol}...`);
    
    console.log('Fetching 1D candles...');
    const klines1d = await fetchKlines(symbol, '1d', 200);
    console.log(`   Fetched ${klines1d.length} 1D candles. Latest: ${new Date(klines1d[klines1d.length-1][0]).toISOString()}`);

    console.log('Fetching 4H candles...');
    const klines4h = await fetchKlines(symbol, '4h', 200);
    console.log(`   Fetched ${klines4h.length} 4H candles. Latest: ${new Date(klines4h[klines4h.length-1][0]).toISOString()}`);

    console.log('Fetching 1H candles...');
    const klines1h = await fetchKlines(symbol, '1h', 200);
    console.log(`   Fetched ${klines1h.length} 1H candles. Latest: ${new Date(klines1h[klines1h.length-1][0]).toISOString()}`);

    console.log('Fetching current funding rate...');
    const fundingData = await fetchFundingRate(symbol);
    console.log(`   Current funding rate: ${fundingData.fundingRatePct.toFixed(4)}%`);

    console.log('\n2. Running Signal Engine analysis...');
    const analysis = analyzeMarket(symbol, { klines1d, klines4h, klines1h }, fundingData.fundingRatePct);

    console.log('\n--- ANALYSIS RESULTS ---');
    console.log(`Pair: ${analysis.symbol}`);
    console.log(`Current Price: $${analysis.currPrice}`);
    console.log(`Market Mode: ${analysis.marketMode}`);
    console.log(`Daily Trend: ${analysis.dailyDirection}`);
    console.log(`4H Trend: ${analysis.fourHDirection}`);
    console.log(`Trend Aligned: ${analysis.isTrendAligned ? 'YES' : 'NO'}`);
    console.log(`Funding Blocked: ${analysis.isFundingBlocked ? 'YES' : 'NO'}`);
    console.log('\nScore Breakdown (Long vs Short):');
    console.log(`  LONG:  ${analysis.scores.long} pts (Daily ${analysis.scores.breakdownLong.daily}, 4H ${analysis.scores.breakdownLong.fourH}, 1H ${analysis.scores.breakdownLong.oneH}, Ext ${analysis.scores.breakdownLong.external}, Bonus ${analysis.scores.breakdownLong.bonus})`);
    console.log(`  SHORT: ${analysis.scores.short} pts (Daily ${analysis.scores.breakdownShort.daily}, 4H ${analysis.scores.breakdownShort.fourH}, 1H ${analysis.scores.breakdownShort.oneH}, Ext ${analysis.scores.breakdownShort.external}, Bonus ${analysis.scores.breakdownShort.bonus})`);
    
    console.log('\nIndicator Values:');
    console.log(`  RSI 1D:  ${analysis.indicatorValues.rsi1d?.toFixed(2)}`);
    console.log(`  RSI 4H:  ${analysis.indicatorValues.rsi4h?.toFixed(2)}`);
    console.log(`  RSI 1H:  ${analysis.indicatorValues.rsi1h?.toFixed(2)}`);
    console.log(`  ADX 4H:  ${analysis.indicatorValues.adx4h?.toFixed(2)}`);
    console.log(`  ATR 4H:  $${analysis.indicatorValues.atr4h?.toFixed(2)}`);
    console.log(`  MACD Hist 4H: ${analysis.indicatorValues.macdHist4h?.toFixed(4)}`);
    console.log(`  BB 1H: Middle $${analysis.indicatorValues.bbMiddle1h?.toFixed(2)} | Upper $${analysis.indicatorValues.bbUpper1h?.toFixed(2)} | Lower $${analysis.indicatorValues.bbLower1h?.toFixed(2)}`);

    if (analysis.signal) {
      console.log('\n🚨 SIGNAL GENERATED! 🚨');
      console.log(JSON.stringify(analysis.signal, null, 2));
    } else {
      console.log('\n❌ No high-confidence signal generated (confidence < 70% or trend mismatch/funding blocked).');
    }

    console.log('\n--- TEST SUCCESSFUL ---');
  } catch (error) {
    console.error('\n❌ TEST FAILED with error:', error);
  }
}

test();
