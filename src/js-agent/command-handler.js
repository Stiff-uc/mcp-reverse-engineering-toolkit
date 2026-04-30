import { executeJs } from './executor.js';

export function createCommandHandler(agentVersion, onReload) {
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