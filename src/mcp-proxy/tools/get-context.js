export function registerGetContext(mcp, wsServer) {
  mcp.tool(
    'get-context',
    'Get context data from the JS Agent (URL, cookies, localStorage, etc.)',
    {
      keys: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of context keys to retrieve',
      },
    },
    async ({ keys }) => {
      if (keys && !Array.isArray(keys)) {
        return {
          content: [{ type: 'text', text: 'Error: keys must be an array of strings' }],
          isError: true,
        };
      }
      try {
        const response = await wsServer.sendToAgent('GET_CONTEXT', { keys: keys || [] });
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