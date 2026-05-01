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

import { executeJs } from './executor.js';

/**
 * Create a command handler instance.
 *
 * @param {string} agentVersion - Current version string of the JS Agent
 * @param {Function} [onReload] - Optional callback invoked during self-update
 * @returns {{handle}} Object with a handle method for routing commands
 */
export function createCommandHandler(agentVersion, onReload) {
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