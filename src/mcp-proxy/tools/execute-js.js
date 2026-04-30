import { z } from 'zod';

export function registerExecuteJs(mcp, wsServer) {
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
      if (typeof code !== 'string' || !code) {
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
          return {
            content: [{
              type: 'text',
              text: `Execution error: ${response.error.message}\nStack: ${response.error.stack || ''}`,
            }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(response.result, null, 2) }],
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