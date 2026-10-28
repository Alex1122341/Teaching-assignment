import { Buffer } from 'buffer';
export { Buffer };
export const process = { env: {}, platform: 'browser', versions: {}, nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)) };
