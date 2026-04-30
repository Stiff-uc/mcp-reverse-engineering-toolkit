import { describe, it, expect } from 'vitest';
import { executeJs } from '../../src/js-agent/executor.js';

describe('executor', () => {
  it('should execute simple JS and return result', async () => {
    const result = await executeJs('1 + 2', 1000);
    expect(result).toBe(3);
  });

  it('should execute string operations', async () => {
    const result = await executeJs('"hello".toUpperCase()', 1000);
    expect(result).toBe('HELLO');
  });

  it('should throw on syntax error', async () => {
    await expect(executeJs('function {', 1000)).rejects.toThrow();
  });

  it('should throw on runtime error', async () => {
    await expect(executeJs('undefinedVar.foo()', 1000)).rejects.toThrow();
  });

  it('should execute and return objects', async () => {
    const result = await executeJs('({a: 1, b: "test"})', 1000);
    expect(result).toEqual({ a: 1, b: 'test' });
  });

  it('should execute and return arrays', async () => {
    const result = await executeJs('[1, 2, 3].map(x => x * 2)', 1000);
    expect(result).toEqual([2, 4, 6]);
  });

  it('should timeout on long-running async operation', async () => {
    await expect(executeJs('new Promise(r => setTimeout(r, 999999))', 100)).rejects.toThrow('timed out');
  });

  it('should handle async functions', async () => {
    const result = await executeJs('Promise.resolve(42)', 1000);
    expect(result).toBe(42);
  });

  it('should handle async functions that reject', async () => {
    await expect(executeJs('Promise.reject(new Error("async fail"))', 1000)).rejects.toThrow('async fail');
  });

  it('should capture stack trace on error', async () => {
    try {
      await executeJs('throw new Error("test error")', 1000);
    } catch (err) {
      expect(err.message).toBe('test error');
      expect(err.stack).toBeTruthy();
    }
  });

  it('should timeout on long-running async operation', async () => {
    await expect(executeJs('new Promise(r => setTimeout(r, 999999))', 100)).rejects.toThrow('timed out');
  });
});