// Single source of truth for absolute URLs and site-wide metadata.
// Absolute URLs (canonical, OG, JSON-LD, sitemap, robots, RSS) = origin + basePath.
// Defaults target GitHub Pages; override at build time without editing files:
//   SITE_ORIGIN     e.g. https://six-seven.vercel.app  (no trailing slash)
//   SITE_BASE_PATH  "/" on Vercel, "/SixSeven/" on GitHub Pages
// The production site is 67lollipops.kz; SITE_ORIGIN still overrides it when set.
const DEFAULT_ORIGIN = 'https://67lollipops.kz';
const GITHUB_PAGES_ORIGIN = 'https://kanatsadykhan-hub.github.io';
const env = process.env;
const origin = (env.SITE_ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, '');
const basePath = `/${env.SITE_BASE_PATH ?? 'SixSeven'}/`.replace(/\/+/g, '/');

// A Vercel build must not silently fall back to the GitHub Pages address.
if (env.VERCEL && (basePath !== '/' || origin === GITHUB_PAGES_ORIGIN)) {
  throw new Error('Vercel build: set SITE_BASE_PATH=/ and SITE_ORIGIN (or enable System Environment Variables)');
}

export default {
  origin,
  basePath,
  siteName: 'Six Seven',
  lang: 'ru',
  locale: 'ru_RU',
  author: 'Kanat Sadykhan',
  blogTitle: 'Блог Six Seven',
  blogDescription: 'Статьи о меме «67», импульсных покупках у кассы и леденцах Six Seven — для дистрибьюторов, сетей и точек продаж в Казахстане.',
  // Paths below are relative to the site root.
  ogImage: 'assets/a7507885109323621e057f3ff10ef703.jpg',
  ogImageAlt: 'Три героя Six Seven в форме с номером 67 смотрят на сказочный замок из сладостей с цифрами 67',
  logo: 'assets/logo.svg',
  logoRaster: 'assets/logo.png',
  landingTitle: 'Six Seven — леденцы для партнёров',
  landingDescription: 'Леденцы на палочке Six Seven с героями мема «67»: шесть вкусов, красители и ароматизаторы, стойка на кассу. Условия для партнёров в Казахстане.',
  landingPostCount: 3,
  // Search-engine ownership tokens, written into the landing <head>. Empty = omitted.
  verification: {
    google: 'KIA75sU--vEOtM4W7ePG6WSrUE8gfAEZ8_CFGKZipho',
    yandex: '',
  },
};
