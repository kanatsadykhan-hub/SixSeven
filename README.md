# Лендинг Six Seven (B2B) — design reference

This is a design mockup created in a visual design tool, exported as a
standalone page. Treat it as a REFERENCE MOCKUP, not production code:
the markup and inline styles carry the design's precise values — colors,
font sizes, spacing, radii, shadows, layout — which an implementation
should replicate faithfully in its own components and styling system
rather than copy wholesale.

## Contents

- `index.html` — the artboard (a Design Component: an `<x-dc>`
  template + a small logic class). The values to replicate live in its
  inline `style="…"` attributes and the `<helmet><style>` block.
- `assets/` — files uploaded to the design (images, fonts, media)
- `support.js`, `vendor/react*.js` — the runtime that renders the
  component in a browser; not part of the design.

## Uploaded files

Images, fonts and media live under `assets/`, referenced with relative
paths. Flavor art is in `assets/flavors/`: `tiles.webp` is a 3×2 grid of
the six product tiles (each card shows its cell via `background-position`),
and `sheet-<flavor>.jpg` are the hero character sheets.

## Viewing

Live: https://kanatsadykhan-hub.github.io/SixSeven/ (GitHub Pages, `main` branch, root).

Locally: serve the folder (e.g. `python -m http.server`) and open
`index.html`; some browsers block the scripts over file://.

## Blog

Posts are Markdown files in `posts/` with front matter (`title`,
`description`, `date`, `updated`, `slug`). A zero-dependency Node script
turns them into static HTML that reads without JavaScript:

```
npm run build   # posts → blog/<slug>/index.html, blog/index.html,
                # blog/feed.xml, sitemap.xml, robots.txt, landing blocks
npm run check   # SEO + content-rule validation; exits 1 on problems
```

- `site.config.mjs` is the single place for the site URL (`origin`), the
  base path, author name and other metadata. `SITE_ORIGIN` and
  `SITE_BASE_PATH` environment variables override origin and base path at
  build time; the defaults target GitHub Pages (`/SixSeven/`).
- The build rewrites only the `SEO` and `BLOG` marker blocks in
  `index.html`; everything else there is hand-written.
- Generated files are committed, since GitHub Pages serves the repo as-is.
- Post rules enforced by `check.mjs`: question title and H2s, a 2–3 sentence
  `> ` answer at the top, 800–1500 words, one landing link, one related-post
  link, and an `## Источники` section with source links.

## Deploy to Vercel

Import the GitHub repo in Vercel with these settings:

| Setting | Value |
|---|---|
| Framework Preset | Other |
| Root Directory | `./` |
| Build Command | `npm run build && npm run check` (Override) |
| Output Directory | default (`.` — there is no `public/` folder) |
| Install Command | default (no dependencies) |
| Environment Variable | `SITE_BASE_PATH` = `/` (Production and Preview) |

- The origin comes from Vercel's `VERCEL_PROJECT_PRODUCTION_URL`; set
  `SITE_ORIGIN` (e.g. `https://example.com`) to pin a custom domain.
  System Environment Variables must be exposed in the project settings.
- A Vercel build fails on purpose if it would still use the GitHub Pages
  address or base path.
- `vercel.json` sets `trailingSlash: true`, so `/blog/x` redirects to
  `/blog/x/` (the canonical form) instead of serving duplicate URLs.
