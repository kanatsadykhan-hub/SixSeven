// Builds the static blog from posts/*.md. Run from anywhere: `node scripts/build.mjs`.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import cfg from '../site.config.mjs';
import { parseFrontMatter, renderMarkdown } from './markdown.mjs';
import { imageSize } from './imagesize.mjs';
import { layout, postBody, indexBody } from './templates.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const abs = (path = '') => cfg.origin + cfg.basePath + path;
const write = (path, content) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
};

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
    body: indexBody({ rel, cfg, posts }),
  }));
}

const posts = loadPosts();
posts.forEach(buildPost);
buildIndex(posts);
console.log(`built ${posts.length} post(s) + blog index`);
