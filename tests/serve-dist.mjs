// Playwright web server: builds the site the way Vercel does, then serves dist/
// on 127.0.0.1 only. No access log, so nothing from the requests ends up in the output.
import { execSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const port = Number(process.env.TEST_PORT || 8079);

for (const step of ['build', 'check', 'dist']) {
  execSync(`npm run ${step}`, { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.woff2': 'font/woff2',
};

createServer((req, res) => {
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return res.writeHead(400).end();
  }
  const file = normalize(join(dist, path));
  if (file !== dist && !file.startsWith(dist + sep)) return res.writeHead(404).end();
  if (existsSync(file) && statSync(file).isDirectory()) {
    // Same as Vercel's trailingSlash: true.
    if (!path.endsWith('/')) return res.writeHead(308, { Location: `${path}/` }).end();
    return send(res, join(file, 'index.html'));
  }
  send(res, file);
}).listen(port, '127.0.0.1', () => console.log(`serving dist/ on http://127.0.0.1:${port}/`));

function send(res, file) {
  if (!existsSync(file) || !statSync(file).isFile()) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
}
