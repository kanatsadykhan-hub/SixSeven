// Handler tests for api/lead.js with fake env values and a stubbed fetch (fake
// Auth, PostgREST and Telegram), so nothing leaves this machine. Run: npm run test:api
import { test } from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, {
  SUPABASE_URL: 'http://fake-supabase.invalid',
  SUPABASE_SECRET_KEY: 'fake-secret',
  TELEGRAM_BOT_TOKEN: 'fake-token',
  TELEGRAM_CHAT_ID: 'fake-chat',
});

const GOOD = 'aaa.bbb.good', BAD = 'aaa.bbb.bad', DOWN = 'aaa.bbb.down', ANON = 'aaa.bbb.anon';
let log, insertMode;
globalThis.fetch = async (input, init = {}) => {
  const req = input instanceof Request ? input : new Request(input, init);
  const url = new URL(req.url);
  const body = await req.text();
  if (url.pathname === '/auth/v1/user') {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
    log.auth.push({ token, apikey: req.headers.get('apikey') });
    if (token === DOWN) throw new TypeError('fetch failed');
    if (token === GOOD) return Response.json({ id: 'user-1', aud: 'authenticated', email: 'buyer@example.kz', is_anonymous: false });
    if (token === ANON) return Response.json({ id: 'user-2', aud: 'authenticated', is_anonymous: true });
    return Response.json({ code: 403, error_code: 'bad_jwt', msg: 'invalid JWT' }, { status: 403 });
  }
  if (url.pathname === '/rest/v1/leads') {
    const row = JSON.parse(body);
    log.rows.push(row);
    if (insertMode === 'fk' && row.user_id) return Response.json({ code: '23503', message: 'fk' }, { status: 409 });
    if (insertMode === 'col' && row.user_id) return Response.json({ code: 'PGRST204', message: 'no column' }, { status: 400 });
    if (insertMode === 'down') return Response.json({ code: 'XX000', message: 'boom' }, { status: 500 });
    return new Response(null, { status: 201 });
  }
  if (url.hostname === 'api.telegram.org') {
    log.telegram.push(JSON.parse(body));
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
async function send({ auth, body = {}, mode = 'ok', sameIp, headers = {}, raw } = {}) {
  log = { auth: [], rows: [], telegram: [] };
  insertMode = mode;
  errors.length = 0;
  const all = { 'content-type': 'application/json', 'x-forwarded-for': sameIp || `10.2.${Math.floor(++ip / 250)}.${ip % 250}`, ...headers };
  if (auth !== undefined) all.authorization = auth;
  const res = await api.fetch(new Request('http://localhost/api/lead', {
    method: 'POST',
    headers: all,
    body: raw ?? JSON.stringify({ ...BASE, ...body }),
  }));
  return { status: res.status, json: await res.json(), ...log, text: log.telegram[0]?.text, errors: [...errors] };
}

// ---------- validation ----------

test('valid payloads are saved', async () => {
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
    assert.equal(r.rows.length, 1);
  }
});

test('invalid fields are rejected with their names', async () => {
  const cases = [
    [{ pointType: 'Банк' }, ['pointType']],
    [{ points: '2-5' }, ['points']],
    [{ points: 1 }, ['points']],
    [{ samples: 'yes' }, ['samples']],
    [{ pointType: 'x', points: '100', samples: 1 }, ['pointType', 'points', 'samples']],
    [{ consent: false }, ['consent']],
  ];
  for (const [body, fields] of cases) {
    const r = await send({ body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.deepEqual(r.json.fields, fields);
    assert.equal(r.rows.length, 0);
  }
});

// ---------- where the request comes from ----------

test('content type must be exactly application/json', async () => {
  for (const type of ['text/plain;x=application/json', 'text/plain; charset=application/json', 'application/jsonx', 'text/plain']) {
    const r = await send({ headers: { 'content-type': type } });
    assert.equal(r.status, 415, type);
    assert.equal(r.rows.length, 0);
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
    const r = await send({ headers, auth: `Bearer ${GOOD}` });
    assert.equal(r.status, 403, JSON.stringify(headers));
    assert.deepEqual(r.json, { ok: false, error: 'forbidden_origin' });
    assert.equal(r.rows.length + r.auth.length + r.telegram.length, 0);
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

// ---------- optional sign-in ----------

test('no header: anonymous row, old response shape, no Auth call', async () => {
  const r = await send({ body: { user_id: 'attacker', userId: 'attacker' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
  assert.equal(r.auth.length, 0);
  assert.equal(r.rows.length, 1);
  assert.equal('user_id' in r.rows[0], false);
  assert.deepEqual(Object.keys(r.rows[0]).sort(), ['contact', 'message', 'name']);
  assert.equal(r.text.includes('Аккаунт'), false);
});

test('valid token: user_id from Auth, body user_id ignored', async () => {
  const r = await send({ auth: `Bearer ${GOOD}`, body: { user_id: 'attacker', userId: 'attacker' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, linked: true });
  assert.equal(r.auth.length, 1);
  assert.equal(r.auth[0].token, GOOD);
  assert.equal(r.auth[0].apikey, 'fake-secret');
  assert.equal(r.rows[0].user_id, 'user-1');
  assert.match(r.text, /Аккаунт: buyer@example\.kz/);
});

test('rejected token: anonymous row, linked false, safe log', async () => {
  const r = await send({ auth: `Bearer ${BAD}` });
  assert.deepEqual([r.status, r.json], [200, { ok: true, linked: false }]);
  assert.equal('user_id' in r.rows[0], false);
  assert.ok(r.errors.some((e) => e.startsWith('lead: auth token rejected (code: bad_jwt, HTTP 403)')), r.errors.join('|'));
  assert.ok(r.errors.every((e) => !e.includes(BAD)), 'token must not be logged');
});

test('Auth unreachable: anonymous row, linked false', async () => {
  const r = await send({ auth: `Bearer ${DOWN}` });
  assert.deepEqual([r.status, r.json], [200, { ok: true, linked: false }]);
  assert.equal('user_id' in r.rows[0], false);
});

test('anonymous Supabase user is not linked', async () => {
  const r = await send({ auth: `Bearer ${ANON}` });
  assert.deepEqual(r.json, { ok: true, linked: false });
  assert.equal('user_id' in r.rows[0], false);
});

test('malformed header: no Auth call, anonymous, linked false', async () => {
  for (const auth of ['Bearer abc', 'Basic Zm9vOmJhcg==', 'Bearer a.b.c d', `Bearer ${'a'.repeat(3000)}.${'b'.repeat(1100)}.c`]) {
    const r = await send({ auth });
    assert.equal(r.auth.length, 0, auth.slice(0, 20));
    assert.deepEqual(r.json, { ok: true, linked: false });
    assert.equal('user_id' in r.rows[0], false);
  }
});

test('user deleted (FK 23503): retried without user_id', async () => {
  const r = await send({ auth: `Bearer ${GOOD}`, mode: 'fk' });
  assert.deepEqual([r.status, r.json], [200, { ok: true, linked: false }]);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].user_id, 'user-1');
  assert.equal('user_id' in r.rows[1], false);
  assert.ok(r.errors.includes('lead: saved without user_id'));
});

test('column not migrated (PGRST204): retried without user_id', async () => {
  const r = await send({ auth: `Bearer ${GOOD}`, mode: 'col' });
  assert.deepEqual(r.json, { ok: true, linked: false });
  assert.equal(r.rows.length, 2);
});

test('other insert error: no retry, Telegram still delivers', async () => {
  const r = await send({ auth: `Bearer ${GOOD}`, mode: 'down' });
  assert.deepEqual([r.status, r.json], [200, { ok: true, linked: false }]);
  assert.equal(r.rows.length, 1);
  assert.equal(r.telegram.length, 1);
});

test('invalid body with token: 400 before any Auth call', async () => {
  const r = await send({ auth: `Bearer ${GOOD}`, body: { consent: false } });
  assert.equal(r.status, 400);
  assert.equal(r.auth.length, 0);
});

test('rate limit: 6th request is 429 before any Auth call', async () => {
  let authCalls = 0, last;
  for (let i = 0; i < 6; i++) {
    last = await send({ auth: `Bearer ${GOOD}`, sameIp: '10.9.9.9' });
    authCalls += last.auth.length;
  }
  assert.equal(last.status, 429);
  assert.equal(authCalls, 5);
});
