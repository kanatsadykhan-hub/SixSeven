// Builds the static blog from posts/*.md. Run from anywhere: `node scripts/build.mjs`.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import cfg from '../site.config.mjs';
import { parseFrontMatter, renderMarkdown, escapeHtml as x } from './markdown.mjs';
import { imageSize } from './imagesize.mjs';
import { layout, postBody, indexBody, humanDate } from './templates.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const abs = (path = '') => cfg.origin + cfg.basePath + path;
const write = (path, content) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
};

const feedUrl = abs('blog/feed.xml');
const REQUIRED = ['title', 'description', 'date', 'updated', 'slug'];
const sizeOf = (src) => imageSize(join(root, src.replace(/^\//, '')));

function loadPosts() {
  const files = readdirSync(join(root, 'posts')).filter((f) => f.endsWith('.md')).sort();
  const posts = files.map((file) => {
    const { data, body } = parseFrontMatter(readFileSync(join(root, 'posts', file), 'utf8'));
    for (const k of REQUIRED) if (!data[k]) throw new Error(`${file}: front matter is missing "${k}"`);
    if (!/^[a-z0-9-]+$/.test(data.slug)) throw new Error(`${file}: slug must be lowercase latin, digits and dashes`);
    // The first image in the post doubles as its OG image and index thumbnail.
    const img = /^!\[([^\]]+)\]\(\/([^)\s]+)\)$/m.exec(body);
    return { ...data, file, body, image: img ? { alt: img[1], src: img[2], ...sizeOf(img[2]) } : null };
  });
  const slugs = new Set();
  for (const p of posts) {
    if (slugs.has(p.slug)) throw new Error(`duplicate slug "${p.slug}"`);
    slugs.add(p.slug);
  }
  // Newest first; posts from the same day keep their file order.
  return posts.sort((a, b) => b.date.localeCompare(a.date) || a.file.localeCompare(b.file));
}

// Root-relative links in Markdown ("/", "/blog/x/") become relative to the page,
// so the output works under /SixSeven/ on Pages and at / in a local preview.
const resolverFor = (rel) => (url) => (url.startsWith('/') ? rel + url.slice(1) || './' : url);

function splitAnswer(body) {
  // A leading "> ..." block is the short direct answer shown in a callout.
  const m = /^\s*((?:>.*(?:\n|$))+)/.exec(body);
  return m ? { answer: m[1], rest: body.slice(m[0].length) } : { answer: '', rest: body };
}

const publisher = {
  '@type': 'Organization',
  name: cfg.siteName,
  url: abs(),
  logo: { '@type': 'ImageObject', url: abs(cfg.logo) },
};

function crumbsLd(items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
  };
}

function buildPost(post) {
  const rel = '../../';
  const resolve = resolverFor(rel);
  const { answer, rest } = splitAnswer(post.body);
  const canonical = abs(`blog/${post.slug}/`);
  const image = post.image ? abs(post.image.src) : abs(cfg.ogImage);
  const full = {
    ...post,
    answerHtml: answer ? renderMarkdown(answer.replace(/^>\s?/gm, ''), resolve) : '',
    html: renderMarkdown(rest, resolve, sizeOf),
  };
  const graph = [
    {
      '@type': 'Article',
      headline: post.title,
      description: post.description,
      datePublished: post.date,
      dateModified: post.updated,
      inLanguage: cfg.lang,
      author: { '@type': 'Person', name: cfg.author },
      publisher,
      image: [image],
      mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    },
    crumbsLd([
      { name: 'Главная', url: abs() },
      { name: 'Блог', url: abs('blog/') },
      { name: post.title, url: canonical },
    ]),
  ];
  write(`blog/${post.slug}/index.html`, layout({
    cfg, rel, canonical,
    title: `${post.title} | ${cfg.siteName}`,
    description: post.description,
    ogType: 'article',
    ogImage: image,
    ogImageAlt: post.image ? post.image.alt : cfg.ogImageAlt,
    graph,
    feedUrl,
    body: postBody({ rel, cfg, post: full }),
  }));
}

function buildIndex(posts) {
  const rel = '../';
  const canonical = abs('blog/');
  const graph = [
    {
      '@type': 'Blog',
      name: cfg.blogTitle,
      description: cfg.blogDescription,
      url: canonical,
      inLanguage: cfg.lang,
      publisher,
      blogPost: posts.map((p) => ({
        '@type': 'BlogPosting',
        headline: p.title,
        url: abs(`blog/${p.slug}/`),
        datePublished: p.date,
        dateModified: p.updated,
      })),
    },
    crumbsLd([
      { name: 'Главная', url: abs() },
      { name: 'Блог', url: canonical },
    ]),
  ];
  write('blog/index.html', layout({
    cfg, rel, canonical,
    title: cfg.blogTitle,
    description: cfg.blogDescription,
    ogType: 'website',
    ogImage: abs(cfg.ogImage),
    ogImageAlt: cfg.ogImageAlt,
    graph,
    feedUrl,
    body: indexBody({ rel, cfg, posts }),
  }));
}

// Dates come from front matter (not the clock), so rebuilding is idempotent.
const lastUpdated = (posts) => posts.map((p) => p.updated).sort().at(-1);
const rfc822 = (iso) => new Date(iso + 'T00:00:00Z').toUTCString();

