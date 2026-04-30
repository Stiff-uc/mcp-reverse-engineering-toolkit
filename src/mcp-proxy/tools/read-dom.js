import { z } from 'zod';

export function registerReadDom(mcp, wsServer) {
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
      try {
        const response = await wsServer.sendToAgent('READ_DOM', {
          selector,
          timeout: timeout || 5000,
        });
        if (response.error) {
          return {
            content: [{ type: 'text', text: `Error: ${response.error.message}\n${response.error.stack || ''}` }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: response.result || '' }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    },
  );
}