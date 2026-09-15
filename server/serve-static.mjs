/**
 * A small static file server for local work: `npm start`.
 *
 * Serves public/ over http, which is all the game needs — it is plain files
 * and will sit happily behind any web server in production. This exists
 * because ES modules and fetch() do not work from file:// URLs, so opening
 * index.html directly from the file manager will not run the game.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export const PUBLIC_DIR = resolve(fileURLToPath(new URL('../public', import.meta.url)));

/**
 * @returns {Promise<boolean>} false when there is no such file, so a caller
 * that also handles API routes can answer with its own 404.
 */
export async function serveStatic(request, response, root = PUBLIC_DIR) {
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
  const requested = decodeURIComponent(url.pathname);

  // Keep the request inside the public directory whatever it asks for.
  const relative = normalize(requested).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  let target = join(root, relative);
  if (target !== root && !target.startsWith(root + sep)) {
    response.writeHead(403).end('Forbidden');
    return true;
  }

  let info = await stat(target).catch(() => null);
  if (info?.isDirectory()) {
    if (!requested.endsWith('/')) {
      response.writeHead(301, { location: `${requested}/${url.search}` }).end();
      return true;
    }
    target = join(target, 'index.html');
    info = await stat(target).catch(() => null);
  }
  if (!info?.isFile()) return false;

  response.writeHead(200, {
    'content-type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
    'content-length': info.size,
    'cache-control': 'no-cache',
  });
  createReadStream(target).pipe(response);
  return true;
}

function isMainModule() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const port = Number(process.env.PORT ?? 8080);
  createServer(async (request, response) => {
    const served = await serveStatic(request, response);
    if (!served) response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }).listen(port, () => {
    console.log(`GZAAT Wordette is at http://localhost:${port}/wordette/`);
  });
}
