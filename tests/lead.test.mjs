// Handler tests for api/lead.js with fake env values and a stubbed fetch (fake
// Telegram), so nothing leaves this machine. Run: npm run test:api
// Telegram-only: leads are delivered to Telegram and not stored anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, {
  TELEGRAM_BOT_TOKEN: 'fake-token',
  TELEGRAM_CHAT_ID: 'fake-chat',
});

let log, telegramMode;
globalThis.fetch = async (input, init = {}) => {
  const req = input instanceof Request ? input : new Request(input, init);
  const url = new URL(req.url);
  const body = await req.text();
  if (url.hostname === 'api.telegram.org') {
    log.telegram.push(JSON.parse(body));
    if (telegramMode === 'down') throw new TypeError('fetch failed');
    if (telegramMode === 'bad') return Response.json({ ok: false, description: 'Bad Request chat not found' }, { status: 400 });
    return Response.json({ ok: true });
  }
  throw new Error(`unexpected fetch ${url.href}`);
};

const { default: api } = await import('../api/lead.js');
const errors = [];
console.error = (message) => errors.push(String(message));

const BASE = { name: 'Тест', contact: '+7 701 000 00 00', consent: true };
let ip = 0;
// Every call gets its own IP unless one is given, so the rate limit stays out of the way.
async function send({ body = {}, mode = 'ok', sameIp, headers = {}, raw } = {}) {
  log = { telegram: [] };
  telegramMode = mode;
  errors.length = 0;
  const all = { 'content-type': 'application/json', 'x-forwarded-for': sameIp || `10.2.${Math.floor(++ip / 250)}.${ip % 250}`, ...headers };
  const res = await api.fetch(new Request('http://localhost/api/lead', {
    method: 'POST',
    headers: all,
    body: raw ?? JSON.stringify({ ...BASE, ...body }),
  }));
  return { status: res.status, json: await res.json(), ...log, text: log.telegram[0]?.text, errors: [...errors] };
}

// ---------- validation ----------

test('valid payloads are delivered to Telegram', async () => {
  const bodies = [
    { message: '', pointType: null, points: null, samples: false },
    {},
    { pointType: '', points: '' },
    { pointType: 'Аптеки', points: '2–5', samples: true },
    ...['Аптеки', 'АЗС', 'Магазины у дома', 'Минимаркеты', 'Детские пространства', 'HoReCa', 'Дистрибьюторы'].map((pointType) => ({ pointType })),
  ];
  for (const body of bodies) {
    const r = await send({ body });
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.deepEqual(r.json, { ok: true });
    assert.equal(r.telegram.length, 1);
  }
});

