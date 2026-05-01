/**
 * WebSocket Bridge Module
 *
 * Acts as the intermediary between MCP tool handlers (server side) and the
 * JS Agent running inside the browser. Maintains a pool of WebSocket clients,
 * routes commands to the agent, and collects responses via a pending-request map.
 *
 * Protocol (JSON over WebSocket):
 *   - request  { type: 'request',  id, command, params }
 *   - response { type: 'response', id, result?, error? }
 *   - ping/pong for keepalive every 30s
 */

import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';
import { log } from './config.js';

// Logging tag for WebSocket bridge entries
const TAG = 'WS-Bridge';

/**
 * Create and configure a WebSocket server on the given port.
 *
 * Manages client connections, request/response matching, timeouts, and keepalive pings.
 *
 * @param {number} port - Port number for the WebSocket server
 * @returns {{sendToAgent, getConnectedCount, sendPing, close, wss}} Server API object
 */
export function createWebSocketServer(port) {
  const wss = new WebSocketServer({ port });

  // Set of all currently connected WebSocket clients (JS Agents)
  const clients = new Set();

  // Map of request ID -> pending promise resolver. Used to match incoming responses
  // back to the original MCP tool call that initiated the request.
  const pendingRequests = new Map();

  let pingInterval = null;

  log('info', TAG, `WebSocket server created on port ${port}`);

  // --- Handle new client connections ---
  wss.on('connection', (ws) => {
    clients.add(ws);
    log('info', TAG, `Client connected. Total clients: ${clients.size}`);

    // Handle incoming messages from the JS Agent
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        log('warn', TAG, 'Failed to parse message from client');
        return;
      }

      // Ignore pong responses — they are keepalive acknowledgments
      if (msg.type === 'pong') {
        log('debug', TAG, 'Received pong from client');
        return;
      }

      // Match response to a pending request by ID and resolve the promise
      if (msg.type === 'response' && msg.id) {
        const pending = pendingRequests.get(msg.id);
        if (pending && !pending.resolved) {
          log('info', TAG, `Response received for request ${msg.id.slice(0, 8)}...`, {
            hasError: !!msg.error,
            hasResult: msg.result !== undefined,
          });
          pending.resolve(msg);
        } else {
          log('warn', TAG, `Received response for unknown request ${msg.id.slice(0, 8)}...`);
        }
        return;
      }

      log('debug', TAG, `Received unhandled message type: ${msg.type}`);
    });

    // Remove client from pool on disconnect
    ws.on('close', () => {
      clients.delete(ws);
      log('info', TAG, `Client disconnected. Total clients: ${clients.size}`);
    });

    // Log and close on client errors
    ws.on('error', (err) => {
      log('error', TAG, `Client error: ${err.message}`);
      ws?.close();
    });
  });

  /**
   * Send a command to the JS Agent and await the response.
   *
   * Broadcasts the request to all connected clients, stores a pending promise,
   * and resolves it when the matching response arrives (or times out).
   *
   * @param {string} command - Command identifier (e.g. 'READ_DOM', 'EXECUTE_JS')
   * @param {Object} [params={}] - Command-specific parameters
   * @param {number} [timeout=30000] - Maximum wait time in milliseconds
   * @returns {Promise<Object>} Response object from the JS Agent
   * @throws {Error} If no agent is connected or the request times out
   */
  function sendToAgent(command, params, timeout = 30000) {
    log('info', TAG, `Sending ${command} to agent`, { timeout, params });
    return new Promise((resolve, reject) => {
      // Fail fast if no JS Agent is connected
      if (clients.size === 0) {
        log('error', TAG, `No JS Agent connected for ${command}`);
        reject(new Error('No JS Agent connected'));
        return;
      }

      // Generate unique request ID and serialize the message
      const id = randomUUID();
      const message = JSON.stringify({
        type: 'request',
        id,
        command,
        params: params || {},
      });

      // Timeout guard — reject if no response arrives within the window
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        log('error', TAG, `Request ${command} timed out after ${timeout}ms`);
        reject(new Error(`Request ${command} timed out after ${timeout}ms`));
      }, timeout);

      // Store the pending promise resolver so incoming responses can resolve it
      pendingRequests.set(id, {
        resolved: false,
        resolve: (result) => {
          if (pendingRequests.get(id)?.resolved) return;
          pendingRequests.get(id).resolved = true;
          clearTimeout(timer);
          log('info', TAG, `Request ${command} resolved successfully`);
          resolve(result);
        },
        reject: (err) => {
          if (pendingRequests.get(id)?.resolved) return;
          clearTimeout(timer);
          log('error', TAG, `Request ${command} rejected: ${err.message}`);
          reject(err);
        },
      });

      // Broadcast the request to all connected JS Agent clients
      for (const client of clients) {
        client.send(message);
      }
    });
  }

  /**
   * Return the number of currently connected JS Agent clients.
   * @returns {number}
   */
  function getConnectedCount() {
    return clients.size;
  }

  /**
   * Send a ping message to all connected clients for keepalive purposes.
   */
  function sendPing() {
    log('debug', TAG, `Sending ping to ${clients.size} client(s)`);
    const ping = JSON.stringify({ type: 'ping' });
    for (const client of clients) {
      client.send(ping);
    }
  }

  /**
   * Gracefully shut down the WebSocket server.
   *
   * Cancels all pending requests, closes all client connections,
   * clears the ping interval, and closes the WebSocket server.
   */
  function close() {
    log('info', TAG, 'Closing WebSocket server');

    // Stop the keepalive ping interval
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }

    // Reject all unresolved pending requests so they don't hang
    const pendingCount = pendingRequests.size;
    for (const [id, pending] of pendingRequests) {
      if (!pending.resolved) {
        pending.reject(new Error('Server shutting down'));
      }
    }
    pendingRequests.clear();
    log('info', TAG, `Cancelled ${pendingCount} pending request(s)`);

    // Close all client connections and clear the pool
    for (const client of clients) {
      client.close();
    }
    clients.clear();
    wss.close();
  }

  // Start keepalive ping interval (every 30 seconds)
  pingInterval = setInterval(sendPing, 30000);

  return { sendToAgent, getConnectedCount, sendPing, close, wss };
}