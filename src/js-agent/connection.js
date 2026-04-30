export function createConnection(url, onMessage) {
  let ws = null;
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let closed = false;

  function getReconnectDelay() {
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), 60000);
    return delay;
  }

  function connect() {
    if (closed) return Promise.resolve();
    return new Promise((resolve) => {
      console.log(`[JS-Agent] Connecting to ${url}...`);
      ws = new WebSocket(url);

      ws.onopen = () => {
        reconnectAttempt = 0;
        console.log('[JS-Agent] Connected');
        resolve();
      };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        onMessage(msg);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      console.warn('[JS-Agent] Connection closed');
      ws = null;
      if (!closed) {
        const delay = getReconnectDelay();
        reconnectAttempt++;
        console.warn(`[JS-Agent] Reconnecting in ${delay}ms (attempt ${reconnectAttempt})`);
        reconnectTimer = setTimeout(() => connect(), delay);
      }
    };

    ws.onerror = (err) => {
      console.error(`[JS-Agent] Connection error: ${err}`);
      ws?.close();
    };
    });
  }

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
      return true;
    }
    return false;
  }

  function disconnect() {
    closed = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    ws?.close();
    ws = null;
  }

  function reconnect() {
    reconnectAttempt++;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
    ws = null;
  }

  return { connect, send, disconnect, reconnect };
}