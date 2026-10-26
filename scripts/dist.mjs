// Copies only the files the site serves into dist/, the Vercel output directory.
// Everything else (api/, scripts/, posts/, node_modules/, configs, docs) stays out,
// so it can't be fetched as a static file. Run after build: `node scripts/dist.mjs`.
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');

// Every page, script, style, feed and media file the pages reference lives here.
const ALLOW = ['index.html', 'support.js', 'vendor', 'assets', 'blog', 'sitemap.xml', 'robots.txt'];
// OS clutter that can sit in assets/ locally; never part of the site.
const JUNK = new Set(['desktop.ini', 'Thumbs.db']);
const skip = (path) => basename(path).startsWith('.') || JUNK.has(basename(path));

// Second line of defence: none of these may end up in dist/, whatever ALLOW says.
const DENY = [/^api\//, /^scripts\//, /^posts\//, /^node_modules\//, /^research\//, /(^|\/)\./, /\.(md|mjs|cjs|ts|zip)$/, /(^|\/)package(-lock)?\.json$/, /(^|\/)vercel\.json$/];

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );

rmSync(out, { recursive: true, force: true });
for (const entry of ALLOW) {
  const from = join(root, entry);
  if (!existsSync(from)) throw new Error(`dist: missing ${entry} (run npm run build first)`);
  cpSync(from, join(out, entry), { recursive: true, filter: (src) => !skip(src) });
}

const files = walk(out).map((f) => relative(out, f).split('\\').join('/'));
const denied = files.filter((f) => DENY.some((re) => re.test(f)));
if (denied.length) throw new Error(`dist: not allowed in output: ${denied.join(', ')}`);

console.log(`dist: ${files.length} file(s) from ${ALLOW.join(', ')}`);
