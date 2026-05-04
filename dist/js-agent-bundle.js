(function() {
// ---- executor.js ----
/**
 * JavaScript Executor
 *
 * Safely executes JavaScript code in the browser context with timeout protection.
 * Supports both synchronous and async (Promise-returning) code.
 * All execution is wrapped in try/catch for error capture.
 */

/**
 * Execute JavaScript code with a timeout guard.
 *
 * Uses `eval` in the current browser context. If the evaluated code returns
 * a Promise, races it against the timeout. Synchronous results are returned immediately.
 *
 * @param {string} code - JavaScript source code to execute
 * @param {number} timeoutMs - Maximum execution time in milliseconds
 * @returns {Promise<any>} Result of the executed code
 * @throws {Error} If execution fails or times out
 */
function executeJs(code, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer = null;

    // Create a promise that rejects after the timeout duration
    const timeoutPromise = new Promise((_, rejectTimeout) => {
      timer = setTimeout(() => {
        rejectTimeout(new Error(`Script execution timed out after ${timeoutMs}ms`));
      }, timeoutMs || Number.MAX_SAFE_INTEGER);
    });

    try {
      // Evaluate the code in the current browser context
      const result = (0, eval)(code);

      if (result instanceof Promise) {
        // Async code — race the result against the timeout
        Promise.race([result, timeoutPromise])
          .then((val) => {
            clearTimeout(timer);
            resolve(val);
          })
          .catch((err) => {
            clearTimeout(timer);
            reject(err);
          });
      } else {
        // Synchronous code — clear timer and resolve immediately
        clearTimeout(timer);
        resolve(result);
      }
    } catch (err) {
      // Evaluation failed — clear timer and reject with the error
      clearTimeout(timer);
      reject(err);
    }
  });
}

// ---- self-update.js ----
/**
 * Self-Update Validation
 *
 * Provides utility functions for validating new agent code before
 * it is evaluated during a self-update operation.
 */

/**
 * Validate that the provided code is suitable for self-update.
 *
 * @param {string} newCode - New agent source code to validate
 * @returns {boolean} True if the code is valid
 * @throws {Error} If no code is provided or the type is incorrect
 */
function validateSelfUpdate(newCode) {
  if (!newCode || typeof newCode !== 'string') {
    throw new Error('No code provided for self-update');
  }
  return true;
}

// ---- command-handler.js ----
/**
 * Command Handler
 *
 * Routes incoming commands from the MCP Proxy to the appropriate handler function.
 * Each command corresponds to an MCP tool and executes logic in the browser context.
 *
 * Supported commands:
 *   - READ_DOM: Read the page DOM (optionally filtered by CSS selector)
 *   - EXECUTE_JS: Execute arbitrary JavaScript in the page context
 *   - GET_CONTEXT: Retrieve browser context data (URL, cookies, localStorage, etc.)
 *   - UPDATE_AGENT: Trigger a self-update of the JS Agent
 */


/**
 * Create a command handler instance.
 *
 * @param {string} agentVersion - Current version string of the JS Agent
 * @param {Function} [onReload] - Optional callback invoked during self-update
 * @returns {{handle}} Object with a handle method for routing commands
 */
