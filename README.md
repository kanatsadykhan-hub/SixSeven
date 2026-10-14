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
