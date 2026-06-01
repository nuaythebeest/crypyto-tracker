/**
 * WebSocket manager for Binance live data streams
 */

let ws = null;
let keepAliveInterval = null;

/**
 * Initialize Combined WebSocket connection
 * @param {Array<string>} pairs - e.g. ['BTCUSDT', 'ETHUSDT']
 * @param {Function} onPriceUpdate - Callback when ticker price updates: (pair, price, change24h, volume) => {}
 * @param {Function} onKlineClose - Callback when 1H kline closes: (pair) => {}
 * @param {Function} onStatusChange - Callback when connection status changes: (connected) => {}
 */
export function initWebSocket(pairs, onPriceUpdate, onKlineClose, onStatusChange) {
  if (ws) {
    ws.close();
  }

  // Format pairs for Binance stream
  // e.g. btcusdt@ticker / ethusdt@ticker / btcusdt@kline_1h
  const streams = [];
  pairs.forEach(pair => {
    const p = pair.toLowerCase();
    streams.push(`${p}@ticker`);
    streams.push(`${p}@kline_1h`);
  });

  const url = `wss://stream.binance.com:9443/stream?streams=${streams.join('/')}`;
  console.log('Connecting to WebSocket:', url);
  
  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log('WebSocket Connection Opened');
    onStatusChange(true);
    
    // Set up keepalive ping every 30 minutes
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    keepAliveInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ method: 'PING', id: Date.now() }));
      }
    }, 30 * 60 * 1000);
  };

  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (!payload.stream) return;

      const streamName = payload.stream;
      const data = payload.data;

      // 1. Ticker Stream Update
      if (streamName.endsWith('@ticker')) {
        const pair = data.s; // e.g. 'BTCUSDT'
        const price = parseFloat(data.c);
        const changePct = parseFloat(data.P);
        const volume = parseFloat(data.v);
        onPriceUpdate(pair, price, changePct, volume);
      }
      
      // 2. Kline Stream Update (to trigger signal engine on candle close)
      if (streamName.endsWith('@kline_1h')) {
        const k = data.k;
        const pair = data.s;
        if (k.x === true) {
          // candle is closed!
          console.log(`1H Candle closed for ${pair}, triggering signal engine.`);
          onKlineClose(pair);
        }
      }
    } catch (error) {
      console.error('Error handling websocket message:', error);
    }
  };

  ws.onclose = () => {
    console.warn('WebSocket Connection Closed, attempting reconnect in 5s...');
    onStatusChange(false);
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    setTimeout(() => {
      initWebSocket(pairs, onPriceUpdate, onKlineClose, onStatusChange);
    }, 5000);
  };

  ws.onerror = (error) => {
    console.error('WebSocket Error:', error);
    ws.close();
  };
}

/**
 * Close WebSocket connection
 */
export function closeWebSocket() {
  if (ws) {
    ws.close();
    ws = null;
  }
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}
