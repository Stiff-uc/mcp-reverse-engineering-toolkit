export function executeJs(code, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer = null;

    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        reject(new Error(`Script execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    try {
      const result = (0, eval)(code);
      if (result instanceof Promise) {
        result
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