/**
 * JavaScript Executor
 *
 * Safely executes JavaScript code in the browser context with timeout protection.
 * Supports both synchronous and async (Promise-returning) code.
 * All execution is wrapped in try/catch for error capture.
 */

/**
 * Execute JavaScript code with a timeout guard.
 *
 * Uses `eval` in the current browser context. If the evaluated code returns
 * a Promise, races it against the timeout. Synchronous results are returned immediately.
 *
 * @param {string} code - JavaScript source code to execute
 * @param {number} timeoutMs - Maximum execution time in milliseconds
 * @returns {Promise<any>} Result of the executed code
 * @throws {Error} If execution fails or times out
 */
export function executeJs(code, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer = null;

    // Create a promise that rejects after the timeout duration
    const timeoutPromise = new Promise((_, rejectTimeout) => {
      timer = setTimeout(() => {
        rejectTimeout(new Error(`Script execution timed out after ${timeoutMs}ms`));
      }, timeoutMs || Number.MAX_SAFE_INTEGER);
    });

    try {
      // Evaluate the code in the current browser context
      const result = (0, eval)(code);

      if (result instanceof Promise) {
        // Async code — race the result against the timeout
        Promise.race([result, timeoutPromise])
          .then((val) => {
            clearTimeout(timer);
            resolve(val);
          })
          .catch((err) => {
            clearTimeout(timer);
            reject(err);
          });
      } else {
        // Synchronous code — clear timer and resolve immediately
        clearTimeout(timer);
        resolve(result);
      }
    } catch (err) {
      // Evaluation failed — clear timer and reject with the error
      clearTimeout(timer);
      reject(err);
    }
  });
}