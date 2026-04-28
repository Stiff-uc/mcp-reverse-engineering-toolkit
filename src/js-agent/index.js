import { createConnection } from './connection.js';
import { createCommandHandler } from './command-handler.js';

const AGENT_VERSION = '0.1.0';

export function createJsAgent(wsUrl) {
  const commandHandler = createCommandHandler(AGENT_VERSION);

  const connection = createConnection(wsUrl, (msg) => {
    if (msg.type === 'ping') {
      connection.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    if (msg.type === 'request' && msg.id && msg.command) {
      commandHandler.handle(msg.command, msg.params || {})
        .then((result) => {
          connection.send(JSON.stringify({
            type: 'response',
            id: msg.id,
            result,
            error: null,
          }));
        })
        .catch((error) => {
          connection.send(JSON.stringify({
            type: 'response',
            id: msg.id,
            result: null,
            error: {
              message: error.message || String(error),
              stack: error.stack || '',
            },
          }));
        });
    }
  });

  return {
    start: () => connection.connect(),
    getVersion: () => AGENT_VERSION,
  };
}