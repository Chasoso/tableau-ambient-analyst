import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT ?? 4173);
const root = join(dirname(fileURLToPath(import.meta.url)), '../../ui');
const browserRoot = dirname(fileURLToPath(import.meta.url));

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    .pathname;
  if (pathname.startsWith('/debug-ui/') && pathname.endsWith('.js')) {
    const filename = pathname.slice('/debug-ui/'.length);
    if (filename.includes('/') || filename.includes('\\')) {
      response.statusCode = 404;
      response.end('Not found');
      return;
    }
    response.setHeader('content-type', 'text/javascript; charset=utf-8');
    response.end(await readFile(join(browserRoot, filename)));
    return;
  }
  if (pathname === '/' || pathname === '/index.html') {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(await readFile(join(root, 'index.html')));
    return;
  }
  response.statusCode = 404;
  response.end('Not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Ambient Analyst debug UI: http://127.0.0.1:${port}`);
});
