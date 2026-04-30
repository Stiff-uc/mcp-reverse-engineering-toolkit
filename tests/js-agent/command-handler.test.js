import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createCommandHandler } from '../../src/js-agent/command-handler.js';

function mockDom(html) {
  globalThis.document = {
    documentElement: { outerHTML: html },
    title: 'Test Page',
    cookie: 'test=cookie',
    querySelectorAll(selector) {
      if (selector === '.nonexistent') {
        return { length: 0 };
      }
      const cls = selector.replace('.', '');
      return {
        length: 1,
        [Symbol.iterator]: function*() {
          yield { outerHTML: `<div class="${cls}">mocked</div>` };
        }
      };
    }
  };

  globalThis.window = {
    location: { href: 'https://test.example.com' }
  };

  globalThis.navigator = {
    userAgent: 'TestBrowser/1.0'
  };

  globalThis.localStorage = {
    length: 1,
    key: (i) => i === 0 ? 'testKey' : null,
    getItem: (k) => k === 'testKey' ? 'testValue' : null,
  };
}

function cleanupDom() {
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.navigator;
  delete globalThis.localStorage;
}

describe('command-handler (Node-safe tests)', () => {
  it('should throw on unknown command', async () => {
    const handler = createCommandHandler('0.1.0', null);
    try {
      await handler.handle('UNKNOWN', {});
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err.message).toContain('Unknown command');
    }
  });

  it('should handle EXECUTE_JS', async () => {
    const handler = createCommandHandler('0.1.0', null);
    const result = await handler.handle('EXECUTE_JS', { code: '1 + 1', timeout: 1000 });
    expect(result).toBe(2);
  });

  it('should handle EXECUTE_JS with errors', async () => {
    const handler = createCommandHandler('0.1.0', null);
    try {
      await handler.handle('EXECUTE_JS', { code: 'throw new Error("fail")', timeout: 1000 });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err.message).toBe('fail');
    }
  });

  it('should handle UPDATE_AGENT without code (version check)', async () => {
    const handler = createCommandHandler('0.1.0', null);
    const result = await handler.handle('UPDATE_AGENT', { code: '' });
    expect(result.version).toBe('0.1.0');
    expect(result.updated).toBe(false);
  });
});

describe('command-handler READ_DOM with mocked DOM', () => {
  beforeEach(() => {
    mockDom('<html><body><div class="main">content</div></body></html>');
  });

  afterEach(() => {
    cleanupDom();
  });

  it('should return full DOM when no selector provided', async () => {
    const handler = createCommandHandler('0.1.0', null);
    const result = await handler.handle('READ_DOM', {});
    expect(result).toContain('<html>');
    expect(result).toContain('</html>');
  });

  it('should return elements matching selector', async () => {
    const handler = createCommandHandler('0.1.0', null);
    const result = await handler.handle('READ_DOM', { selector: '.main' });
    expect(result).toContain('mocked');
  });

  it('should throw when no elements match selector', async () => {
    const handler = createCommandHandler('0.1.0', null);
    try {
      await handler.handle('READ_DOM', { selector: '.nonexistent' });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err.message).toContain('No elements found');
    }
  });
});

describe('command-handler GET_CONTEXT with mocked DOM', () => {
  beforeEach(() => {
    mockDom('<html><body>test</body></html>');
  });

  afterEach(() => {
    cleanupDom();
  });

  it('should return all context when no keys provided', async () => {
    const handler = createCommandHandler('0.1.0', null);
    const result = await handler.handle('GET_CONTEXT', {});
    expect(result.url).toBe('https://test.example.com');
    expect(result.title).toBe('Test Page');
    expect(result.cookies).toBe('test=cookie');
    expect(result.userAgent).toBe('TestBrowser/1.0');
    expect(result.localStorage).toEqual({ testKey: 'testValue' });
  });

  it('should filter by keys', async () => {
    const handler = createCommandHandler('0.1.0', null);
    const result = await handler.handle('GET_CONTEXT', { keys: ['url'] });
    expect(result.url).toBe('https://test.example.com');
    expect(result.title).toBeUndefined();
  });

  it('should include localStorage when requested', async () => {
    const handler = createCommandHandler('0.1.0', null);
    const result = await handler.handle('GET_CONTEXT', { keys: ['localStorage'] });
    expect(result.localStorage).toEqual({ testKey: 'testValue' });
    expect(result.url).toBeUndefined();
  });
});

describe('command-handler UPDATE_AGENT with reload callback', () => {
  beforeEach(() => {
    mockDom('<html><body>test</body></html>');
  });

  afterEach(() => {
    cleanupDom();
  });

  it('should call onReload callback when code provided', async () => {
    let reloadCalled = false;
    const reloadCb = () => { reloadCalled = true; };
    const handler = createCommandHandler('0.1.0', reloadCb);
    const result = await handler.handle('UPDATE_AGENT', { code: 'var x = 1;' });
    expect(result.updated).toBe(true);
    expect(reloadCalled).toBe(true);
  });
});