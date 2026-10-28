class AsyncLocalStorage { getStore() { return undefined; } run(_store, fn, ...args) { return fn(...args); } }
module.exports = { AsyncLocalStorage };
