export function registerExecuteJs(mcp, wsServer) {
  mcp.tool(
    'execute-js',
    'Execute arbitrary JavaScript in the browser context and return the result',
    {
      code: {
        type: 'string',
        description: 'JavaScript code to execute',
      },
      timeout: {
        type: 'number',
        description: 'Maximum execution time in milliseconds',
      },
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