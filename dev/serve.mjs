#!/usr/bin/env node
// Tiny static server for dev/harness.html (no dependencies). Serves the repository
// root on 127.0.0.1 so the harness can fetch the pages, modules and fixtures.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.PORT) || 8765;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.md': 'text/plain; charset=utf-8'
};

createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const relative = normalize(pathname).split(sep).filter((part) => part && part !== '..').join(sep);
  const file = join(root, relative || join('dev', 'harness.html'));
  let stat;
  try { stat = statSync(file); } catch { res.writeHead(404); return res.end('not found'); }
  if (stat.isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  return createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`Harness: http://127.0.0.1:${port}/dev/harness.html`));
