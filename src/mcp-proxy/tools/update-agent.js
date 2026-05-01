import { z } from 'zod';
import { log, MAX_RESPONSE_SIZE } from '../config.js';

const TAG = 'Tool:update-agent';

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
    async ({ code }) => {
      log('info', TAG, 'update-agent called', { hasCode: !!code });
      if (code !== undefined && typeof code !== 'string') {
        log('warn', TAG, 'update-agent called with invalid code type');
        return {
          content: [{ type: 'text', text: 'Error: code must be a string' }],
          isError: true,
        };
      }
      try {
        const response = await wsServer.sendToAgent('UPDATE_AGENT', { code: code || '' });
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
        let result = JSON.stringify(response.result, null, 2);
        if (result.length > MAX_RESPONSE_SIZE) {
          log('warn', TAG, `update-agent result truncated: ${result.length} bytes exceeds ${MAX_RESPONSE_SIZE} limit`);
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