import { describe, it, expect } from 'vitest';
import { createWebSocketServer } from '../../src/mcp-proxy/websocket-bridge.js';
import { WebSocket } from 'ws';

describe('websocket-bridge', () => {
  it('should reject sendToAgent with no connected clients', async () => {
    const port = 11900 + Math.floor(Math.random() * 1000);
    const wsServer = createWebSocketServer(port);
    try {
      await expect(wsServer.sendToAgent('READ_DOM', {})).rejects.toThrow('No JS Agent connected');
    } finally {
      wsServer.close();
    }
  });

  it('should accept WebSocket connections', async () => {
    const port = 11900 + Math.floor(Math.random() * 1000);
    const wsServer = createWebSocketServer(port);
    const ws = new WebSocket(`ws://localhost:${port}`);
    await new Promise((resolve) => ws.on('open', resolve));
    expect(wsServer.getConnectedCount()).toBe(1);
    ws.close();
    wsServer.close();
  });

  it('should track connected clients', async () => {
    const port = 11900 + Math.floor(Math.random() * 1000);
    const wsServer = createWebSocketServer(port);
    const ws1 = new WebSocket(`ws://localhost:${port}`);
    const ws2 = new WebSocket(`ws://localhost:${port}`);
    await Promise.all([
      new Promise((resolve) => ws1.on('open', resolve)),
      new Promise((resolve) => ws2.on('open', resolve)),
    ]);
    expect(wsServer.getConnectedCount()).toBe(2);
    ws1.close();
    ws2.close();
    wsServer.close();
  });

  it('should send request and receive response from agent', async () => {
    const port = 11900 + Math.floor(Math.random() * 1000);
    const wsServer = createWebSocketServer(port);
    const ws = new WebSocket(`ws://localhost:${port}`);

    await new Promise((resolve) => ws.on('open', resolve));

    const promise = wsServer.sendToAgent('READ_DOM', { selector: 'body' });

    await new Promise((resolve) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        expect(msg.type).toBe('request');
        expect(msg.command).toBe('READ_DOM');
        expect(msg.params).toEqual({ selector: 'body' });
        expect(msg.id).toBeTruthy();

        ws.send(JSON.stringify({
          type: 'response',
          id: msg.id,
          result: '<body>test</body>',
          error: null,
        }));
        resolve();
      });
    });

    const response = await promise;
    expect(response.result).toBe('<body>test</body>');
    expect(response.error).toBeNull();
    ws.close();
    wsServer.close();
  });

  it('should handle error responses from agent', async () => {
    const port = 11900 + Math.floor(Math.random() * 1000);
    const wsServer = createWebSocketServer(port);
    const ws = new WebSocket(`ws://localhost:${port}`);

    await new Promise((resolve) => ws.on('open', resolve));

    const promise = wsServer.sendToAgent('EXECUTE_JS', { code: 'bad' });

    await new Promise((resolve) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        ws.send(JSON.stringify({
          type: 'response',
          id: msg.id,
          result: null,
          error: { message: 'SyntaxError', stack: 'line 1' },
        }));
        resolve();
      });
    });

    const response = await promise;
    expect(response.result).toBeNull();
    expect(response.error.message).toBe('SyntaxError');
    ws.close();
    wsServer.close();
  });

  it('should timeout if no response received', async () => {
    const port = 11900 + Math.floor(Math.random() * 1000);
    const wsServer = createWebSocketServer(port);
    const ws = new WebSocket(`ws://localhost:${port}`);

    await new Promise((resolve) => ws.on('open', resolve));

    await expect(wsServer.sendToAgent('READ_DOM', {}, 100)).rejects.toThrow('timed out');
    ws.close();
    wsServer.close();
  });
});