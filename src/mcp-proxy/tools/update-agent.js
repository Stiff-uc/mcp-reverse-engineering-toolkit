export function registerUpdateAgent(mcp, wsServer) {
  mcp.tool(
    'update-agent',
    'Update the JS Agent code or get its current version',
    {
      code: {
        type: 'string',
        description: 'New JS Agent source code to push. If empty, returns current version',
      },
    },
    async ({ code }) => {
      try {
        const response = await wsServer.sendToAgent('UPDATE_AGENT', { code: code || '' });
        if (response.error) {
          return {
            content: [{
              type: 'text',
              text: `Error: ${response.error.message}\n${response.error.stack || ''}`,
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