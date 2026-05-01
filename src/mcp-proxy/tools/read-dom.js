/**
 * Read DOM Tool
 *
 * MCP tool that reads the HTML DOM of the current web page.
 * Supports an optional CSS selector to target specific elements.
 * Results are truncated to MAX_RESPONSE_SIZE (50KB) to prevent oversized responses.
 */

import { z } from 'zod';
import { log, MAX_RESPONSE_SIZE } from '../config.js';

// Logging tag for read-dom tool entries
const TAG = 'Tool:read-dom';

/**
 * Register the 'read-dom' tool with the MCP server.
 *
 * Wires the tool through the WebSocket bridge so the actual DOM reading
 * is delegated to the JS Agent running in the browser.
 *
 * @param {McpServer} mcp - The MCP server instance
 * @param {Object} wsServer - WebSocket bridge for communicating with JS Agent
 */
export function registerReadDom(mcp, wsServer) {
  log('info', TAG, 'Registering read-dom tool');
  mcp.registerTool(
    'read-dom',
    {
      description: 'Read DOM from the web page, optionally filtered by CSS selector',
      inputSchema: z.object({
        selector: z.string().optional(),
        timeout: z.number().optional(),
      }),
    },
    // Tool handler — forwards the request to the JS Agent via WebSocket
    async ({ selector, timeout }) => {
      log('info', TAG, 'read-dom called', { selector, timeout });
      try {
        // Send READ_DOM command to the JS Agent with a 5s default timeout
        const response = await wsServer.sendToAgent('READ_DOM', {
          selector,
          timeout: timeout || 5000,
        });

        // If the agent reported an error, propagate it back to the caller
        if (response.error) {
          log('error', TAG, `Agent error: ${response.error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${response.error.message}\n${response.error.stack || ''}` }],
            isError: true,
          };
        }

        log('info', TAG, 'read-dom completed successfully');
        let result = response.result || '';

        // Truncate oversized responses to prevent memory issues
        if (result.length > MAX_RESPONSE_SIZE) {
          log('warn', TAG, `read-dom result truncated: ${result.length} bytes exceeds ${MAX_RESPONSE_SIZE} limit`);
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