import { z } from 'zod';
import { log, MAX_RESPONSE_SIZE } from '../config.js';

const TAG = 'Tool:get-context';

export function registerGetContext(mcp, wsServer) {
  log('info', TAG, 'Registering get-context tool');
  mcp.registerTool(
    'get-context',
    {
      description: 'Get context data from the JS Agent (URL, cookies, localStorage, etc.)',
      inputSchema: z.object({
        keys: z.array(z.string()).optional(),
      }),
    },
    async ({ keys }) => {
      log('info', TAG, 'get-context called', { keys });
      if (keys && !Array.isArray(keys)) {
        log('warn', TAG, 'Invalid keys parameter');
        return {
          content: [{ type: 'text', text: 'Error: keys must be an array of strings' }],
          isError: true,
        };
      }
      try {
        const response = await wsServer.sendToAgent('GET_CONTEXT', { keys: keys || [] });
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
        let result = JSON.stringify(response.result, null, 2);
        if (result.length > MAX_RESPONSE_SIZE) {
          log('warn', TAG, `get-context result truncated: ${result.length} bytes exceeds ${MAX_RESPONSE_SIZE} limit`);
          result = result.slice(0, MAX_RESPONSE_SIZE);
          result += '\n\n[TRUNCATED: response exceeded 50KB limit]';
        }
        return {
          content: [{ type: 'text', text: result }],
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