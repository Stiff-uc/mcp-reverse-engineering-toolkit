import { z } from 'zod';
import { log } from '../config.js';

const TAG = 'Tool:execute-js';

export function registerExecuteJs(mcp, wsServer) {
  log('info', TAG, 'Registering execute-js tool');
  mcp.registerTool(
    'execute-js',
    {
      description: 'Execute arbitrary JavaScript in the browser context and return the result',
      inputSchema: z.object({
        code: z.string(),
        timeout: z.number().optional(),
      }),
    },
    async ({ code, timeout }) => {
      log('info', TAG, 'execute-js called', { codeLen: code?.length, timeout });
      if (typeof code !== 'string' || !code) {
        log('warn', TAG, 'execute-js called with empty code');
        return {
          content: [{ type: 'text', text: 'Error: code parameter is required and must be a string' }],
          isError: true,
        };
      }
      try {
        const response = await wsServer.sendToAgent('EXECUTE_JS', {
          code,
          timeout: timeout || 10000,
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
        log('info', TAG, 'execute-js completed successfully');
        return {
          content: [{ type: 'text', text: JSON.stringify(response.result, null, 2) }],
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