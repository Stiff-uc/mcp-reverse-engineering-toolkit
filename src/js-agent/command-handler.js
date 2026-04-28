import { executeJs } from './executor.js';
import { selfUpdate } from './self-update.js';

export function createCommandHandler(agentVersion) {
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