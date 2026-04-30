import { z } from 'zod';
import { log } from '../config.js';

const TAG = 'Tool:read-dom';

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
    async ({ selector, timeout }) => {
      log('info', TAG, 'read-dom called', { selector, timeout });
      try {
        const response = await wsServer.sendToAgent('READ_DOM', {
          selector,
          timeout: timeout || 5000,
        });
        if (response.error) {
          log('error', TAG, `Agent error: ${response.error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${response.error.message}\n${response.error.stack || ''}` }],
            isError: true,
          };
        }
        log('info', TAG, 'read-dom completed successfully');
        return {
          content: [{ type: 'text', text: response.result || '' }],
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