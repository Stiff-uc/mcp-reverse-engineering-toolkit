/**
 * Get Context Save to File Tool
 *
 * MCP tool that retrieves data from the JS Agent (via execute-js) and saves
 * the result to a local file instead of returning it through the MCP protocol.
 * Useful when the data to extract is too large to transmit over the wire.
 * The file is overwritten each time to avoid mixing with previous data.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { z } from 'zod';
import { log } from '../config.js';

// Logging tag for get-context-ext tool entries
const TAG = 'Tool:get-context-ext';

/**
 * Register the 'get-context-ext' tool with the MCP server.
 *
 * @param {McpServer} mcp - The MCP server instance
 * @param {Object} wsServer - WebSocket bridge for communicating with JS Agent
 */
export function registerGetContextExt(mcp, wsServer) {
  log('info', TAG, 'Registering get-context-ext tool');
  mcp.registerTool(
    'get-context-ext',
    {
      description:
        'Execute JavaScript in the browser context and save the serialized result to a local file. ' +
        'Use this tool when the data extracted from the website is too large to return through the MCP chat protocol. ' +
        'The target file is overwritten each time — never appended to — preventing data mixing from previous extractions. ' +
        'Always use a unique filename containing a timestamp (pattern: <description>_<YYYYMMDD_HHMMSS>.json) ' +
        'to preserve previous extractions. The JavaScript code runs in the page context with full DOM access.',
      inputSchema: z.object({
        code: z.string().describe(
          'JavaScript code to execute in the browser context. ' +
          'The return value of this code will be JSON-serialized and written to the file. ' +
          'Can access DOM, window, localStorage, and any loaded scripts.'
        ),
        filePath: z.string().describe(
          'Path where the JSON-serialized result will be saved. ' +
          'The file is overwritten if it already exists. ' +
          'Use a unique timestamp-based filename to avoid losing previous data.'
        ),
        timeout: z.number().optional().describe(
          'Maximum execution time in milliseconds before the script is terminated. ' +
          'Default is 30000ms (30 seconds). Use higher values for data-heavy extractions.'
        ),
      }),
      annotations: {
        title: 'Get Context Save to File',
        readOnlyHint: false,
        idempotentHint: false,
      },
    },
    async ({ code, filePath, timeout }) => {
       log('info', TAG, 'get-context-ext called', { codeLen: code?.length, filePath, timeout });

       // Validate parameters
       if (typeof code !== 'string' || !code) {
         log('warn', TAG, 'get-context-ext called with empty code');
        return {
          content: [{ type: 'text', text: 'Error: code parameter is required and must be a string' }],
          isError: true,
        };
      }

       if (typeof filePath !== 'string' || !filePath) {
         log('warn', TAG, 'get-context-ext called with empty filePath');
        return {
          content: [{ type: 'text', text: 'Error: filePath parameter is required and must be a string' }],
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

        // Serialize result to JSON string
        const content = JSON.stringify(response.result, null, 2);

        // Create parent directory recursively if it doesn't exist
        const dir = dirname(filePath);
        if (dir && dir !== '.') {
          mkdirSync(dir, { recursive: true });
        }

        // Write to file (overwrites existing content)
        try {
          writeFileSync(filePath, content, 'utf-8');
          log('info', TAG, `Result saved to ${filePath} (${content.length} bytes)`);
        } catch (err) {
          log('error', TAG, `Failed to write file: ${err.message}`);
          return {
            content: [{ type: 'text', text: `Error writing file: ${err.message}` }],
            isError: true,
          };
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              filePath,
              bytesWritten: content.length,
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
