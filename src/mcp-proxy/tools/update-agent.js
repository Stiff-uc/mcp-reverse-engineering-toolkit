/**
 * Update Agent Tool
 *
 * MCP tool that enables self-update of the JS Agent running in the browser.
 * When called with new code, the JS Agent evaluates and replaces itself.
 * When called without code, it returns the current agent version.
 */

import { z } from 'zod';
import { log, MAX_RESPONSE_SIZE } from '../config.js';

// Logging tag for update-agent tool entries
const TAG = 'Tool:update-agent';

/**
 * Register the 'update-agent' tool with the MCP server.
 *
 * @param {McpServer} mcp - The MCP server instance
 * @param {Object} wsServer - WebSocket bridge for communicating with JS Agent
 */
export function registerUpdateAgent(mcp, wsServer) {
  log('info', TAG, 'Registering update-agent tool');
  mcp.registerTool(
    'update-agent',
    {
      description: 'Update the JS Agent code or get its current version',
      inputSchema: z.object({
        code: z.string().optional(),
      }),
    },
    // Tool handler — forwards the request to the JS Agent via WebSocket
    async ({ code }) => {
      log('info', TAG, 'update-agent called', { hasCode: !!code });

      // Validate that code is a string (if provided)
      if (code !== undefined && typeof code !== 'string') {
        log('warn', TAG, 'update-agent called with invalid code type');
        return {
          content: [{ type: 'text', text: 'Error: code must be a string' }],
          isError: true,
        };
      }

      try {
        // Send UPDATE_AGENT command to the JS Agent
        const response = await wsServer.sendToAgent('UPDATE_AGENT', { code: code || '' });

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

        log('info', TAG, 'update-agent completed successfully');

        // Serialize the result as pretty-printed JSON
        let result = JSON.stringify(response.result, null, 2);

        // Truncate oversized responses to prevent memory issues
        if (result.length > MAX_RESPONSE_SIZE) {
          log('warn', TAG, `update-agent result truncated: ${result.length} bytes exceeds ${MAX_RESPONSE_SIZE} limit`);
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