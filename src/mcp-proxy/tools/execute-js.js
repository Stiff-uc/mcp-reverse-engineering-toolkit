/**
 * Execute JavaScript Tool
 *
 * MCP tool that executes arbitrary JavaScript code inside the browser context
 * of the JS Agent. The code runs in the page's runtime, giving access to the
 * full DOM, browser APIs, and any loaded scripts. Results are JSON-serialized
 * and truncated to MAX_RESPONSE_SIZE (50KB) if necessary.
 */

import { z } from 'zod';
import { log, MAX_RESPONSE_SIZE } from '../config.js';

// Logging tag for execute-js tool entries
const TAG = 'Tool:execute-js';

/**
 * Register the 'execute-js' tool with the MCP server.
 *
 * @param {McpServer} mcp - The MCP server instance
 * @param {Object} wsServer - WebSocket bridge for communicating with JS Agent
 */
export function registerExecuteJs(mcp, wsServer) {
  log('info', TAG, 'Registering execute-js tool');
  mcp.registerTool(
    'execute-js',
    {
      description:
        'Execute arbitrary JavaScript code inside the browser context of the JS Agent. ' +
        'The code runs in the page runtime with full access to DOM, browser APIs, and any loaded scripts. ' +
        'Results are JSON-serialized and returned. Use this tool for dynamic interactions, ' +
        'data extraction, or manipulating the page state.',
      inputSchema: z.object({
        code: z.string().describe(
          'JavaScript code to execute in the browser context. ' +
          'The return value will be JSON-serialized. ' +
          'Has full access to DOM, window, localStorage, and loaded scripts.'
        ),
        timeout: z.number().optional().describe(
          'Maximum execution time in milliseconds before the script is terminated. ' +
          'Default is 10000ms (10 seconds).'
        ),
      }),
      annotations: {
        title: 'Execute JavaScript',
        readOnlyHint: false,
        idempotentHint: false,
      },
    },
    // Tool handler — validates input then forwards to the JS Agent
    async ({ code, timeout }) => {
      log('info', TAG, 'execute-js called', { codeLen: code?.length, timeout });

      // Validate that code is a non-empty string before forwarding
      if (typeof code !== 'string' || !code) {
        log('warn', TAG, 'execute-js called with empty code');
        return {
          content: [{ type: 'text', text: 'Error: code parameter is required and must be a string' }],
          isError: true,
        };
      }

      try {
        // Send EXECUTE_JS command to the JS Agent with a 10s default timeout
        const response = await wsServer.sendToAgent('EXECUTE_JS', {
          code,
          timeout: timeout || 10000,
        });

        // If the agent reported an execution error, propagate it back
        if (response.error) {
          log('error', TAG, `Agent error: ${response.error.message}`);
          return {
            content: [{
              type: 'text',
              text: `Execution error: ${response.error.message}\nStack: ${response.error.stack || ''}`,
            }],
            isError: true,
          };
        }

        log('info', TAG, 'execute-js completed successfully');

        // Serialize the result as pretty-printed JSON
        let result = JSON.stringify(response.result, null, 2);

        // Truncate oversized responses to prevent memory issues
        if (result.length > MAX_RESPONSE_SIZE) {
          log('warn', TAG, `execute-js result truncated: ${result.length} bytes exceeds ${MAX_RESPONSE_SIZE} limit`);
          result = result.slice(0, MAX_RESPONSE_SIZE);
          result += '\n\n[TRUNCATED: response exceeded 50KB limit]';
        }

        return {
          content: [{ type: 'text', text: result }],
        };
      } catch (err) {
        // Catch-all for network failures, timeouts, or unexpected errors
        log('error', TAG, `Request failed: ${err.message}`);
        return {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    },
  );
}