function buildSitemap(posts) {
  const urls = [
    { loc: abs(), lastmod: lastUpdated(posts) },
    { loc: abs('blog/'), lastmod: lastUpdated(posts) },
    ...posts.map((p) => ({ loc: abs(`blog/${p.slug}/`), lastmod: p.updated })),
  ];
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${x(u.loc)}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n')}
</urlset>
`);
}

function buildRobots() {
  // Crawlers only read robots.txt at the host root; under a project-site basePath
  // this file is informational until the site moves to its own domain.
  write('robots.txt', `User-agent: *
Allow: /

Sitemap: ${abs('sitemap.xml')}
`);
}

function buildFeed(posts) {
  const items = posts.map((p) => `    <item>
      <title>${x(p.title)}</title>
      <link>${abs(`blog/${p.slug}/`)}</link>
      <guid isPermaLink="true">${abs(`blog/${p.slug}/`)}</guid>
      <pubDate>${rfc822(p.date)}</pubDate>
      <description>${x(p.description)}</description>
    </item>`).join('\n');
  write('blog/feed.xml', `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${x(cfg.blogTitle)}</title>
    <link>${abs('blog/')}</link>
    <description>${x(cfg.blogDescription)}</description>
    <language>${cfg.lang}</language>
    <lastBuildDate>${rfc822(lastUpdated(posts))}</lastBuildDate>
    <atom:link href="${feedUrl}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`);
}

// The landing (index.html) is hand-written; only the blocks between these
// markers are regenerated, so re-running the build is safe.
function replaceBlock(html, name, content) {
  const re = new RegExp(`(<!-- ${name}:START[^>]*-->)[\\s\\S]*?(<!-- ${name}:END -->)`);
  if (!re.test(html)) throw new Error(`index.html is missing the ${name}:START / ${name}:END markers`);
  return html.replace(re, (_, start, end) => `${start}\n${content}\n${end}`);
}

function landingSeo() {
  const graph = [
    { '@type': 'Organization', name: cfg.siteName, url: abs(), logo: abs(cfg.logo) },
    { '@type': 'WebSite', name: cfg.siteName, url: abs(), inLanguage: cfg.lang },
  ];
  return `<meta name="description" content="${x(cfg.landingDescription)}">
<link rel="canonical" href="${abs()}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${x(cfg.siteName)}">
<meta property="og:locale" content="${cfg.locale}">
<meta property="og:title" content="${x(cfg.landingTitle)}">
<meta property="og:description" content="${x(cfg.landingDescription)}">
<meta property="og:url" content="${abs()}">
<meta property="og:image" content="${abs(cfg.ogImage)}">
<meta property="og:image:alt" content="${x(cfg.ogImageAlt)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="alternate" type="application/rss+xml" title="${x(cfg.blogTitle)}" href="${feedUrl}">
<script type="application/ld+json">
${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 1).replace(/</g, '\\u003c')}
</script>`;
}

// Markup and inline styles follow the landing's own cards (see #flavors).
function landingPosts(posts) {
  const cards = posts.slice(0, cfg.landingPostCount).map((p) => `<article class="glass glass-dim hover-lift" style="border-radius:32px;padding:18px">
<a href="blog/${p.slug}/" style="display:block">
${p.image ? `<div style="position:relative;aspect-ratio:16/10;border-radius:24px;overflow:hidden;background:#2C2E35"><img src="${p.image.src}" alt="${x(p.image.alt)}" width="${p.image.width}" height="${p.image.height}" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block"></div>\n` : ''}<div style="padding:18px 8px 6px">
<div style="font-size:11px;letter-spacing:.1em;color:rgba(255,246,229,.72)">${humanDate(p.date)}</div>
<h3 class="hd" style="font-size:22px;line-height:1.2;margin:10px 0 12px">${x(p.title)}</h3>
<p style="margin:0;font-size:13px;color:rgba(255,246,229,.88)">${x(p.description)}</p>
</div>
</a>
</article>`).join('\n');
  return `<section id="blog" style="background:#1E1F26;padding:32px 0 112px">
<div class="wrap">
<div class="row-top" style="margin-bottom:56px;align-items:flex-end">
<h2 class="hd" style="font-size:clamp(32px,5.2vw,76px);line-height:1.04">Свежее<br><span style="display:inline-block;margin-left:clamp(48px,8vw,128px)">в <span class="script" style="color:var(--accent);font-size:1.02em">блоге</span></span></h2>
<a class="btn glass" href="blog/">Все статьи</a>
</div>
<div class="grid-3">
${cards}
</div>
</div>
</section>`;
}

function updateLanding(posts) {
  const file = join(root, 'index.html');
  const before = readFileSync(file, 'utf8');
  const after = replaceBlock(replaceBlock(before, 'SEO', landingSeo()), 'BLOG', landingPosts(posts));
  if (after !== before) writeFileSync(file, after);
}

const posts = loadPosts();
posts.forEach(buildPost);
buildIndex(posts);
buildSitemap(posts);
buildRobots();
buildFeed(posts);
updateLanding(posts);
console.log(`built ${posts.length} post(s), blog index, sitemap.xml, robots.txt, blog/feed.xml, landing blocks`);
