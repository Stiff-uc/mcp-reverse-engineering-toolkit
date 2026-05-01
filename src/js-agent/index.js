/**
 * JS Agent — Entry Point
 *
 * Factory function that creates a JS Agent instance. The agent is injected
 * into the browser and connects to the MCP Proxy via WebSocket. It handles
 * incoming commands from the proxy, routes them to the appropriate handler,
 * and sends responses back.
 *
 * The agent supports self-update: new code can be evaluated at runtime,
 * replacing the current agent instance seamlessly.
 */

import { createConnection } from './connection.js';
import { createCommandHandler } from './command-handler.js';

// Current version of the JS Agent
const AGENT_VERSION = '0.1.0';

/**
 * Create a new JS Agent instance.
 *
 * @param {string} wsUrl - WebSocket URL of the MCP Proxy server
 * @param {Object} [options={}] - Optional configuration
 * @param {boolean} [options.isUpdate=false] - Whether this agent was spawned from a self-update
 * @returns {{start, getVersion, isReady}} Agent instance with lifecycle methods
 */
export function createJsAgent(wsUrl, options = {}) {
  const { isUpdate = false } = options;
  const state = { commandHandler: null, wsUrl, isUpdate, connected: false };

  /**
   * Callback invoked during self-update to reload the agent with new code.
   *
   * Evaluates the new agent code, waits for the new instance to connect,
   * then disconnects the old instance. Falls back to forced disconnect after 10s.
   *
   * @param {string} newCode - Complete JS Agent source code to evaluate
   * @returns {Promise<void>}
   */
  function onReloadCallback(newCode) {
    // Preserve reference to the old agent before replacement
    window.__jsAgentPrevious = window.__jsAgent;
    return new Promise((resolve, reject) => {
      try {
        // Evaluate new agent code in the current browser context
        (0, eval)(newCode);
      } catch (e) {
        reject(new Error('Self-update failed: ' + e.message));
        return;
      }
      // Poll every 100ms for the new agent to confirm it is connected
      const checkNewAgent = setInterval(() => {
        if (window.__jsAgent && window.__jsAgent.isReady) {
          clearInterval(checkNewAgent);
          console.log('[JS-Agent] New agent confirmed connected, decommissioning old agent');
          connection.disconnect();
          resolve();
        }
      }, 100);
      // Fallback timeout — disconnect after 10s regardless of new agent status
      setTimeout(() => {
        clearInterval(checkNewAgent);
        console.warn('[JS-Agent] New agent connect timeout, forcing old agent disconnect');
        connection.disconnect();
        resolve();
      }, 10000);
    });
  }

  // Create the command handler, passing the reload callback for self-update support
  state.commandHandler = createCommandHandler(AGENT_VERSION, onReloadCallback);

  // Create WebSocket connection with a message handler
  const connection = createConnection(wsUrl, (msg) => {
    // Respond to keepalive pings immediately
    if (msg.type === 'ping') {
      connection.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    // Handle incoming command requests from the MCP Proxy
    if (msg.type === 'request' && msg.id && msg.command) {
      const startTime = performance.now();
      const cmdId = msg.id.substring(0, 8);
      console.log(`[JS-Agent] ▶ ${msg.command} #${cmdId}`);

      // Route the command through the handler and send the response back
      state.commandHandler.handle(msg.command, msg.params || {})
        .then((result) => {
          const elapsed = (performance.now() - startTime).toFixed(1);
          let summary = String(result);
          if (summary.length > 120) summary = summary.substring(0, 120) + '...';
          console.log(`[JS-Agent] ✓ ${msg.command} #${cmdId} (${elapsed}ms) → ${summary}`);
          connection.send(JSON.stringify({
            type: 'response',
            id: msg.id,
            result,
            error: null,
          }));
        })
        .catch((error) => {
          const elapsed = (performance.now() - startTime).toFixed(1);
          console.error(`[JS-Agent] ✗ ${msg.command} #${cmdId} (${elapsed}ms) → ${error.message || String(error)}`);
          connection.send(JSON.stringify({
            type: 'response',
            id: msg.id,
            result: null,
            error: {
              message: error.message || String(error),
              stack: error.stack || '',
            },
          }));
        });
    }
  });

  // Build the agent instance with lifecycle methods
  const agent = {
    start: () => connection.connect(),
    getVersion: () => AGENT_VERSION,
    isReady: false,
  };

  // Override start to set isReady flag on successful connect
  const originalStart = agent.start;
  agent.start = () => {
    return originalStart().then(() => {
      state.connected = true;
      agent.isReady = true;
      console.log(`[JS-Agent] Agent ready (version ${AGENT_VERSION})`);
    });
  };

  return agent;
}