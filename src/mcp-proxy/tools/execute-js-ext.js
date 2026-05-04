/**
 * Execute JS from File Tool
 *
 * MCP tool that reads JavaScript code from a local file and executes it
 * inside the browser context of the JS Agent. Useful when the code to
 * execute is too large to pass directly through the MCP protocol.
 */

import { readFileSync } from 'fs';
import { z } from 'zod';
import { log } from '../config.js';

// Logging tag for execute-js-ext tool entries
const TAG = 'Tool:execute-js-ext';

/**
 * Register the 'execute-js-ext' tool with the MCP server.
 *
 * @param {McpServer} mcp - The MCP server instance
 * @param {Object} wsServer - WebSocket bridge for communicating with JS Agent
 */
export function registerExecuteJsExt(mcp, wsServer) {
  log('info', TAG, 'Registering execute-js-ext tool');
  mcp.registerTool(
    'execute-js-ext',
    {
      description:
        'Read JavaScript code from a local file and execute it inside the browser context of the JS Agent. ' +
        'Use this tool when the code to execute is too large to pass inline through the MCP protocol, ' +
        'such as complex data loaders, scrapers, or multi-step automation scripts. ' +
        'The file path should point to a file on the server filesystem containing valid JavaScript code. ' +
        'The code runs in the page runtime with full access to DOM and browser APIs. ' +
        'Returns a summary of execution rather than the full result.',
      inputSchema: z.object({
        filePath: z.string().describe(
          'Path to the JavaScript file to read and execute in the browser context. ' +
          'The file must exist and contain valid JavaScript code.'
        ),
        timeout: z.number().optional().describe(
          'Maximum execution time in milliseconds before the script is terminated. ' +
          'Default is 30000ms (30 seconds). Use higher values for long-running operations.'
        ),
      }),
      annotations: {
        title: 'Execute JS from File',
        readOnlyHint: false,
        idempotentHint: false,
      },
    },
    async ({ filePath, timeout }) => {
       log('info', TAG, 'execute-js-ext called', { filePath, timeout });

       // Validate filePath parameter
       if (typeof filePath !== 'string' || !filePath) {
         log('warn', TAG, 'execute-js-ext called with empty filePath');
        return {
          content: [{ type: 'text', text: 'Error: filePath parameter is required and must be a string' }],
          isError: true,
        };
      }

      // Read code from file
      let code;
      try {
        code = readFileSync(filePath, 'utf-8');
        log('debug', TAG, `Read ${code.length} bytes from ${filePath}`);
      } catch (err) {
        log('error', TAG, `Failed to read file: ${err.message}`);
        return {
          content: [{ type: 'text', text: `Error reading file: ${err.message}` }],
          isError: true,
        };
      }

      // Execute the code via the JS Agent
      try {
        const response = await wsServer.sendToAgent('EXECUTE_JS', {
          code,
          timeout: timeout || 30000,
        });

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

        log('info', TAG, 'execute-js-ext completed successfully');

        // Return a summary rather than the full result
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              executedBytes: code.length,
              resultSummary: typeof response.result === 'object'
                ? Object.keys(response.result || {}).slice(0, 20)
                : String(response.result).slice(0, 500),
            }, null, 2),
          }],
        };
      } catch (err) {
        log('error', TAG, `Request failed: ${err.message}`);
        return {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    },
  );
}
