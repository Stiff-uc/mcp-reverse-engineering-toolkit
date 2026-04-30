export function executeJs(code, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer = null;

    const timeoutPromise = new Promise((_, rejectTimeout) => {
      timer = setTimeout(() => {
        rejectTimeout(new Error(`Script execution timed out after ${timeoutMs}ms`));
      }, timeoutMs || Number.MAX_SAFE_INTEGER);
    });

    try {
      const result = (0, eval)(code);
      if (result instanceof Promise) {
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
        clearTimeout(timer);
        resolve(result);
      }
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}