/**
 * WebSocket Connection Manager
 *
 * Handles the WebSocket connection between the JS Agent (in the browser)
 * and the MCP Proxy server. Implements automatic reconnection with
 * exponential backoff (1s -> 2s -> 4s -> ... -> 60s max).
 */

/**
 * Create a WebSocket connection manager.
 *
 * @param {string} url - WebSocket URL of the MCP Proxy server
 * @param {Function} onMessage - Callback invoked for each parsed incoming message
 * @returns {{connect, send, disconnect, reconnect}} Connection API object
 */
export function createConnection(url, onMessage) {
  let ws = null;

  // Tracks how many reconnection attempts have been made (for exponential backoff)
  let reconnectAttempt = 0;

  // Timer reference for pending reconnection
  let reconnectTimer = null;

  // Flag to prevent reconnection after an intentional disconnect
  let closed = false;

  /**
   * Calculate reconnection delay with exponential backoff.
   * Starts at 1s, doubles each attempt, capped at 60s.
   * @returns {number} Delay in milliseconds
   */
  function getReconnectDelay() {
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), 60000);
    return delay;
  }

  /**
   * Establish a WebSocket connection to the MCP Proxy.
   *
   * Sets up event handlers for open, message, close, and error events.
   * Automatically schedules reconnection on unexpected disconnection.
   * @returns {Promise<void>} Resolves when the connection is established
   */
  function connect() {
    if (closed) return Promise.resolve();
    return new Promise((resolve) => {
      console.log(`[JS-Agent] Connecting to ${url}...`);
      ws = new WebSocket(url);

      // Connection established — reset backoff counter and resolve
      ws.onopen = () => {
        reconnectAttempt = 0;
        console.log('[JS-Agent] Connected');
        resolve();
      };

      // Incoming message — parse JSON and forward to the handler
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          onMessage(msg);
        } catch {
          // Silently ignore malformed messages to prevent connection crashes
        }
      };

      // Connection closed — schedule reconnection with exponential backoff
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

      // Connection error — close the socket to trigger the onclose reconnection flow
      ws.onerror = (err) => {
        console.error(`[JS-Agent] Connection error: ${err}`);
        ws?.close();
      };
    });
  }

  /**
   * Send raw data through the WebSocket if the connection is open.
   * @param {string} data - Serialized data to send
   * @returns {boolean} True if the message was sent successfully
   */
  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
      return true;
    }
    return false;
  }

  /**
   * Gracefully disconnect and prevent any further reconnection attempts.
   */
  function disconnect() {
    closed = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    ws?.close();
    ws = null;
  }

  /**
   * Force an immediate reconnection by closing the current socket
   * and incrementing the backoff counter.
   */
  function reconnect() {
    reconnectAttempt++;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
    ws = null;
  }

  return { connect, send, disconnect, reconnect };
}