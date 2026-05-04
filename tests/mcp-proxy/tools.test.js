import { describe, it, expect, beforeEach } from 'vitest';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { WebSocketServer } from 'ws';
import { WebSocket } from 'ws';

const MAX_RESPONSE_SIZE = 50 * 1024;

const TEST_FILE = 'test-temp-output.json';
const TEST_INPUT_FILE = 'test-temp-input.js';

function cleanupTestFiles() {
  if (existsSync(TEST_FILE)) {
    unlinkSync(TEST_FILE);
  }
  if (existsSync(TEST_INPUT_FILE)) {
    unlinkSync(TEST_INPUT_FILE);
  }
}

function createMockMCP() {
  const tools = new Map();
  return {
    registerTool(name, schema, handler) {
      tools.set(name, { schema, handler });
    },
    getTool(name) {
      return tools.get(name);
    },
  };
}

function createWsServerAndAgent(port) {
  const wsServer = new WebSocketServer({ port });
  const clients = new Set();

  wsServer.on('connection', (ws) => {
    clients.add(ws);
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === 'response' && msg.id) {
        // echo back for testing
      }
    });
    ws.on('close', () => clients.delete(ws));
  });

  async function sendToAgent(command, params, timeout = 30000) {
    if (clients.size === 0) {
      throw new Error('No JS Agent connected');
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Request ${command} timed out after ${timeout}ms`));
      }, timeout);
      // Simulate agent response after a tick
      setImmediate(() => {
        clearTimeout(timer);
        resolve({ result: params?.result || null, error: null });
      });
    });
  }

  return { wsServer, sendToAgent, close: () => { wsServer.close(); } };
}

function waitForServer(port, retries = 20) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    function tryConnect() {
      const ws = new WebSocket(`ws://localhost:${port}`);
      ws.on('open', () => { ws.close(); resolve(); });
      ws.on('error', () => {
        if (++attempt >= retries) reject(new Error('Server not ready'));
        else setTimeout(tryConnect, 50);
      });
    }
    tryConnect();
  });
}

// --- read-dom ---
describe('read-dom tool', () => {
  let mockMCP;
  let sendToAgent;

  beforeEach(async () => {
    const port = 13000 + Math.floor(Math.random() * 500);
    const { wsServer, sendToAgent: s2a } = createWsServerAndAgent(port);
    sendToAgent = s2a;
    await waitForServer(port);
    mockMCP = createMockMCP();

    const { registerReadDom } = await import('../../src/mcp-proxy/tools/read-dom.js');
    registerReadDom(mockMCP, { sendToAgent });
  });

  it('should return result as-is when under 50KB', async () => {
    const tool = mockMCP.getTool('read-dom');
    const smallHtml = '<div>hello</div>'.repeat(100);
    expect(smallHtml.length).toBeLessThan(MAX_RESPONSE_SIZE);

    const originalSendToAgent = sendToAgent;
    const mockSendToAgent = async () => ({
      result: smallHtml,
      error: null,
    });

    // Re-register with mock
    const { registerReadDom } = await import('../../src/mcp-proxy/tools/read-dom.js');
    const m = createMockMCP();
    registerReadDom(m, { sendToAgent: mockSendToAgent });
    const t = m.getTool('read-dom');

    const result = await t.handler({});
    expect(!result.isError).toBe(true);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toBe(smallHtml);
  });

  it('should truncate result when over 50KB', async () => {
    const largeHtml = 'X'.repeat(MAX_RESPONSE_SIZE + 1000);
    expect(largeHtml.length).toBeGreaterThan(MAX_RESPONSE_SIZE);

    const m = createMockMCP();
    const { registerReadDom } = await import('../../src/mcp-proxy/tools/read-dom.js');
    registerReadDom(m, {
      sendToAgent: async () => ({ result: largeHtml, error: null }),
    });
    const t = m.getTool('read-dom');

    const result = await t.handler({});
    expect(!result.isError).toBe(true);
    expect(result.content[0].text.length).toBeGreaterThan(MAX_RESPONSE_SIZE);
    expect(result.content[0].text).toContain('[TRUNCATED: response exceeded 50KB limit]');
    expect(result.content[0].text.startsWith('X')).toBe(true);
  });

  it('should return error when agent returns error', async () => {
    const m = createMockMCP();
    const { registerReadDom } = await import('../../src/mcp-proxy/tools/read-dom.js');
    registerReadDom(m, {
      sendToAgent: async () => ({
        result: null,
        error: { message: 'Timeout', stack: 'at timeout' },
      }),
    });
    const t = m.getTool('read-dom');

    const result = await t.handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error: Timeout');
  });
});

