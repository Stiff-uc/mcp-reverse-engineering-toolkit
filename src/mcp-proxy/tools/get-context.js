/**
 * Get Context Tool
 *
 * MCP tool that retrieves browser context data from the JS Agent, including:
 * current URL, page title, cookies, user agent, and localStorage contents.
 * Supports an optional keys array to filter which context fields are returned.
 */

import { z } from 'zod';
import { log, MAX_RESPONSE_SIZE } from '../config.js';

// Logging tag for get-context tool entries
const TAG = 'Tool:get-context';

/**
 * Register the 'get-context' tool with the MCP server.
 *
 * @param {McpServer} mcp - The MCP server instance
 * @param {Object} wsServer - WebSocket bridge for communicating with JS Agent
 */
export function registerGetContext(mcp, wsServer) {
  log('info', TAG, 'Registering get-context tool');
  mcp.registerTool(
    'get-context',
    {
      description:
        'Retrieve browser context data from the JS Agent running in the browser. ' +
        'Returns information such as current URL, page title, cookies, user agent, ' +
        'and localStorage contents. Use this tool to understand the current state ' +
        'of the browser session.',
      inputSchema: z.object({
        keys: z.array(z.string()).optional().describe(
          'Optional list of context keys to filter the response. ' +
          'Available keys: url, title, cookies, userAgent, localStorage. ' +
          'If not provided, all context data is returned.'
        ),
      }),
      annotations: {
        title: 'Get Context',
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    // Tool handler — forwards the request to the JS Agent via WebSocket
    async ({ keys }) => {
      log('info', TAG, 'get-context called', { keys });

      // Validate that keys is an array (if provided)
      if (keys && !Array.isArray(keys)) {
        log('warn', TAG, 'Invalid keys parameter');
        return {
          content: [{ type: 'text', text: 'Error: keys must be an array of strings' }],
          isError: true,
        };
      }

      try {
        // Send GET_CONTEXT command to the JS Agent
        const response = await wsServer.sendToAgent('GET_CONTEXT', { keys: keys || [] });

        // If the agent reported an error, propagate it back
        if (response.error) {
          log('error', TAG, `Agent error: ${response.error.message}`);
          return {
            content: [{
              type: 'text',
              text: `Error: ${response.error.message}\n${response.error.stack || ''}`,
            }],
            isError: true,
          };
        }

        log('info', TAG, 'get-context completed successfully');

        // Serialize the result as pretty-printed JSON
        let result = JSON.stringify(response.result, null, 2);

        // Truncate oversized responses to prevent memory issues
        if (result.length > MAX_RESPONSE_SIZE) {
          log('warn', TAG, `get-context result truncated: ${result.length} bytes exceeds ${MAX_RESPONSE_SIZE} limit`);
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