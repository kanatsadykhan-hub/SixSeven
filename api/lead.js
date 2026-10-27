// Lead form endpoint: Vercel Function (Node.js runtime, Web-standard handler).
// Secrets come only from environment variables; they are never returned or logged.
import { createClient } from '@supabase/supabase-js';

const LIMITS = { name: 100, contact: 100, message: 1000 };
const MIN = { name: 2, contact: 5 };
const MAX_BODY_BYTES = 10 * 1024;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];

const json = (status, body, headers = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

// Simple per-IP limiter. It lives in this instance's memory, so it is not shared
// between instances and resets on a cold start; good enough to slow down floods.
const hits = new Map();
function retryAfterSeconds(ip, now = Date.now()) {
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    hits.set(ip, recent);
    return Math.ceil((RATE_WINDOW_MS - (now - recent[0])) / 1000);
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [key, times] of hits) if (now - times[times.length - 1] >= RATE_WINDOW_MS) hits.delete(key);
  }
  return 0;
}

// Bidirectional controls can make text read differently from what it is
// (e.g. reversing part of a phone number); no field needs them.
const BIDI = /[؜‎‏‪-‮⁦-⁩]/g;
// Single-line fields: control characters and runs of whitespace become one space.
const cleanLine = (v) => v.replace(BIDI, '').replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
// The message keeps line breaks but drops other control characters.
const cleanText = (v) =>
  v.replace(BIDI, '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').replace(/\n{3,}/g, '\n\n').trim();

const PHONE = /^\+?[\d\s().-]{7,25}$/;
// Telegram needs an explicit "@name" or "t.me/name" so plain words aren't accepted.
const TELEGRAM = /^(?:@|(?:https?:\/\/)?t\.me\/)[A-Za-z][A-Za-z0-9_]{4,31}\/?$/;
function looksLikeContact(v) {
  if (PHONE.test(v)) return (v.match(/\d/g) || []).length >= 7;
  return TELEGRAM.test(v);
}

// Optional chips from the form. FormData.get() returns null for an unselected
// radio, so null, undefined and '' all mean "not provided".
const POINT_TYPES = ['Аптеки', 'АЗС', 'Магазины у дома', 'Минимаркеты', 'Детские пространства', 'HoReCa', 'Дистрибьюторы'];
const POINT_COUNTS = ['1', '2–5', '6–20', '20+'];
const choice = (value, allowed) => {
  if (value === undefined || value === null || value === '') return '';
  return allowed.includes(value) ? value : null;
};

function validate(body) {
  const errors = [];
  const str = (key) => (typeof body[key] === 'string' ? body[key] : null);

  const name = str('name') === null ? null : cleanLine(str('name'));
  if (!name || name.length < MIN.name || name.length > LIMITS.name) errors.push('name');

  const contact = str('contact') === null ? null : cleanLine(str('contact'));
  if (!contact || contact.length < MIN.contact || contact.length > LIMITS.contact || !looksLikeContact(contact)) {
    errors.push('contact');
  }

  let message = '';
  if (body.message !== undefined && body.message !== null) {
    if (typeof body.message !== 'string') errors.push('message');
    else message = cleanText(body.message);
    if (message.length > LIMITS.message) errors.push('message');
  }

  const pointType = choice(body.pointType, POINT_TYPES);
  if (pointType === null) errors.push('pointType');
  const points = choice(body.points, POINT_COUNTS);
  if (points === null) errors.push('points');
  if (body.samples !== undefined && body.samples !== null && typeof body.samples !== 'boolean') errors.push('samples');

  if (body.consent !== true) errors.push('consent');

  return { errors, lead: { name, contact, message, pointType, points, samples: body.samples === true } };
}

// Labelled lines for the optional chips; only whitelisted values reach them.
const detailLines = ({ pointType, points, samples }) =>
  [pointType && `Тип точки: ${pointType}`, points && `Точек: ${points}`, samples && 'Образцы: нужны'].filter(Boolean);

// The "leads" table has name, contact and message (the details go into message),
// plus user_id, set only for a user verified by Supabase Auth.
const toRow = (lead, user) => ({
  name: lead.name,
  contact: lead.contact,
  message: [detailLines(lead).join('\n'), lead.message].filter(Boolean).join('\n\n'),
  ...(user && { user_id: user.id }),
});

// A Supabase access token is a JWT: three base64url parts. It is read only from
// the Authorization header, never from the body.
const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const MAX_AUTH_HEADER = 4096;
const bearerToken = (header) => (header.length <= MAX_AUTH_HEADER ? BEARER.exec(header)?.[1] || null : null);

let supabase;
const db = () =>
  (supabase ??= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }));

// The lead's owner comes only from Supabase Auth checking the token on its server
// (getUser), never from the request body. Any failure means "save anonymously".
async function verifiedUser(token) {
  try {
    const { data, error } = await db().auth.getUser(token);
    const user = data?.user;
    if (error || !user?.id || user.is_anonymous) {
      const http = Number.isInteger(error?.status) ? error.status : 'none';
      console.error(`lead: auth token rejected (code: ${safeToken(error?.code) || 'none'}, HTTP ${http})`);
      return null;
    }
    return { id: user.id, email: typeof user.email === 'string' ? cleanLine(user.email).slice(0, 254) : '' };
  } catch (err) {
    console.error(`lead: auth check threw (${safeToken(err?.name) || 'Error'})`);
    return null;
  }
}