// --- execute-js ---
describe('execute-js tool', () => {
  it('should return result as-is when under 50KB', async () => {
    const smallResult = { data: 'hello', items: [1, 2, 3] };
    const jsonStr = JSON.stringify(smallResult, null, 2);
    expect(jsonStr.length).toBeLessThan(MAX_RESPONSE_SIZE);

    const m = createMockMCP();
    const { registerExecuteJs } = await import('../../src/mcp-proxy/tools/execute-js.js');
    registerExecuteJs(m, {
      sendToAgent: async () => ({ result: smallResult, error: null }),
    });
    const t = m.getTool('execute-js');

    const result = await t.handler({ code: '42' });
    expect(!result.isError).toBe(true);
    expect(result.content[0].text).toBe(jsonStr);
  });

  it('should truncate result when over 50KB', async () => {
    const largeResult = 'Y'.repeat(MAX_RESPONSE_SIZE + 500);
    const m = createMockMCP();
    const { registerExecuteJs } = await import('../../src/mcp-proxy/tools/execute-js.js');
    registerExecuteJs(m, {
      sendToAgent: async () => ({ result: largeResult, error: null }),
    });
    const t = m.getTool('execute-js');

    const result = await t.handler({ code: '42' });
    expect(!result.isError).toBe(true);
    expect(result.content[0].text.length).toBeGreaterThan(MAX_RESPONSE_SIZE);
    expect(result.content[0].text).toContain('[TRUNCATED: response exceeded 50KB limit]');
  });

  it('should reject empty code parameter', async () => {
    const m = createMockMCP();
    const { registerExecuteJs } = await import('../../src/mcp-proxy/tools/execute-js.js');
    registerExecuteJs(m, { sendToAgent: async () => ({}) });
    const t = m.getTool('execute-js');

    const result = await t.handler({ code: '' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('code parameter is required');
  });

  it('should return execution error from agent', async () => {
    const m = createMockMCP();
    const { registerExecuteJs } = await import('../../src/mcp-proxy/tools/execute-js.js');
    registerExecuteJs(m, {
      sendToAgent: async () => ({
        result: null,
        error: { message: 'ReferenceError: foo is not defined', stack: 'at line 1' },
      }),
    });
    const t = m.getTool('execute-js');

    const result = await t.handler({ code: 'foo' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Execution error: ReferenceError');
  });
});

// --- get-context ---
describe('get-context tool', () => {
  it('should return result as-is when under 50KB', async () => {
    const contextData = { url: 'https://example.com', title: 'Example', cookies: {} };
    const jsonStr = JSON.stringify(contextData, null, 2);
    expect(jsonStr.length).toBeLessThan(MAX_RESPONSE_SIZE);

    const m = createMockMCP();
    const { registerGetContext } = await import('../../src/mcp-proxy/tools/get-context.js');
    registerGetContext(m, {
      sendToAgent: async () => ({ result: contextData, error: null }),
    });
    const t = m.getTool('get-context');

    const result = await t.handler({ keys: ['url', 'title'] });
    expect(!result.isError).toBe(true);
    expect(result.content[0].text).toBe(jsonStr);
  });

  it('should truncate result when over 50KB', async () => {
    const largeData = 'Z'.repeat(MAX_RESPONSE_SIZE + 800);
    const m = createMockMCP();
    const { registerGetContext } = await import('../../src/mcp-proxy/tools/get-context.js');
    registerGetContext(m, {
      sendToAgent: async () => ({ result: largeData, error: null }),
    });
    const t = m.getTool('get-context');

    const result = await t.handler({});
    expect(!result.isError).toBe(true);
    expect(result.content[0].text.length).toBeGreaterThan(MAX_RESPONSE_SIZE);
    expect(result.content[0].text).toContain('[TRUNCATED: response exceeded 50KB limit]');
  });

  it('should reject invalid keys parameter', async () => {
    const m = createMockMCP();
    const { registerGetContext } = await import('../../src/mcp-proxy/tools/get-context.js');
    registerGetContext(m, { sendToAgent: async () => ({}) });
    const t = m.getTool('get-context');

    const result = await t.handler({ keys: 'not-an-array' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('keys must be an array');
  });
});

// --- update-agent ---
describe('update-agent tool', () => {
  it('should return result as-is when under 50KB', async () => {
    const versionResult = { version: '0.1.0', status: 'ok' };
    const jsonStr = JSON.stringify(versionResult, null, 2);

    const m = createMockMCP();
    const { registerUpdateAgent } = await import('../../src/mcp-proxy/tools/update-agent.js');
    registerUpdateAgent(m, {
      sendToAgent: async () => ({ result: versionResult, error: null }),
    });
    const t = m.getTool('update-agent');

    const result = await t.handler({});
    expect(!result.isError).toBe(true);
    expect(result.content[0].text).toBe(jsonStr);
  });

  it('should truncate result when over 50KB', async () => {
    const largeResult = 'W'.repeat(MAX_RESPONSE_SIZE + 600);
    const m = createMockMCP();
    const { registerUpdateAgent } = await import('../../src/mcp-proxy/tools/update-agent.js');
    registerUpdateAgent(m, {
      sendToAgent: async () => ({ result: largeResult, error: null }),
    });
    const t = m.getTool('update-agent');

    const result = await t.handler({});
    expect(!result.isError).toBe(true);
    expect(result.content[0].text.length).toBeGreaterThan(MAX_RESPONSE_SIZE);
    expect(result.content[0].text).toContain('[TRUNCATED: response exceeded 50KB limit]');
  });

  it('should reject invalid code type', async () => {
    const m = createMockMCP();
    const { registerUpdateAgent } = await import('../../src/mcp-proxy/tools/update-agent.js');
    registerUpdateAgent(m, { sendToAgent: async () => ({}) });
    const t = m.getTool('update-agent');

    const result = await t.handler({ code: 123 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('code must be a string');
  });
});

// --- execute-js-ext ---
describe('execute-js-ext tool', () => {
  it('should execute code from file successfully', async () => {
    writeFileSync(TEST_INPUT_FILE, 'return { test: 42 };', 'utf-8');
    
    const m = createMockMCP();
    const { registerExecuteJsExt } = await import('../../src/mcp-proxy/tools/execute-js-ext.js');
    registerExecuteJsExt(m, {
      sendToAgent: async () => ({ result: { test: 42 }, error: null }),
    });
    const t = m.getTool('execute-js-ext');

    const result = await t.handler({ filePath: TEST_INPUT_FILE });
    expect(!result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    
    cleanupTestFiles();
  });

  it('should reject empty filePath parameter', async () => {
    const m = createMockMCP();
    const { registerExecuteJsExt } = await import('../../src/mcp-proxy/tools/execute-js-ext.js');
    registerExecuteJsExt(m, { sendToAgent: async () => ({}) });
    const t = m.getTool('execute-js-ext');

    const result = await t.handler({ filePath: '' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('filePath parameter is required');
  });

  it('should return error when file not found', async () => {
    const m = createMockMCP();
    const { registerExecuteJsExt } = await import('../../src/mcp-proxy/tools/execute-js-ext.js');
    registerExecuteJsExt(m, { sendToAgent: async () => ({}) });
    const t = m.getTool('execute-js-ext');

    const result = await t.handler({ filePath: 'nonexistent-file.js' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error reading file');
  });

  it('should return execution error from agent', async () => {
    writeFileSync(TEST_INPUT_FILE, 'throw new Error("fail");', 'utf-8');

    const m = createMockMCP();
    const { registerExecuteJsExt } = await import('../../src/mcp-proxy/tools/execute-js-ext.js');
    registerExecuteJsExt(m, {
      sendToAgent: async () => ({
        result: null,
        error: { message: 'ReferenceError: x is not defined', stack: 'at line 1' },
      }),
    });
    const t = m.getTool('execute-js-ext');

    const result = await t.handler({ filePath: TEST_INPUT_FILE });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Execution error: ReferenceError');
    
    cleanupTestFiles();
  });
});

// --- get-context-ext ---
describe('get-context-ext tool', () => {
  beforeEach(() => {
    cleanupTestFiles();
  });

  it('should save result to file successfully', async () => {
    const testData = { items: [1, 2, 3], name: 'test' };

    const m = createMockMCP();
    const { registerGetContextExt } = await import('../../src/mcp-proxy/tools/get-context-ext.js');
    registerGetContextExt(m, {
      sendToAgent: async () => ({ result: testData, error: null }),
    });
    const t = m.getTool('get-context-ext');

    const result = await t.handler({ code: 'return data;', filePath: TEST_FILE });
    expect(!result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.filePath).toBe(TEST_FILE);
    expect(parsed.bytesWritten).toBeGreaterThan(0);

    // Verify file was created with correct content
    expect(existsSync(TEST_FILE)).toBe(true);
    const fileContent = JSON.parse(readFileSync(TEST_FILE, 'utf-8'));
    expect(fileContent).toEqual(testData);

    cleanupTestFiles();
  });

  it('should overwrite existing file content', async () => {
    // Create file with initial content
    writeFileSync(TEST_FILE, JSON.stringify({ old: 'data' }), 'utf-8');
    expect(readFileSync(TEST_FILE, 'utf-8')).toContain('old');

    const m = createMockMCP();
    const { registerGetContextExt } = await import('../../src/mcp-proxy/tools/get-context-ext.js');
    registerGetContextExt(m, {
      sendToAgent: async () => ({ result: { new: 'data' }, error: null }),
    });
    const t = m.getTool('get-context-ext');

    await t.handler({ code: 'return data;', filePath: TEST_FILE });

    // Verify file was overwritten
    const fileContent = JSON.parse(readFileSync(TEST_FILE, 'utf-8'));
    expect(fileContent).toEqual({ new: 'data' });
    expect(fileContent.old).toBeUndefined();

    cleanupTestFiles();
  });

  it('should reject empty code parameter', async () => {
    const m = createMockMCP();
    const { registerGetContextExt } = await import('../../src/mcp-proxy/tools/get-context-ext.js');
    registerGetContextExt(m, { sendToAgent: async () => ({}) });
    const t = m.getTool('get-context-ext');

    const result = await t.handler({ code: '', filePath: TEST_FILE });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('code parameter is required');
  });

  it('should reject empty filePath parameter', async () => {
    const m = createMockMCP();
    const { registerGetContextExt } = await import('../../src/mcp-proxy/tools/get-context-ext.js');
    registerGetContextExt(m, { sendToAgent: async () => ({}) });
    const t = m.getTool('get-context-ext');

    const result = await t.handler({ code: 'return 1;', filePath: '' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('filePath parameter is required');
  });

  it('should return execution error from agent', async () => {
    const m = createMockMCP();
    const { registerGetContextExt } = await import('../../src/mcp-proxy/tools/get-context-ext.js');
    registerGetContextExt(m, {
      sendToAgent: async () => ({
        result: null,
        error: { message: 'TypeError: cannot read', stack: 'at line 5' },
      }),
    });
    const t = m.getTool('get-context-ext');

    const result = await t.handler({ code: 'return x.y;', filePath: TEST_FILE });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Execution error: TypeError');
  });
});
