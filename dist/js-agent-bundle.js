(function() {
// ---- executor.js ----
function executeJs(code, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer = null;

    const timeoutPromise = new Promise((_, rejectTimeout) => {
      timer = setTimeout(() => {
        rejectTimeout(new Error(`Script execution timed out after ${timeoutMs}ms`));
      }, timeoutMs || Number.MAX_SAFE_INTEGER);
    });

    try {
      const result = (0, eval)(code);
      if (result instanceof Promise) {
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
        clearTimeout(timer);
        resolve(result);
      }
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

// ---- self-update.js ----
function validateSelfUpdate(newCode) {
  if (!newCode || typeof newCode !== 'string') {
    throw new Error('No code provided for self-update');
  }
  return true;
}

// ---- command-handler.js ----
function createCommandHandler(agentVersion, onReload) {
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

  function handleExecuteJs(params) {
    const code = params.code || '';
    const timeout = params.timeout || 10000;
    return executeJs(code, timeout);
  }

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

  const handlers = {
    READ_DOM: handleReadDom,
    EXECUTE_JS: handleExecuteJs,
    GET_CONTEXT: handleGetContext,
    UPDATE_AGENT: handleUpdateAgent,
  };

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
function createConnection(url, onMessage) {
  let ws = null;
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let closed = false;

  function getReconnectDelay() {
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), 60000);
    return delay;
  }

  function connect() {
    if (closed) return Promise.resolve();
    return new Promise((resolve) => {
      console.log(`[JS-Agent] Connecting to ${url}...`);
      ws = new WebSocket(url);

      ws.onopen = () => {
        reconnectAttempt = 0;
        console.log('[JS-Agent] Connected');
        resolve();
      };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        onMessage(msg);
      } catch {
        // ignore malformed messages
      }
    };

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

    ws.onerror = (err) => {
      console.error(`[JS-Agent] Connection error: ${err}`);
      ws?.close();
    };
    });
  }

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
      return true;
    }
    return false;
  }

  function disconnect() {
    closed = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    ws?.close();
    ws = null;
  }

  function reconnect() {
    reconnectAttempt++;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
    ws = null;
  }

  return { connect, send, disconnect, reconnect };
}

// ---- index.js ----
const __agentVersion = '0.1.0';

function createJsAgent(wsUrl, options = {}) {
  const { isUpdate = false } = options;
  const state = { commandHandler: null, wsUrl, isUpdate, connected: false };

  function onReloadCallback(newCode) {
    window.__jsAgentPrevious = window.__jsAgent;
    return new Promise((resolve, reject) => {
      try {
        (0, eval)(newCode);
      } catch (e) {
        reject(new Error('Self-update failed: ' + e.message));
        return;
      }
      // Wait for new agent to connect before disconnecting old
      const checkNewAgent = setInterval(() => {
        if (window.__jsAgent && window.__jsAgent.isReady) {
          clearInterval(checkNewAgent);
          console.log('[JS-Agent] New agent confirmed connected, decommissioning old agent');
          connection.disconnect();
          resolve();
        }
      }, 100);
      // Fallback timeout — disconnect after 10s regardless
      setTimeout(() => {
        clearInterval(checkNewAgent);
        console.warn('[JS-Agent] New agent connect timeout, forcing old agent disconnect');
        connection.disconnect();
        resolve();
      }, 10000);
    });
  }

  state.commandHandler = createCommandHandler(__agentVersion, onReloadCallback);

  const connection = createConnection(wsUrl, (msg) => {
    if (msg.type === 'ping') {
      connection.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    if (msg.type === 'request' && msg.id && msg.command) {
      const startTime = performance.now();
      const cmdId = msg.id.substring(0, 8);
      console.log(`[JS-Agent] ▶ ${msg.command} #${cmdId}`);

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
