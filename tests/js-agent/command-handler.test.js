import { describe, it, expect } from 'vitest';
import { createCommandHandler } from '../../src/js-agent/command-handler.js';

describe('command-handler (Node-safe tests)', () => {
  it('should throw on unknown command', async () => {
    const handler = createCommandHandler('0.1.0');
    try {
      await handler.handle('UNKNOWN', {});
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err.message).toContain('Unknown command');
    }
  });

  it('should handle EXECUTE_JS', async () => {
    const handler = createCommandHandler('0.1.0');
    const result = await handler.handle('EXECUTE_JS', { code: '1 + 1', timeout: 1000 });
    expect(result).toBe(2);
  });

  it('should handle EXECUTE_JS with errors', async () => {
    const handler = createCommandHandler('0.1.0');
    try {
      await handler.handle('EXECUTE_JS', { code: 'throw new Error("fail")', timeout: 1000 });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err.message).toBe('fail');
    }
  });

  it('should handle UPDATE_AGENT without code (version check)', async () => {
    const handler = createCommandHandler('0.1.0');
    const result = await handler.handle('UPDATE_AGENT', { code: '' });
    expect(result.version).toBe('0.1.0');
    expect(result.updated).toBe(false);
  });
});