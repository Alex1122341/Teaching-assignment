'use strict';
// Browser stand-in for node:fs. Only the approved-AFC PDF template is read, and
// the demo loads its bytes from the published site before rendering.
const files = new Map();
module.exports = {
  __preload(name, bytes) { files.set(name, bytes); },
  readFileSync(path) { const name = String(path).split(/[\\/]/).pop(); if (files.has(name)) return files.get(name); throw Object.assign(new Error(`File not available in the Frontend Demo: ${name}`), { code: 'ENOENT' }); },
  existsSync(path) { return files.has(String(path).split(/[\\/]/).pop()); },
  promises: {}
};
