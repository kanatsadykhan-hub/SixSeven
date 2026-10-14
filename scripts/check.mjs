// Validates the generated site and the post content rules. Exit code 1 on any error.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import cfg from '../site.config.mjs';
import { parseFrontMatter } from './markdown.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);
const siteBase = cfg.origin + cfg.basePath;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.html') ? [p] : [];
  });
}

// ---------- generated HTML ----------
const pages = walk(join(root, 'blog'));
const titles = new Map();
const descriptions = new Map();
const attr = (html, re) => (re.exec(html) || [])[1];

for (const file of pages) {
  const rel = relative(root, file).split('\\').join('/');
  const html = readFileSync(file, 'utf8');
  const urlPath = rel.replace(/index\.html$/, '');

  if (!/<html lang="ru">/.test(html)) fail(rel, 'missing <html lang="ru">');
  const h1s = html.match(/<h1[\s>]/g) || [];
  if (h1s.length !== 1) fail(rel, `expected exactly one <h1>, found ${h1s.length}`);

  const title = attr(html, /<title>([^<]+)<\/title>/);
  const desc = attr(html, /<meta name="description" content="([^"]+)"/);
  if (!title) fail(rel, 'missing <title>');
  if (!desc) fail(rel, 'missing meta description');
  if (titles.has(title)) fail(rel, `title duplicates ${titles.get(title)}`);
  if (descriptions.has(desc)) fail(rel, `description duplicates ${descriptions.get(desc)}`);
  titles.set(title, rel);
  descriptions.set(desc, rel);

  const canonical = attr(html, /<link rel="canonical" href="([^"]+)"/);
  if (canonical !== siteBase + urlPath) fail(rel, `canonical is ${canonical}, expected ${siteBase + urlPath}`);
  for (const p of ['og:type', 'og:title', 'og:description', 'og:url', 'og:image', 'og:image:alt', 'og:locale', 'og:site_name']) {
    if (!html.includes(`property="${p}"`)) fail(rel, `missing ${p}`);
  }
  if (attr(html, /property="og:url" content="([^"]+)"/) !== canonical) fail(rel, 'og:url differs from canonical');

  const ld = attr(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  try {
    const types = JSON.parse(ld)['@graph'].map((n) => n['@type']);
    if (!types.includes('BreadcrumbList')) fail(rel, 'JSON-LD has no BreadcrumbList');
    const want = urlPath === 'blog/' ? 'Blog' : 'Article';
    if (!types.includes(want)) fail(rel, `JSON-LD has no ${want}`);
  } catch (err) {
    fail(rel, `JSON-LD does not parse: ${err.message}`);
  }

  for (const img of html.match(/<img\b[^>]*>/g) || []) {
    if (!/\balt="[^"]+"/.test(img)) fail(rel, `image without alt text: ${img.slice(0, 80)}`);
    if (!/\bwidth="\d+"/.test(img) || !/\bheight="\d+"/.test(img)) fail(rel, `image without width/height: ${img.slice(0, 80)}`);
  }

  // Every local href/src must point at a file that exists.
  for (const [, url] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    if (/^(https?:|mailto:|tel:|#)/.test(url)) continue;
    const clean = url.split('#')[0].split('?')[0];
    if (!clean) continue;
    let target = posix.normalize(posix.join(posix.dirname(rel), clean));
    if (clean.endsWith('/') || clean === '.' || clean === './') target = posix.join(target, 'index.html');
    if (!existsSync(join(root, target))) fail(rel, `broken local link ${url} → ${target}`);
  }
}

// ---------- post content rules (from the Markdown sources) ----------
const postFiles = readdirSync(join(root, 'posts')).filter((f) => f.endsWith('.md'));
const slugs = new Set(postFiles.map((f) => parseFrontMatter(readFileSync(join(root, 'posts', f), 'utf8')).data.slug));

for (const f of postFiles) {
  const where = `posts/${f}`;
  const { data, body } = parseFrontMatter(readFileSync(join(root, 'posts', f), 'utf8'));
  for (const k of ['title', 'description', 'date', 'updated', 'slug']) if (!data[k]) fail(where, `front matter missing ${k}`);
  if (!data.title.trim().endsWith('?')) fail(where, 'title must be a question');
  if (data.description.length < 70 || data.description.length > 170) fail(where, `description is ${data.description.length} chars (aim for 70–170)`);
  if (!existsSync(join(root, 'blog', data.slug, 'index.html'))) fail(where, 'not built — run node scripts/build.mjs');

  const answer = (/^\s*((?:>.*(?:\n|$))+)/.exec(body) || [])[1];
  if (!answer) {
    fail(where, 'missing the direct answer ("> ..." block at the top)');
  } else {
    const sentences = answer.replace(/^>\s?/gm, '').trim().split(/(?<=[.!?…])\s+(?=[«"A-ZА-ЯЁ0-9])/).filter(Boolean);
    if (sentences.length < 2 || sentences.length > 3) fail(where, `direct answer has ${sentences.length} sentences, expected 2–3`);
  }

  const [main, sources = ''] = body.split(/^## Источники\s*$/m);
  if (!sources.trim()) fail(where, 'missing "## Источники" section');
  else if (!/\]\(https?:\/\//.test(sources)) fail(where, 'Источники has no http links');

  for (const [, h] of main.matchAll(/^## (.+)$/gm)) {
    if (!h.trim().endsWith('?')) fail(where, `H2 is not a question: "${h}"`);
  }

  const links = [...main.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)].map((m) => m[1]);
  const landing = links.filter((u) => u === '/' || u.startsWith('/#'));
  const related = links.filter((u) => /^\/blog\/[a-z0-9-]+\/$/.test(u));
  if (landing.length !== 1) fail(where, `expected 1 link to the landing, found ${landing.length}`);
  if (related.length !== 1) fail(where, `expected 1 link to a related post, found ${related.length}`);
  for (const u of related) {
    const s = u.split('/')[2];
    if (s === data.slug) fail(where, 'related link points at itself');
    else if (!slugs.has(s)) fail(where, `related post "${s}" does not exist yet`);
  }

  const words = main
    .replace(/^!\[.*$/gm, '')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/[#>*\[\]]/g, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  if (words < 800 || words > 1500) fail(where, `${words} words (expected 800–1500)`);
  else console.log(`${where}: ${words} words`);
}

if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`\nOK — ${pages.length} page(s), ${postFiles.length} post(s) checked`);
