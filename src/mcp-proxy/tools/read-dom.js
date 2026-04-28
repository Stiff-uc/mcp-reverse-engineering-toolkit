export function registerReadDom(mcp, wsServer) {
  mcp.tool(
    'read-dom',
    'Read DOM from the web page, optionally filtered by CSS selector',
    {
      selector: {
        type: 'string',
        description: 'Optional CSS selector to filter elements',
      },
    },
    async ({ selector }) => {
      try {
        const response = await wsServer.sendToAgent('READ_DOM', { selector });
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