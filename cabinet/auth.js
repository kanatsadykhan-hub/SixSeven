// Optional sign-in (Supabase Auth, email + password), shared by the landing's
// lead form and the cabinet. The browser only ever sees the publishable key:
// config.json and supabase.js are written next to this file by scripts/dist.mjs
// and are not in git. No config (GitHub Pages, a local preview of the repo root)
// means sign-in is off and getClient() resolves to null.
const here = new URL('./', import.meta.url);
let pending;

// The landing imports this only when localStorage already holds a Supabase
// session (sb-<ref>-auth-token), so anonymous visitors load none of it.
export const getClient = () => (pending ??= load());

async function load() {
  try {
    const res = await fetch(new URL('config.json', here), { cache: 'no-store' });
    if (!res.ok) return null;
    const { url, publishableKey } = await res.json();
    if (typeof url !== 'string' || !/^sb_publishable_/.test(publishableKey || '')) return null;
    await loadScript(new URL('supabase.js', here).href);
    return window.supabase.createClient(url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch {
    return null;
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error('supabase.js did not load'));
    document.head.append(script);
  });
}
