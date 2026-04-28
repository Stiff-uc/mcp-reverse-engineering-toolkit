(function() {
// ---- executor.js ----
function executeJs(code, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer = null;

    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        reject(new Error(`Script execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    try {
      const result = (0, eval)(code);
      if (result instanceof Promise) {
        result
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
function selfUpdate(newCode) {
  if (!newCode || typeof newCode !== 'string') {
    throw new Error('No code provided for self-update');
  }

  (0, eval)(newCode);
}

// ---- command-handler.js ----
function createCommandHandler(agentVersion) {
  function handleReadDom(params) {
    const selector = params.selector || null;
    const timeout = params.timeout || 5000;

    return executeJs(`
      (function() {
        const timeout = ${timeout};
        const start = Date.now();

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

        var requestedKeys = ${JSON.stringify(keys)};
        if (requestedKeys.length === 0) {
          requestedKeys = Object.keys(ctx);
        }

        if (requestedKeys.indexOf('localStorage') !== -1) {
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
        }

        return ctx;
      })()
    `, 5000);
  }

  function handleUpdateAgent(params) {
    return executeJs(`
      (function() {
        var newCode = ${JSON.stringify(params.code || '')};
        if (!newCode) {
          return { version: ${JSON.stringify(agentVersion)}, updated: false };
        }
        selfUpdate(newCode);
        return { version: ${JSON.stringify(agentVersion)}, updated: true };
      })()
    `, 10000);
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
    if (closed) return;
    ws = new WebSocket(url);

    ws.onopen = () => {
      reconnectAttempt = 0;
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
      ws = null;
      if (!closed) {
        const delay = getReconnectDelay();
        reconnectAttempt++;
        reconnectTimer = setTimeout(() => connect(), delay);
      }
    };

    ws.onerror = () => {
      ws?.close();
    };
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

  return { connect, send, disconnect };
}

// ---- index.js ----
const __agentVersion = '0.1.0';

function createJsAgent(wsUrl) {
  const commandHandler = createCommandHandler(__agentVersion);

  const connection = createConnection(wsUrl, (msg) => {
    if (msg.type === 'ping') {
      connection.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    if (msg.type === 'request' && msg.id && msg.command) {
      commandHandler.handle(msg.command, msg.params || {})
        .then((result) => {
          connection.send(JSON.stringify({
            type: 'response',
            id: msg.id,
            result,
            error: null,
          }));
        })
        .catch((error) => {
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

  return {
    start: () => connection.connect(),
    getVersion: () => __agentVersion,
  };
}

// ---- self-executing ----
var agent = createJsAgent("ws://localhost:3101");
agent.start();
console.log("[JS-Agent] Connected to MCP Proxy. Version: " + __agentVersion);
window.__jsAgent = agent;
})();
