// Copies only the files the site serves into dist/, the Vercel output directory.
// Everything else (api/, scripts/, posts/, node_modules/, configs, docs) stays out,
// so it can't be fetched as a static file. Run after build: `node scripts/dist.mjs`.
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');

// Every page, script, style, feed and media file the pages reference lives here.
const ALLOW = ['index.html', 'support.js', 'vendor', 'assets', 'blog', 'cabinet', 'sitemap.xml', 'robots.txt'];
// Browser build of supabase-js for the cabinet, at the version pinned by package-lock.json.
const SUPABASE_BROWSER = 'node_modules/@supabase/supabase-js/dist/umd/supabase.js';
// OS clutter that can sit in assets/ locally; never part of the site.
const JUNK = new Set(['desktop.ini', 'Thumbs.db']);
const skip = (path) => basename(path).startsWith('.') || JUNK.has(basename(path));

// Second line of defence: none of these may end up in dist/, whatever ALLOW says.
const DENY = [/^api\//, /^scripts\//, /^posts\//, /^node_modules\//, /^research\//, /^supabase\//, /(^|\/)\./, /\.(md|mjs|cjs|ts|zip|sql)$/, /(^|\/)package(-lock)?\.json$/, /(^|\/)vercel\.json$/];

// Public sign-in config for the browser: only the project URL and the publishable
// key. Without SUPABASE_PUBLISHABLE_KEY no config is written, the cabinet says that
// sign-in is unavailable and the lead form stays anonymous. Values are never printed.
const PUBLISHABLE = /^sb_publishable_[A-Za-z0-9_-]+$/;
function authConfig() {
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || '';
  if (!key) return null;
  if (!PUBLISHABLE.test(key)) throw new Error('dist: SUPABASE_PUBLISHABLE_KEY is not a publishable key (sb_publishable_…)');
  let url;
  try {
    url = new URL(process.env.SUPABASE_URL || '');
  } catch {
    throw new Error('dist: SUPABASE_URL is missing or not a URL');
  }
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) throw new Error('dist: SUPABASE_URL must use https');
  return { url: url.origin, publishableKey: key };
}

// No secret may reach a served file: a real-looking secret key, or the value of
// any server-only variable present in this build's environment.
const SECRET_SHAPE = /sb_secret_[A-Za-z0-9_-]{8,}/;
const SERVER_ONLY = ['SUPABASE_SECRET_KEY', 'TELEGRAM_BOT_TOKEN'];
const TEXT = /\.(html|js|json|css|xml|txt|svg)$/;

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
if (!existsSync(join(root, SUPABASE_BROWSER))) throw new Error(`dist: missing ${SUPABASE_BROWSER} (run npm install)`);
cpSync(join(root, SUPABASE_BROWSER), join(out, 'cabinet', 'supabase.js'));
const config = authConfig();
if (config) writeFileSync(join(out, 'cabinet', 'config.json'), `${JSON.stringify(config)}\n`);

const files = walk(out).map((f) => relative(out, f).split('\\').join('/'));
const denied = files.filter((f) => DENY.some((re) => re.test(f)));
if (denied.length) throw new Error(`dist: not allowed in output: ${denied.join(', ')}`);

const secrets = SERVER_ONLY.map((k) => process.env[k]).filter((v) => v && v.length >= 16);
const leaked = files.filter((f) => {
  if (!TEXT.test(f)) return false;
  const text = readFileSync(join(out, f), 'utf8');
  return SECRET_SHAPE.test(text) || secrets.some((v) => text.includes(v));
});
if (leaked.length) throw new Error(`dist: secret found in served file(s): ${leaked.join(', ')}`);

console.log(`dist: ${files.length} file(s) from ${ALLOW.join(', ')}; sign-in config ${config ? 'written' : 'not set'}`);
