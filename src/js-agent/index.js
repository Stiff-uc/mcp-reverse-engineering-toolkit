import { createConnection } from './connection.js';
import { createCommandHandler } from './command-handler.js';

const AGENT_VERSION = '0.1.0';

export function createJsAgent(wsUrl, options = {}) {
  const { isUpdate = false } = options;
  const state = { commandHandler: null, wsUrl, isUpdate, connected: false };

  function onReloadCallback(newCode) {
    window.__jsAgentPrevious = window.__jsAgent;
    return new Promise((resolve, reject) => {
      try {
        (0, eval)(newCode);
      } catch (e) {
        reject(new Error('Self-update failed: ' + e.message));
        return;
      }
      // Wait for new agent to connect before disconnecting old
      const checkNewAgent = setInterval(() => {
        if (window.__jsAgent && window.__jsAgent.isReady) {
          clearInterval(checkNewAgent);
          console.log('[JS-Agent] New agent confirmed connected, decommissioning old agent');
          connection.disconnect();
          resolve();
        }
      }, 100);
      // Fallback timeout — disconnect after 10s regardless
      setTimeout(() => {
        clearInterval(checkNewAgent);
        console.warn('[JS-Agent] New agent connect timeout, forcing old agent disconnect');
        connection.disconnect();
        resolve();
      }, 10000);
    });
  }

  state.commandHandler = createCommandHandler(AGENT_VERSION, onReloadCallback);

  const connection = createConnection(wsUrl, (msg) => {
    if (msg.type === 'ping') {
      connection.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    if (msg.type === 'request' && msg.id && msg.command) {
      const startTime = performance.now();
      const cmdId = msg.id.substring(0, 8);
      console.log(`[JS-Agent] ▶ ${msg.command} #${cmdId}`);

      state.commandHandler.handle(msg.command, msg.params || {})
        .then((result) => {
          const elapsed = (performance.now() - startTime).toFixed(1);
          let summary = String(result);
          if (summary.length > 120) summary = summary.substring(0, 120) + '...';
          console.log(`[JS-Agent] ✓ ${msg.command} #${cmdId} (${elapsed}ms) → ${summary}`);
          connection.send(JSON.stringify({
            type: 'response',
            id: msg.id,
            result,
            error: null,
          }));
        })
        .catch((error) => {
          const elapsed = (performance.now() - startTime).toFixed(1);
          console.error(`[JS-Agent] ✗ ${msg.command} #${cmdId} (${elapsed}ms) → ${error.message || String(error)}`);
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

  const agent = {
    start: () => connection.connect(),
    getVersion: () => AGENT_VERSION,
    isReady: false,
  };

  // Override start to set isReady flag on successful connect
  const originalStart = agent.start;
  agent.start = () => {
    return originalStart().then(() => {
      state.connected = true;
      agent.isReady = true;
      console.log(`[JS-Agent] Agent ready (version ${AGENT_VERSION})`);
    });
  };

  return agent;
}