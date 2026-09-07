import { createServer } from 'node:http';

export function createHealthServer(isReady) {
  const server = createServer((request, response) => {
    if (request.url !== '/healthz') {
      response.writeHead(404).end();
      return;
    }
    const ready = Boolean(isReady());
    response.writeHead(ready ? 200 : 503, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify({ name: 'Pit-Stop', status: ready ? 'ready' : 'connecting' }));
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  return server;
}
