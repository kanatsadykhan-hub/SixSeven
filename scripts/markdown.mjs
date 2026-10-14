// Minimal Markdown for the blog posts. Supported on purpose, nothing more:
// front matter (key: value), ## / ### headings, paragraphs, "- " and "1. " lists,
// "> " quotes, a standalone ![alt](src) image line, [links](url), **bold**, *em*.

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function parseFrontMatter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) throw new Error('missing front matter');
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    data[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return { data, body: src.slice(m[0].length) };
}

// resolve(url) lets the caller rewrite site-root paths ("/blog/x/") to relative ones.
function inline(text, resolve) {
  const slots = [];
  const keep = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    const external = /^https?:\/\//.test(url);
    const href = escapeHtml(external ? url : resolve(url));
    return keep(`<a href="${href}"${external ? ' rel="noopener"' : ''}>${inline(label, resolve)}</a>`);
  });
  s = escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[+i]);
}

export function renderMarkdown(body, resolve = (u) => u) {
  const blocks = body.replace(/\r\n/g, '\n').trim().split(/\n{2,}/);
  const out = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const h = /^(#{2,3})\s+(.*)$/.exec(block);
    const img = /^!\[([^\]]+)\]\(([^)\s]+)\)$/.exec(block.trim());
    if (h && lines.length === 1) {
      const tag = h[1].length === 2 ? 'h2' : 'h3';
      out.push(`<${tag}>${inline(h[2], resolve)}</${tag}>`);
    } else if (img) {
      out.push(`<figure><img src="${escapeHtml(resolve(img[2]))}" alt="${escapeHtml(img[1])}" loading="lazy" decoding="async"></figure>`);
    } else if (lines.every((l) => /^- /.test(l))) {
      out.push(`<ul>${lines.map((l) => `<li>${inline(l.slice(2), resolve)}</li>`).join('')}</ul>`);
    } else if (lines.every((l) => /^\d+\. /.test(l))) {
      out.push(`<ol>${lines.map((l) => `<li>${inline(l.replace(/^\d+\. /, ''), resolve)}</li>`).join('')}</ol>`);
    } else if (lines.every((l) => /^>\s?/.test(l))) {
      out.push(`<blockquote>${inline(lines.map((l) => l.replace(/^>\s?/, '')).join(' '), resolve)}</blockquote>`);
    } else {
      out.push(`<p>${inline(lines.join(' '), resolve)}</p>`);
    }
  }
  return out.join('\n');
}