test('invalid fields are rejected with their names, nothing is sent', async () => {
  const cases = [
    [{ pointType: 'Банк' }, ['pointType']],
    [{ points: '2-5' }, ['points']],
    [{ points: 1 }, ['points']],
    [{ samples: 'yes' }, ['samples']],
    [{ pointType: 'x', points: '100', samples: 1 }, ['pointType', 'points', 'samples']],
    [{ consent: false }, ['consent']],
    [{ name: 'x' }, ['name']],
    [{ contact: 'hello' }, ['contact']],
  ];
  for (const [body, fields] of cases) {
    const r = await send({ body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.deepEqual(r.json.fields, fields);
    assert.equal(r.telegram.length, 0);
  }
});

// ---------- where the request comes from ----------

test('content type must be exactly application/json', async () => {
  for (const type of ['text/plain;x=application/json', 'text/plain; charset=application/json', 'application/jsonx', 'text/plain']) {
    const r = await send({ headers: { 'content-type': type } });
    assert.equal(r.status, 415, type);
    assert.equal(r.telegram.length, 0);
  }
  for (const type of ['application/json; charset=utf-8', 'Application/JSON']) {
    assert.equal((await send({ headers: { 'content-type': type } })).status, 200, type);
  }
});

test('cross-site requests are refused before anything else', async () => {
  const host = { host: 'six-seven.example' };
  const refused = [
    { ...host, origin: 'https://evil.example' },
    { ...host, origin: 'https://six-seven.example.evil.example' },
    { ...host, origin: 'null' },
    { ...host, 'sec-fetch-site': 'cross-site' },
    { ...host, 'sec-fetch-site': 'same-site' },
    { ...host, origin: 'https://six-seven.example', 'sec-fetch-site': 'cross-site' },
    { 'x-forwarded-host': 'six-seven.example', host: 'internal', origin: 'https://internal' },
  ];
  for (const headers of refused) {
    const r = await send({ headers });
    assert.equal(r.status, 403, JSON.stringify(headers));
    assert.deepEqual(r.json, { ok: false, error: 'forbidden_origin' });
    assert.equal(r.telegram.length, 0);
  }
  // Refused requests don't use up the sender's rate limit.
  for (let i = 0; i < 6; i++) await send({ sameIp: '10.8.8.8', headers: { ...host, origin: 'https://evil.example' } });
  assert.equal((await send({ sameIp: '10.8.8.8' })).status, 200);
});

test('same-origin browser requests and header-less clients pass', async () => {
  const allowed = [
    { host: 'six-seven.example', origin: 'https://six-seven.example', 'sec-fetch-site': 'same-origin' },
    { host: 'localhost:3000', origin: 'http://localhost:3000' },
    { 'x-forwarded-host': 'six-seven.example', host: 'internal', origin: 'https://six-seven.example' },
    { 'sec-fetch-site': 'same-origin' },
    {},
  ];
  for (const headers of allowed) assert.equal((await send({ headers })).status, 200, JSON.stringify(headers));
});

// ---------- honeypot ----------

test('honeypot: a filled website field looks like success but sends nothing', async () => {
  const r = await send({ body: { website: 'http://spam.example' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
  assert.equal(r.telegram.length, 0);
});

// ---------- Telegram message ----------

test('nothing identifying is stored; only name/contact/details/message are sent', async () => {
  const r = await send({ body: { user_id: 'attacker', userId: 'attacker' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
  assert.equal(r.text.includes('Аккаунт'), false);
  assert.equal(r.text.includes('attacker'), false);
});

test('Telegram gets escaped HTML with the message quoted last', async () => {
  const r = await send({
    body: { name: 'Ann <b>&', contact: '@shop_buyer', pointType: 'Аптеки', message: 'Привет <a href="x">тут</a>\nАккаунт: boss@example.kz' },
  });
  assert.equal(r.status, 200);
  const sent = r.telegram[0];
  assert.equal(sent.parse_mode, 'HTML');
  assert.deepEqual(sent.link_preview_options, { is_disabled: true });
  assert.match(sent.text, /<b>Имя:<\/b> Ann &lt;b&gt;&amp;/);
  assert.match(sent.text, /\nТип точки: Аптеки\n/);
  // Only our own tags are left, and the fake account line sits inside the quote.
  assert.deepEqual([...new Set(sent.text.match(/<\/?[a-z]+>/g))].sort(), ['</b>', '</blockquote>', '<b>', '<blockquote>']);
  assert.ok(sent.text.endsWith('<blockquote>Привет &lt;a href="x"&gt;тут&lt;/a&gt;\nАккаунт: boss@example.kz</blockquote>'));
  assert.equal(sent.text.includes('<b>Аккаунт:</b>'), false);
});

test('bidi controls are removed from every text field', async () => {
  const r = await send({ body: { name: 'Ан‮на', contact: '+7 701 ⁦000⁩ 00 00', message: 'a‏b؜c' } });
  assert.equal(r.status, 200);
  assert.equal(/[؜‎‏‪-‮⁦-⁩]/.test(r.text), false);
  assert.match(r.text, /<b>Имя:<\/b> Анна/);
  assert.match(r.text, /<b>Контакт:<\/b> \+7 701 000 00 00/);
});

// ---------- delivery failures ----------

test('telegram error: 502, safe log, no token leaked', async () => {
  const r = await send({ mode: 'bad' });
  assert.equal(r.status, 502);
  assert.deepEqual(r.json, { ok: false, error: 'delivery_failed' });
  assert.ok(r.errors.some((e) => e.startsWith('lead: telegram responded 400')), r.errors.join('|'));
  assert.ok(r.errors.every((e) => !e.includes('fake-token')), 'token must not be logged');
});

test('telegram unreachable: 502, request failure logged without the url', async () => {
  const r = await send({ mode: 'down' });
  assert.equal(r.status, 502);
  assert.deepEqual(r.json, { ok: false, error: 'delivery_failed' });
  assert.ok(r.errors.some((e) => e.startsWith('lead: telegram request failed')), r.errors.join('|'));
});

// ---------- misc guards ----------

test('non-POST is rejected', async () => {
  const res = await api.fetch(new Request('http://localhost/api/lead', { method: 'GET' }));
  assert.equal(res.status, 405);
});

test('bad json: 400', async () => {
  const r = await send({ raw: '{not json' });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'bad_json');
  assert.equal(r.telegram.length, 0);
});

test('invalid body: 400, nothing sent', async () => {
  const r = await send({ body: { consent: false } });
  assert.equal(r.status, 400);
  assert.equal(r.telegram.length, 0);
});

test('rate limit: 6th request from one IP is 429, nothing sent', async () => {
  let last;
  for (let i = 0; i < 6; i++) last = await send({ sameIp: '10.9.9.9' });
  assert.equal(last.status, 429);
  assert.equal(last.telegram.length, 0);
});
