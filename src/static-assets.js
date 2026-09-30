import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const cache = new Map();

export async function serveStaticAsset(request, response, path, type) {
  const info = await stat(path);
  const version = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  let asset = cache.get(path);
  if (asset?.version !== version) {
    const body = await readFile(path);
    const compress = /^(?:text\/|application\/javascript)/u.test(type) && body.length > 1024;
    asset = { version, body, gzip: compress ? gzipSync(body) : null, etag: `W/"${createHash('sha256').update(body).digest('hex')}"` };
    cache.set(path, asset);
  }
  const html = type.startsWith('text/html');
  const headers = { 'Content-Type': type, 'Cache-Control': html ? 'no-store' : 'no-cache' };
  if (asset.gzip) headers.Vary = 'Accept-Encoding';
  if (!html) {
    headers.ETag = asset.etag;
    if (request.headers['if-none-match']?.split(',').some(value => value.trim() === asset.etag || value.trim() === '*')) {
      response.writeHead(304, headers);
      response.end();
      return;
    }
  }
  const acceptsGzip = request.headers['accept-encoding']?.split(',').some(value => /^gzip(?:\s*;\s*q=(?:1(?:\.0*)?|0\.[0-9]*[1-9][0-9]*))?$/u.test(value.trim()));
  const body = acceptsGzip && asset.gzip ? asset.gzip : asset.body;
  if (body === asset.gzip) headers['Content-Encoding'] = 'gzip';
  response.writeHead(200, { ...headers, 'Content-Length': body.length });
  response.end(request.method === 'HEAD' ? undefined : body);
}