// Returns the PostgREST error code ('' when there is none), or null on success.
async function insertLead(row) {
  try {
    const { error, status } = await db().from('leads').insert(row);
    if (error) {
      // HTTP status 0 means the request never reached a server (DNS, network, timeout).
      const http = Number.isInteger(status) ? status : 'unknown';
      console.error(`lead: supabase insert failed (code: ${safeToken(error.code) || 'unknown'}, HTTP ${http})`);
      return safeToken(error.code);
    }
    return null;
  } catch (err) {
    // Only the error class and the system error code (e.g. ENOTFOUND) are logged,
    // never err.message: it can contain the project URL.
    console.error(`lead: supabase insert threw (${safeToken(err?.name) || 'Error'}, cause: ${safeToken(err?.cause?.code) || 'none'})`);
    return '';
  }
}

// The link to the user is only rejected for these: the user was deleted (foreign
// key) or the user_id column is not migrated yet. Then the lead is kept without it.
const LINK_ERRORS = new Set(['23503', '42703', 'PGRST204']);

// Returns 'linked' (saved with user_id), 'saved' (saved without it) or null.
async function saveLead(row) {
  const code = await insertLead(row);
  if (code === null) return row.user_id ? 'linked' : 'saved';
  if (!row.user_id || !LINK_ERRORS.has(code)) return null;
  const { user_id: _, ...anonymous } = row;
  if ((await insertLead(anonymous)) !== null) return null;
  console.error('lead: saved without user_id');
  return 'saved';
}

// Passes through short identifier-like values only, so nothing else can leak into logs.
const safeToken = (value) => (typeof value === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(value) ? value : '');
// Telegram's error "description", only when it is short plain text
// (e.g. "Bad Request: chat not found"); anything else is dropped.
const safeDescription = (value) => (typeof value === 'string' && /^[A-Za-z0-9 ,:]{1,80}$/.test(value) ? value : '');

// Telegram HTML mode: these three characters are all that must be escaped.
const escapeHtml = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Our own lines come first; the visitor's message goes last, inside a quote, so a
// line typed into it (say, a fake "Аккаунт: …") can't pass for one of ours.
function telegramText(lead, user) {
  const line = (label, value) => `<b>${label}:</b> ${escapeHtml(value)}`;
  return [
    '<b>Новая заявка с сайта Six Seven</b>',
    line('Имя', lead.name),
    line('Контакт', lead.contact),
    ...detailLines(lead).map(escapeHtml),
    ...(user ? [line('Аккаунт', user.email || 'есть')] : []),
    '<b>Сообщение:</b>',
    `<blockquote>${escapeHtml(lead.message || '—')}</blockquote>`,
  ].join('\n');
}

async function notifyTelegram(lead, user) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: telegramText(lead, user),
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      let description = '';
      try {
        description = safeDescription((await res.json())?.description);
      } catch {
        // Not JSON: keep only the status.
      }
      console.error(`lead: telegram responded ${res.status}${description ? ` (${description})` : ''}`);
      return false;
    }
    return true;
  } catch (err) {
    // Never log err.message or the request URL: the URL contains the bot token.
    console.error(`lead: telegram request failed (${err?.name || 'Error'})`);
    return false;
  }
}

// Browsers say where a request comes from; another site's page must not be able
// to post leads through its visitors. Clients that send neither header (curl,
// scripts) are let through: they can fake the headers anyway, the rate limit
// and validation still apply to them.
function crossSite(request) {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return true;
  const origin = request.headers.get('origin');
  if (origin === null) return false;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  try {
    return new URL(origin).host !== host;
  } catch {
    return true; // "null" or garbage
  }
}

// The media type itself, without parameters: "text/plain;x=application/json" is
// a simple request a foreign page can send without a CORS preflight.
const mediaType = (header) => (header || '').split(';')[0].trim().toLowerCase();

async function handle(request) {
  if (request.method !== 'POST') {
    return json(405, { ok: false, error: 'method_not_allowed' }, { Allow: 'POST' });
  }
  if (crossSite(request)) return json(403, { ok: false, error: 'forbidden_origin' });
  if (mediaType(request.headers.get('content-type')) !== 'application/json') {
    return json(415, { ok: false, error: 'unsupported_media_type' });
  }
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) {
    return json(413, { ok: false, error: 'payload_too_large' });
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return json(413, { ok: false, error: 'payload_too_large' });

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: 'bad_json' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { ok: false, error: 'bad_json' });

  // Honeypot: real visitors never see this field. Pretend success and do nothing.
  if (body.website !== undefined && body.website !== null && String(body.website).trim() !== '') {
    return json(200, { ok: true });
  }

  // Vercel overwrites x-forwarded-for with the client IP, so it can't be spoofed.
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  const wait = retryAfterSeconds(ip);
  if (wait) return json(429, { ok: false, error: 'rate_limited' }, { 'Retry-After': String(wait) });

  const { errors, lead } = validate(body);
  if (errors.length) return json(400, { ok: false, error: 'invalid', fields: [...new Set(errors)] });

  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error(`lead: missing environment variables: ${missing.join(', ')}`);
    return json(500, { ok: false, error: 'server_config' });
  }

  // Signing in is optional: no header means an anonymous lead, as before. A header
  // that fails the check also gives an anonymous lead, reported as linked: false.
  const authHeader = request.headers.get('authorization');
  let user = null;
  if (authHeader !== null) {
    const token = bearerToken(authHeader);
    if (token) user = await verifiedUser(token);
    else console.error('lead: malformed authorization header');
  }

  const [saved, notified] = await Promise.all([saveLead(toRow(lead, user)), notifyTelegram(lead, user)]);
  if (!saved && !notified) return json(502, { ok: false, error: 'delivery_failed' });
  return json(200, authHeader === null ? { ok: true } : { ok: true, linked: saved === 'linked' });
}

export default {
  async fetch(request) {
    try {
      return await handle(request);
    } catch (err) {
      console.error(`lead: unexpected error (${err?.name || 'Error'})`);
      return json(500, { ok: false, error: 'server_error' });
    }
  },
};
