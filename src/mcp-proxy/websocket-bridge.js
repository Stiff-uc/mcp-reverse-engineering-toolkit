import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';
import { log } from './config.js';

const TAG = 'WS-Bridge';

export function createWebSocketServer(port) {
  const wss = new WebSocketServer({ port });
  const clients = new Set();
  const pendingRequests = new Map();
  let pingInterval = null;

  log('info', TAG, `WebSocket server created on port ${port}`);

  wss.on('connection', (ws) => {
    clients.add(ws);
    log('info', TAG, `Client connected. Total clients: ${clients.size}`);

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        log('warn', TAG, 'Failed to parse message from client');
        return;
      }

      if (msg.type === 'pong') {
        log('debug', TAG, 'Received pong from client');
        return;
      }

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

    ws.on('close', () => {
      clients.delete(ws);
      log('info', TAG, `Client disconnected. Total clients: ${clients.size}`);
    });

    ws.on('error', (err) => {
      log('error', TAG, `Client error: ${err.message}`);
      ws?.close();
    });
  });

  function sendToAgent(command, params, timeout = 30000) {
    log('info', TAG, `Sending ${command} to agent`, { timeout, params });
    return new Promise((resolve, reject) => {
      if (clients.size === 0) {
        log('error', TAG, `No JS Agent connected for ${command}`);
        reject(new Error('No JS Agent connected'));
        return;
      }

      const id = randomUUID();
      const message = JSON.stringify({
        type: 'request',
        id,
        command,
        params: params || {},
      });

      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        log('error', TAG, `Request ${command} timed out after ${timeout}ms`);
        reject(new Error(`Request ${command} timed out after ${timeout}ms`));
      }, timeout);

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

      for (const client of clients) {
        client.send(message);
      }
    });
  }

  function getConnectedCount() {
    return clients.size;
  }

  function sendPing() {
    log('debug', TAG, `Sending ping to ${clients.size} client(s)`);
    const ping = JSON.stringify({ type: 'ping' });
    for (const client of clients) {
      client.send(ping);
    }
  }

  function close() {
    log('info', TAG, 'Closing WebSocket server');
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    const pendingCount = pendingRequests.size;
    for (const [id, pending] of pendingRequests) {
      if (!pending.resolved) {
        pending.reject(new Error('Server shutting down'));
      }
    }
    pendingRequests.clear();
    log('info', TAG, `Cancelled ${pendingCount} pending request(s)`);
    for (const client of clients) {
      client.close();
    }
    clients.clear();
    wss.close();
  }

  pingInterval = setInterval(sendPing, 30000);

  return { sendToAgent, getConnectedCount, sendPing, close, wss };
}