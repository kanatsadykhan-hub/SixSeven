// Cabinet tests against a local build of dist/ and the project's own Supabase.
// .env.local is parsed here and never printed. The build gets all of it (so the
// dist.mjs leak guard also checks the real server secrets); the test workers get
// only the URL, the publishable key and the test accounts.
import { defineConfig } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const PORT = 8079;
const envFile = new URL('.env.local', import.meta.url);
const fromFile = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};

const FOR_TESTS = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'TEST_A_EMAIL', 'TEST_A_PASSWORD', 'TEST_B_EMAIL', 'TEST_B_PASSWORD'];
const missing = FOR_TESTS.filter((name) => !(process.env[name] || fromFile[name]));
if (missing.length) throw new Error(`.env.local is missing: ${missing.join(', ')}`);
for (const name of FOR_TESTS) process.env[name] ||= fromFile[name];
process.env.TEST_BASE_URL = `http://127.0.0.1:${PORT}`;

// Site URL variables are left out: the build then reproduces the committed
// blog/, sitemap.xml and index.html exactly. The cabinet uses relative paths.
const buildEnv = { ...process.env, ...fromFile, TEST_PORT: String(PORT) };
delete buildEnv.SITE_ORIGIN;
delete buildEnv.SITE_BASE_PATH;

export default defineConfig({
  testDir: 'tests',
  testMatch: '*.spec.mjs',
  outputDir: 'test-results',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // list only: no HTML/JSON report, no traces or videos that could hold typed values.
  reporter: [['list']],
  use: {
    baseURL: process.env.TEST_BASE_URL,
    trace: 'off',
    video: 'off',
    screenshot: 'off', // failures get a masked screenshot from the spec instead
    locale: 'ru-RU',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'node tests/serve-dist.mjs',
    url: `http://127.0.0.1:${PORT}/cabinet/`,
    env: buildEnv,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
