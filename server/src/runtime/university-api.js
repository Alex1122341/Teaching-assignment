'use strict';

const { createSwaSqlRuntime } = require('./swa-sql-runtime');
const { createUniversityHttpServer } = require('./university-http-server');

function listenPort(env) {
  const value = env.PAWS_API_PORT === undefined ? '8787' : String(env.PAWS_API_PORT);
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error('PAWS_API_PORT must be an integer from 1 to 65535');
  }
  return Number(value);
}

function start() {
  const env = process.env;
  const runtime = createSwaSqlRuntime({ env });
  const server = createUniversityHttpServer({ runtime, env });
  const port = listenPort(env);
  const host = env.PAWS_API_HOST || '127.0.0.1';
  let stopping = false;

  server.listen(port, host, () => {
    console.log(JSON.stringify({ event: 'paws_api_listening', host, port }));
  });

  const shutdown = signal => {
    if (stopping) return;
    stopping = true;
    console.log(JSON.stringify({ event: 'paws_api_shutdown', signal }));
    const timeout = setTimeout(() => server.closeAllConnections(), 15000);
    timeout.unref();
    server.close(async error => {
      clearTimeout(timeout);
      try {
        await runtime.close();
      } catch (_) {
        console.error(JSON.stringify({ event: 'paws_api_sql_close_failed' }));
        process.exitCode = 1;
      }
      if (error) {
        console.error(JSON.stringify({ event: 'paws_api_http_close_failed' }));
        process.exitCode = 1;
      }
    });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  return server;
}

if (require.main === module) {
  try { start(); } catch (_) {
    console.error(JSON.stringify({ event: 'paws_api_start_failed' }));
    process.exitCode = 1;
  }
}

module.exports = { start, listenPort };
