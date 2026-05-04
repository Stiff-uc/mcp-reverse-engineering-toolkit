/**
 * MCP Proxy — Main Entry Point
 *
 * Bootstraps the MCP Proxy server, which consists of two components:
 *  1. An MCP server (via Streamable HTTP transport on Express) for AI agents.
 *  2. A WebSocket server for communicating with the browser-based JS Agent.
 *
 * The proxy forwards MCP tool calls from AI agents to the JS Agent through
 * the WebSocket bridge, then returns the results back over HTTP.
 */

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

/**
 * Initialize and start the MCP Proxy server.
 *
 * Creates the WebSocket bridge, registers all MCP tools, sets up the Express
 * HTTP server with the MCP endpoint, and configures graceful shutdown handlers.
 *
 * @returns {Promise<{wsServer, mcp, app, server}>} Objects for the running servers
 */
export async function startMcpProxy() {
  log('info', TAG, 'Starting MCP Proxy...');

  // Create WebSocket server that bridges MCP tool calls to the JS Agent in the browser
  const wsServer = createWebSocketServer(WS_PORT);
  log('info', TAG, `WebSocket server listening on ws://localhost:${WS_PORT}`);

  /** Check if the request body is an MCP initialize request */
  function isInitializeRequest(body) {
    return body && body.method === 'initialize';
  }

  /**
   * Create a new McpServer instance with all tools registered.
   * Each session needs its own McpServer because McpServer can only
   * connect to one transport at a time.
   */
  function createMcpServer() {
    const mcp = new McpServer({
      name: 'mcp-reverse-engineering-proxy',
      version: '0.1.0',
    });
    registerReadDom(mcp, wsServer);
    registerExecuteJs(mcp, wsServer);
    registerGetContext(mcp, wsServer);
    registerUpdateAgent(mcp, wsServer);
    return mcp;
  }

  // Multi-session map stores { transport, mcp } per session
  // Session ID is sent by the client in the 'mcp-session-id' header
  const sessions = new Map();

  // Set up Express application as the HTTP host for MCP transport
  const app = express();
  app.use(express.json());

  // Primary MCP endpoint — handles all HTTP methods for MCP protocol messages
  app.all('/mcp', async (req, res) => {
    const requestBody = req.body;
    const sessionId = req.headers['mcp-session-id'];
    log('info', TAG, `MCP request: ${req.method} /mcp`, {
      sessionId,
      method: requestBody?.method,
    });

    // Capture response body for error logging
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 400) {
        log('error', TAG, `MCP request error, status: ${res.statusCode}`, {
          method: req.method,
          sessionId,
          requestMethod: requestBody?.method,
          requestBody,
          responseBody: body,
        });
      }
      return originalJson(body);
    };

    try {
      // Case 1: Existing session — reuse its transport
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        await session.transport.handleRequest(req, res, requestBody);
        log('info', TAG, `MCP request handled (existing session), status: ${res.statusCode}`);
        return;
      }

      // Case 2: New session initialization
      if (!sessionId && isInitializeRequest(requestBody)) {
        const newTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
        });
        const newMcp = createMcpServer();

        // When session closes, remove it from the map
        newTransport.onclose = () => {
          if (newTransport.sessionId) {
            log('info', TAG, `Session closed: ${newTransport.sessionId}`);
            sessions.delete(newTransport.sessionId);
          }
        };

        await newMcp.connect(newTransport);
        await newTransport.handleRequest(req, res, requestBody);
        log('info', TAG, `MCP initialize handled, status: ${res.statusCode}`);

        // Store session after initialization (sessionId is set after first response)
        if (newTransport.sessionId) {
          sessions.set(newTransport.sessionId, { transport: newTransport, mcp: newMcp });
          log('info', TAG, `New session created: ${newTransport.sessionId}`);
        }
        return;
      }

      // Case 3: Invalid — no session ID and not an initialize request
      log('error', TAG, 'MCP request rejected: missing session and not initialize', {
        method: req.method,
        requestBody,
      });
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32600, message: 'Invalid request: missing session' },
      });
    } catch (err) {
      log('error', TAG, `MCP request failed: ${err.message}`, {
        error: err.message,
        stack: err.stack || 'No stack trace',
        method: req.method,
        sessionId,
        requestBody,
      });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: err.message },
        });
      }
    }
  });

  // Health-check endpoint exposing server status and connected JS Agent count
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      wsClients: wsServer.getConnectedCount(),
      mcpSessions: sessions.size,
      version: '0.1.0',
    });
  });

  // Start listening for incoming HTTP requests
  const server = app.listen(EXPRESS_PORT, () => {
    log('info', TAG, `MCP server listening on http://localhost:${EXPRESS_PORT}/mcp`);
    log('info', TAG, `Health check: http://localhost:${EXPRESS_PORT}/health`);
  });

  // --- Graceful shutdown handler ---
  // Closes all session transports, WebSocket and HTTP servers, flushes logs, then exits.
  // Falls back to forced shutdown if graceful close takes longer than 5 seconds.
  function gracefulShutdown(signal) {
    log('info', TAG, `Received ${signal}. Shutting down gracefully...`);

    // Close all active session transports
    for (const [sid, session] of sessions) {
      log('info', TAG, `Closing session transport: ${sid}`);
      session.transport.close();
    }
    sessions.clear();

    wsServer.close();
    server.close(() => {
      log('info', TAG, 'Server closed');
      flushLogStream(() => {
        process.exit(0);
      });
    });
    // Force exit after 5s to avoid hanging
    setTimeout(() => {
      log('error', TAG, 'Forced shutdown');
      flushLogStream(() => {
        process.exit(1);
      });
    }, 5000);
  }

  // Log and exit on uncaught exceptions to prevent silent corruption
  process.on('uncaughtException', (err) => {
    log('error', TAG, `Uncaught Exception: ${err.message}`);
    log('error', TAG, err.stack || 'No stack trace');
    flushLogStream(() => {
      process.exit(1);
    });
  });

  // Log unhandled promise rejections (non-fatal — server keeps running)
  process.on('unhandledRejection', (reason) => {
    log('error', TAG, `Unhandled Rejection: ${reason}`);
  });

  // Register signal handlers for graceful termination
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  return { wsServer, app, server };
}

// Auto-start when this file is executed directly (not imported as a module)
if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  startMcpProxy().catch((err) => log('error', TAG, `Fatal: ${err.message}`));
}