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

// Single-line fields: control characters and runs of whitespace become one space.
const cleanLine = (v) => v.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
// The message keeps line breaks but drops other control characters.
const cleanText = (v) =>
  v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').replace(/\n{3,}/g, '\n\n').trim();

const PHONE = /^\+?[\d\s().-]{7,25}$/;
// Telegram needs an explicit "@name" or "t.me/name" so plain words aren't accepted.
const TELEGRAM = /^(?:@|(?:https?:\/\/)?t\.me\/)[A-Za-z][A-Za-z0-9_]{4,31}\/?$/;
function looksLikeContact(v) {
  if (PHONE.test(v)) return (v.match(/\d/g) || []).length >= 7;
  return TELEGRAM.test(v);
}

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

  if (body.consent !== true) errors.push('consent');

  return { errors, lead: { name, contact, message } };
}

let supabase;
const db = () =>
  (supabase ??= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }));

async function saveLead(lead) {
  try {
    const { error } = await db().from('leads').insert(lead);
    if (error) {
      console.error(`lead: supabase insert failed (${error.code || 'unknown'})`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`lead: supabase insert threw (${err?.name || 'Error'})`);
    return false;
  }
}

async function notifyTelegram({ name, contact, message }) {
  const text = [
    'Новая заявка с сайта Six Seven',
    `Имя: ${name}`,
    `Контакт: ${contact}`,
    `Сообщение: ${message || '—'}`,
  ].join('\n');
  try {
    const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error(`lead: telegram responded ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    // Never log err.message or the request URL: the URL contains the bot token.
    console.error(`lead: telegram request failed (${err?.name || 'Error'})`);
    return false;
  }
}

async function handle(request) {
  if (request.method !== 'POST') {
    return json(405, { ok: false, error: 'method_not_allowed' }, { Allow: 'POST' });
  }
  if (!(request.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
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

  const [saved, notified] = await Promise.all([saveLead(lead), notifyTelegram(lead)]);
  if (!saved && !notified) return json(502, { ok: false, error: 'delivery_failed' });
  return json(200, { ok: true });
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
