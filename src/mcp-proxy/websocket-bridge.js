import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';

export function createWebSocketServer(port) {
  const wss = new WebSocketServer({ port });
  const clients = new Set();
  const pendingRequests = new Map();
  let pingInterval = null;

  wss.on('connection', (ws) => {
    clients.add(ws);

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === 'pong') return;

      if (msg.type === 'response' && msg.id) {
        const pending = pendingRequests.get(msg.id);
        if (pending && !pending.resolved) {
          pending.resolved = true;
          pending.resolve(msg);
          pendingRequests.delete(msg.id);
        }
        return;
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
    });

    ws.on('error', () => {
      ws?.close();
    });
  });

  function sendToAgent(command, params, timeout = 30000) {
    return new Promise((resolve, reject) => {
      if (clients.size === 0) {
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
        reject(new Error(`Request ${command} timed out after ${timeout}ms`));
      }, timeout);

      pendingRequests.set(id, {
        resolved: false,
        resolve: (result) => {
          if (pendingRequests.get(id)?.resolved) return;
          pendingRequests.get(id).resolved = true;
          clearTimeout(timer);
          resolve(result);
        },
        reject: (err) => {
          if (pendingRequests.get(id)?.resolved) return;
          clearTimeout(timer);
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
    const ping = JSON.stringify({ type: 'ping' });
    for (const client of clients) {
      client.send(ping);
    }
  }

  function close() {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    for (const [id, pending] of pendingRequests) {
      if (!pending.resolved) {
        pending.reject(new Error('Server shutting down'));
      }
    }
    pendingRequests.clear();
    for (const client of clients) {
      client.close();
    }
    clients.clear();
    wss.close();
  }

  pingInterval = setInterval(sendPing, 30000);

  return { sendToAgent, getConnectedCount, sendPing, close, wss };
}