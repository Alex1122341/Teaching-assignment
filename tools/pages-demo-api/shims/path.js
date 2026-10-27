'use strict';
const norm = parts => parts.filter(Boolean).join('/').replace(/\/+/g, '/');
module.exports = { join: (...p) => norm(p), resolve: (...p) => norm(p), dirname: p => String(p).split('/').slice(0, -1).join('/') || '/', basename: (p, ext) => { const b = String(p).split(/[\\/]/).pop(); return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; }, extname: p => { const m = /\.[^./]*$/.exec(String(p)); return m ? m[0] : ''; }, sep: '/', posix: null };
module.exports.posix = module.exports;
