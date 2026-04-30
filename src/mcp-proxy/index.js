import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { EXPRESS_PORT, WS_PORT, log, flushLogStream } from './config.js';
import { createWebSocketServer } from './websocket-bridge.js';
import { registerReadDom } from './tools/read-dom.js';
import { registerExecuteJs } from './tools/execute-js.js';
import { registerGetContext } from './tools/get-context.js';
import { registerUpdateAgent } from './tools/update-agent.js';

const TAG = 'MCP-Proxy';

export async function startMcpProxy() {
  log('info', TAG, 'Starting MCP Proxy...');
  const wsServer = createWebSocketServer(WS_PORT);
  log('info', TAG, `WebSocket server listening on ws://localhost:${WS_PORT}`);

  const mcp = new McpServer({
    name: 'mcp-reverse-engineering-proxy',
    version: '0.1.0',
  });
  log('info', TAG, 'MCP Server instance created');

  registerReadDom(mcp, wsServer);
  registerExecuteJs(mcp, wsServer);
  registerGetContext(mcp, wsServer);
  registerUpdateAgent(mcp, wsServer);
  log('info', TAG, 'All MCP tools registered');

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });

  await mcp.connect(transport);
  log('info', TAG, 'MCP transport connected');

  const app = express();
  app.use(express.json());

  app.all('/mcp', async (req, res) => {
    log('info', TAG, `MCP request: ${req.method} /mcp`);
    try {
      await transport.handleRequest(req, res, req.body);
      log('info', TAG, `MCP request handled, response status: ${res.statusCode}`);
    } catch (err) {
      log('error', TAG, `MCP request failed: ${err.message}`);
    }
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      wsClients: wsServer.getConnectedCount(),
      version: '0.1.0',
    });
  });

  const server = app.listen(EXPRESS_PORT, () => {
    log('info', TAG, `MCP server listening on http://localhost:${EXPRESS_PORT}/mcp`);
    log('info', TAG, `Health check: http://localhost:${EXPRESS_PORT}/health`);
  });

  function gracefulShutdown(signal) {
    log('info', TAG, `Received ${signal}. Shutting down gracefully...`);
    wsServer.close();
    server.close(() => {
      log('info', TAG, 'Server closed');
      flushLogStream(() => {
        process.exit(0);
      });
    });
    setTimeout(() => {
      log('error', TAG, 'Forced shutdown');
      flushLogStream(() => {
        process.exit(1);
      });
    }, 5000);
  }

  process.on('uncaughtException', (err) => {
    log('error', TAG, `Uncaught Exception: ${err.message}`);
    log('error', TAG, err.stack || 'No stack trace');
    flushLogStream(() => {
      process.exit(1);
    });
  });

  process.on('unhandledRejection', (reason) => {
    log('error', TAG, `Unhandled Rejection: ${reason}`);
  });

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  return { wsServer, mcp, app, server };
}

if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  startMcpProxy().catch((err) => log('error', TAG, `Fatal: ${err.message}`));
}