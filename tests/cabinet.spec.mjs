// Cabinet end-to-end tests: local dist/ build + the project's own Supabase.
// Credentials come from process.env (see playwright.config.mjs) and are typed via
// evaluate(), so they never show up in action titles, call logs or errors.
// Nothing here creates leads or writes to a table; the network guard enforces it.
import { test as base, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const env = process.env;
const site = new URL(env.TEST_BASE_URL);
const supabase = new URL(env.SUPABASE_URL);
const A = { email: env.TEST_A_EMAIL, password: env.TEST_A_PASSWORD };
const B = { email: env.TEST_B_EMAIL, password: env.TEST_B_PASSWORD };
const BAD_CREDENTIALS = 'Неверный e-mail или пароль.';

// The only Supabase calls the cabinet may make: sign-in, token refresh, sign-out,
// the current user and reading leads. Sign-up and any write are blocked.
const ALLOWED = [
  ['POST', /^\/auth\/v1\/token$/, (url) => ['password', 'refresh_token'].includes(url.searchParams.get('grant_type'))],
  ['POST', /^\/auth\/v1\/logout$/],
  ['GET', /^\/auth\/v1\/user$/],
  ['GET', /^\/rest\/v1\/leads$/],
];

const test = base.extend({
  // Every page goes through this: our server and Supabase only, everything else
  // (fonts) is aborted. Violations are recorded as method + path, never a query.
  guard: [
    async ({ context }, use) => {
      const guard = { violations: [], supabase: [] };
      await context.route('**/*', (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const method = request.method();
        if (url.origin === site.origin) {
          if (!url.pathname.startsWith('/api/')) return route.continue();
          guard.violations.push(`${method} ${url.pathname}`);
          return route.abort();
        }
        if (url.origin === supabase.origin) {
          guard.supabase.push(`${method} ${url.pathname}`);
          const ok = method === 'OPTIONS' || ALLOWED.some(([m, path, extra]) => m === method && path.test(url.pathname) && (!extra || extra(url)));
          if (ok) return route.continue();
          guard.violations.push(`${method} ${url.pathname}`);
          return route.abort();
        }
        return route.abort();
      });
      await use(guard);
      expect(guard.violations, 'requests the tests must never make').toEqual([]);
    },
    { auto: true },
  ],
});

// Failed tests leave a screenshot with every e-mail and lead text masked.
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  await page
    .screenshot({
      path: testInfo.outputPath('failure.png'),
      fullPage: true,
      mask: [page.locator('#auth-email, #me-email, #check-email-address, .cab-who, .cab-msg')],
      timeout: 5_000,
    })
    .catch(() => {});
});

const setField = (locator, value) =>
  locator.evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);

const hasSession = (page) =>
  page.evaluate(() => Object.keys(localStorage).some((key) => /^sb-.+-auth-token$/.test(key)));

const sameEmail = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

async function openCabinet(page) {
  await page.goto('/cabinet/');
  await expect(page.locator('#cab-off'), 'sign-in is on (dist/cabinet/config.json was built)').toBeHidden();
  await expect(page.locator('#cab-signed-out')).toBeVisible();
}

async function submitSignIn(page, email, password) {
  await setField(page.locator('#auth-email'), email);
  await setField(page.locator('#auth-password'), password);
  await page.locator('#auth-submit').click();
}

async function signIn(page, who, label) {
  await openCabinet(page);
  await submitSignIn(page, who.email, who.password);
  await expect(page.locator('#cab-signed-in')).toBeVisible();
  const shown = await page.locator('#me-email').textContent();
  expect(sameEmail(shown, who.email), `the cabinet shows the e-mail of account ${label}`).toBe(true);
}

async function signOut(page) {
  await page.locator('#sign-out').click();
  await expect(page.locator('#cab-signed-out')).toBeVisible();
  await expect(page.locator('#cab-signed-in')).toBeHidden();
  expect(await hasSession(page), 'session removed from localStorage').toBe(false);
}

// Waits until the list has loaded and fails on a loading error.
async function leadsLoaded(page) {
  await expect(page.locator('#leads-status')).toHaveText('');
}

test('1. A signs in with the right password and signs out', async ({ page }) => {
  await signIn(page, A, 'A');
  expect(await hasSession(page), 'session stored in localStorage').toBe(true);
  await signOut(page);
});

test('2. a wrong password shows the generic error', async ({ page }) => {
  await openCabinet(page);
  await submitSignIn(page, A.email, `wrong-${randomUUID()}`);
  await expect(page.locator('#auth-status')).toHaveText(BAD_CREDENTIALS);
  await expect(page.locator('#auth-status')).toHaveClass(/cab-error/);

  // An unknown address gets exactly the same answer: no hint whether an account exists.
  await submitSignIn(page, `nobody-${randomUUID()}@example.com`, `wrong-${randomUUID()}`);
  await expect(page.locator('#auth-status')).toHaveText(BAD_CREDENTIALS);

  await expect(page.locator('#cab-signed-in')).toBeHidden();
  expect(await hasSession(page), 'no session after failed sign-ins').toBe(false);
});

test('3. A sees their own lead', async ({ page }) => {
  await signIn(page, A, 'A');
  await leadsLoaded(page);
  const cards = page.locator('#leads .cab-lead');
  const count = await cards.count();
  expect(count, 'account A has at least one linked lead (send one while signed in as A first)').toBeGreaterThan(0);
  await expect(page.locator('#leads-empty')).toBeHidden();
  for (let i = 0; i < count; i++) await expect(cards.nth(i).locator('.cab-date')).not.toHaveText('');
  await signOut(page);
});

test('4. B signs in and sees an empty list', async ({ page }) => {
  await signIn(page, B, 'B');
  await leadsLoaded(page);
  await expect(page.locator('#leads-empty')).toBeVisible();
  await expect(page.locator('#leads .cab-lead')).toHaveCount(0);
  await signOut(page);
});

test('5. an anonymous visitor sees only the sign-in form', async ({ page, guard }) => {
  await openCabinet(page);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#cab-signed-in')).toBeHidden();
  await expect(page.locator('#cab-check-email')).toBeHidden();
  await expect(page.locator('#leads > *')).toHaveCount(0);
  await expect(page.locator('#me-email')).toHaveText('');
  expect(await hasSession(page), 'no session for an anonymous visitor').toBe(false);
  expect(guard.supabase.filter((call) => call.includes('/rest/v1/')), 'no data requests without sign-in').toEqual([]);
});

test('6. the REST API returns no leads to the publishable key without sign-in', async ({ request }) => {
  const res = await request.get(new URL('/rest/v1/leads?select=*&limit=5', supabase).href, {
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY },
  });
  const status = res.status();
  const body = await res.json().catch(() => null);
  // Status and PostgREST error code only; a row's content is never printed.
  console.log(`REST anon GET /rest/v1/leads: HTTP ${status}${body?.code ? ` ${body.code}` : ''}`);
  if (status === 200) {
    expect(Array.isArray(body) ? body.length : -1, 'rows returned to an anonymous request').toBe(0);
  } else {
    expect([401, 403, 404], `HTTP ${status} is not a "no access" answer`).toContain(status);
  }
});
