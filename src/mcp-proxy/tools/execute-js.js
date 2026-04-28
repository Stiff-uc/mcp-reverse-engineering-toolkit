export function registerExecuteJs(mcp, wsServer) {
  mcp.tool(
    'execute-js',
    'Execute arbitrary JavaScript in the browser context and return the result',
    {
      code: {
        type: 'string',
        description: 'JavaScript code to execute',
      },
    },
    async ({ code }) => {
      try {
        const response = await wsServer.sendToAgent('EXECUTE_JS', { code });
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