function createCommandHandler(agentVersion, onReload) {
  /**
   * Handle READ_DOM command.
   *
   * Generates and executes JavaScript that reads the DOM, optionally
   * filtered by a CSS selector. Returns the outerHTML of matching elements.
   *
   * @param {Object} params - Command parameters
   * @param {string} [params.selector] - Optional CSS selector to filter elements
   * @param {number} [params.timeout=5000] - Execution timeout in ms
   * @returns {Promise<string>} HTML string of the DOM or selected elements
   */
  function handleReadDom(params) {
    const selector = params.selector || null;
    const timeout = params.timeout || 5000;

    return executeJs(`
      (function() {
        function getDom(sel) {
          if (!sel) {
            return document.documentElement.outerHTML;
          }
          const elements = document.querySelectorAll(sel);
          if (elements.length === 0) {
            throw new Error('No elements found for selector: ' + JSON.stringify(sel));
          }
          return Array.from(elements).map(el => el.outerHTML).join('\\n');
        }

        return getDom(${selector ? JSON.stringify(selector) : null});
      })()
    `, timeout);
  }

  /**
   * Handle EXECUTE_JS command.
   *
   * Directly executes the provided JavaScript code in the browser context.
   *
   * @param {Object} params - Command parameters
   * @param {string} params.code - JavaScript code to execute
   * @param {number} [params.timeout=10000] - Execution timeout in ms
   * @returns {Promise<any>} Result of the executed code
   */
  function handleExecuteJs(params) {
    const code = params.code || '';
    const timeout = params.timeout || 10000;
    return executeJs(code, timeout);
  }

  /**
   * Handle GET_CONTEXT command.
   *
   * Collects browser context data including URL, title, cookies, user agent,
   * and localStorage. If keys are specified, only those fields are returned.
   *
   * @param {Object} params - Command parameters
   * @param {string[]} [params.keys=[]] - Optional list of context keys to filter
   * @returns {Promise<Object>} Context data object
   */
  function handleGetContext(params) {
    const keys = params.keys || [];
    return executeJs(`
      (function() {
        var ctx = {};
        ctx.url = window.location.href;
        ctx.title = document.title;
        ctx.cookies = document.cookie;
        ctx.userAgent = navigator.userAgent;

        try {
          var ls = {};
          for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            ls[k] = localStorage.getItem(k);
          }
          ctx.localStorage = ls;
        } catch (e) {
          ctx.localStorage = { error: e.message };
        }

        var requestedKeys = ${JSON.stringify(keys)};
        if (requestedKeys.length === 0) {
          return ctx;
        }

        var filtered = {};
        for (var j = 0; j < requestedKeys.length; j++) {
          var key = requestedKeys[j];
          if (ctx.hasOwnProperty(key)) {
            filtered[key] = ctx[key];
          }
        }
        return filtered;
      })()
    `, 5000);
  }

  /**
   * Handle UPDATE_AGENT command.
   *
   * Triggers a self-update by invoking the onReload callback with new agent code.
   * If no code is provided, returns the current version without updating.
   *
   * @param {Object} params - Command parameters
   * @param {string} [params.code] - New agent source code (optional)
   * @returns {Promise<{version: string, updated: boolean}>} Update result
   */
  async function handleUpdateAgent(params) {
    const newCode = params.code || '';
    if (!newCode) {
      return { version: agentVersion, updated: false };
    }
    if (onReload) {
      await onReload(newCode);
    }
    return { version: agentVersion, updated: true };
  }

  // Map of command names to their handler functions
  const handlers = {
    READ_DOM: handleReadDom,
    EXECUTE_JS: handleExecuteJs,
    GET_CONTEXT: handleGetContext,
    UPDATE_AGENT: handleUpdateAgent,
  };

  /**
   * Route a command to the appropriate handler.
   *
   * @param {string} command - Command identifier (e.g. 'READ_DOM')
   * @param {Object} params - Command-specific parameters
   * @returns {Promise<any>} Result from the handler
   * @throws {Error} If the command is not recognized
   */
  function handle(command, params) {
    const handler = handlers[command];
    if (!handler) {
      throw new Error(`Unknown command: ${command}`);
    }
    return handler(params);
  }

  return { handle };
}

// ---- connection.js ----
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
function createConnection(url, onMessage) {
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

// ---- index.js ----
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



// Current version of the JS Agent
const __agentVersion = '0.1.0';

/**
 * Create a new JS Agent instance.
 *
 * @param {string} wsUrl - WebSocket URL of the MCP Proxy server
 * @param {Object} [options={}] - Optional configuration
 * @param {boolean} [options.isUpdate=false] - Whether this agent was spawned from a self-update
 * @returns {{start, getVersion, isReady}} Agent instance with lifecycle methods
 */
function createJsAgent(wsUrl, options = {}) {
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
  state.commandHandler = createCommandHandler(__agentVersion, onReloadCallback);

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
    getVersion: () => __agentVersion,
    isReady: false,
  };

  // Override start to set isReady flag on successful connect
  const originalStart = agent.start;
  agent.start = () => {
    return originalStart().then(() => {
      state.connected = true;
      agent.isReady = true;
      console.log(`[JS-Agent] Agent ready (version ${__agentVersion})`);
    });
  };

  return agent;
}

// ---- self-executing ----
var agent = createJsAgent("ws://localhost:3101");
agent.start().then(function() {
  console.log("[JS-Agent] Connected to MCP Proxy. Version: " + __agentVersion);
});
window.__jsAgent = agent;
})();
