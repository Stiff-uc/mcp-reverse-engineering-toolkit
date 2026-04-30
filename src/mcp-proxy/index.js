import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { EXPRESS_PORT, WS_PORT } from './config.js';
import { createWebSocketServer } from './websocket-bridge.js';
import { registerReadDom } from './tools/read-dom.js';
import { registerExecuteJs } from './tools/execute-js.js';
import { registerGetContext } from './tools/get-context.js';
import { registerUpdateAgent } from './tools/update-agent.js';

export async function startMcpProxy() {
  const wsServer = createWebSocketServer(WS_PORT);
  console.log(`WebSocket server listening on ws://localhost:${WS_PORT}`);

  const mcp = new McpServer({
    name: 'mcp-reverse-engineering-proxy',
    version: '0.1.0',
  });

  registerReadDom(mcp, wsServer);
  registerExecuteJs(mcp, wsServer);
  registerGetContext(mcp, wsServer);
  registerUpdateAgent(mcp, wsServer);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });

  await mcp.connect(transport);

  const app = express();
  app.use(express.json());

  app.all('/mcp', async (req, res) => {
    await transport.handleRequest(req, res, req.body);
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      wsClients: wsServer.getConnectedCount(),
      version: '0.1.0',
    });
  });

  const server = app.listen(EXPRESS_PORT, () => {
    console.log(`MCP server listening on http://localhost:${EXPRESS_PORT}/mcp`);
    console.log(`Health check: http://localhost:${EXPRESS_PORT}/health`);
  });

  function gracefulShutdown(signal) {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);
    wsServer.close();
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('Forced shutdown');
      process.exit(1);
    }, 5000);
  }

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  return { wsServer, mcp, app, server };
}

if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  startMcpProxy().catch(console.error);
}