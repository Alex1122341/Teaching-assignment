'use strict';
// Stand-in for server-only modules (SQL driver, worker threads, workbook
// parsers, Firebase Admin). Anything that reaches them in the browser fails
// with a clear, typed error instead of a crash at load time.
const fail = () => { throw Object.assign(new Error('This operation runs on the PAWS server and is not available in the Frontend Demo.'), { code: 'APPROVED_SOURCE_REQUIRED' }); };
const stub = new Proxy(function () { fail(); }, { get: (_, key) => key === '__esModule' ? false : key === 'then' ? undefined : stub, construct: fail, apply: fail });
module.exports = stub;
