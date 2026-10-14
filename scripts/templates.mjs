import { escapeHtml as e } from './markdown.mjs';

const FONTS = 'https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&family=Pacifico&family=JetBrains+Mono:wght@400;500&display=swap';
const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
export const humanDate = (iso) => dateFmt.format(new Date(iso + 'T00:00:00Z')).replace(/\s*г\.$/, '');

// Keeps "</script>" and friends from ever closing the JSON-LD block early.
const jsonLd = (graph) => JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 1).replace(/</g, '\\u003c');

export function layout({ cfg, rel, canonical, title, description, ogType, ogImage, ogImageAlt, graph, feedUrl, body }) {
  const home = rel || './';
  return `<!doctype html>
<html lang="${cfg.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}</title>
<meta name="description" content="${e(description)}">
<link rel="canonical" href="${e(canonical)}">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="${e(cfg.siteName)}">
<meta property="og:locale" content="${cfg.locale}">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(description)}">
<meta property="og:url" content="${e(canonical)}">
<meta property="og:image" content="${e(ogImage)}">
<meta property="og:image:alt" content="${e(ogImageAlt)}">
<meta name="twitter:card" content="summary_large_image">
${feedUrl ? `<link rel="alternate" type="application/rss+xml" title="${e(cfg.blogTitle)}" href="${e(feedUrl)}">\n` : ''}<link rel="icon" href="${rel}${cfg.logo}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="${rel}blog/blog.css">
<script type="application/ld+json">
${jsonLd(graph)}
</script>
</head>
<body>
<div class="grain" aria-hidden="true"></div>
<header class="site-header wrap">
<a class="logo" href="${home}"><img src="${rel}${cfg.logo}" alt="Six Seven — на главную" width="151" height="68"></a>
<nav class="site-nav" aria-label="Основное меню">
<a href="${rel}blog/">Блог</a>
<a class="btn btn-accent" href="${home}#contact">Получить прайс</a>
</nav>
</header>
<main class="wrap">
${body}
</main>
<footer class="site-footer">
<div class="wrap footer-row">
<img src="${rel}${cfg.logo}" alt="Six Seven" width="106" height="48">
<nav aria-label="Ссылки в подвале"><a href="${home}">Главная</a> · <a href="${rel}blog/">Блог</a></nav>
<div class="legal">ИП Аубакиров Канат Садыханулы · Алматы, Казахстан · © 2026 Six Seven</div>
</div>
</footer>
</body>
</html>
`;
}

export function breadcrumbs(rel, items) {
  // items: [{ name, href? }] — the last one is the current page.
  return `<nav class="crumbs" aria-label="Хлебные крошки"><ol>${items
    .map((it, i) => (i === items.length - 1 ? `<li><span aria-current="page">${e(it.name)}</span></li>` : `<li><a href="${it.href}">${e(it.name)}</a></li>`))
    .join('')}</ol></nav>`;
}

export function postBody({ rel, cfg, post }) {
  const updated = post.updated && post.updated !== post.date
    ? ` · Обновлено <time datetime="${post.updated}">${humanDate(post.updated)}</time>` : '';
  return `${breadcrumbs(rel, [{ name: 'Главная', href: rel }, { name: 'Блог', href: `${rel}blog/` }, { name: post.title }])}
<article class="post">
<header class="post-head">
<h1>${e(post.title)}</h1>
<p class="post-meta">Опубликовано <time datetime="${post.date}">${humanDate(post.date)}</time>${updated} · Автор: ${e(cfg.author)}</p>
</header>
${post.answerHtml ? `<div class="answer" role="note"><p class="answer-label">Коротко</p>${post.answerHtml}</div>\n` : ''}${post.html}
</article>`;
}

export function indexBody({ rel, cfg, posts }) {
  const cards = posts.map((p) => `<article class="card">
${p.image ? `<a class="card-img" href="${p.slug}/" tabindex="-1" aria-hidden="true"><img src="${rel}${p.image.src}" alt="${e(p.image.alt)}" width="${p.image.width}" height="${p.image.height}" loading="lazy" decoding="async"></a>\n` : ''}<div class="card-body">
<h2><a href="${p.slug}/">${e(p.title)}</a></h2>
<p>${e(p.description)}</p>
<p class="post-meta"><time datetime="${p.date}">${humanDate(p.date)}</time></p>
</div>
</article>`).join('\n');
  return `${breadcrumbs(rel, [{ name: 'Главная', href: rel }, { name: 'Блог' }])}
<header class="post-head">
<h1>${e(cfg.blogTitle)}</h1>
<p class="lead">${e(cfg.blogDescription)}</p>
</header>
<div class="cards">
${cards}
</div>`;
}
