import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });
const origin = process.env.LOGIN_TEST_URL || 'http://127.0.0.1:3000';
const identity = { email: 'officer@example.com', name: 'Officer', role: 'Project Officer' };
const googleScript = `
  window.google = { accounts: { id: {
    initialize(options) { window.mockCredential = options.callback; },
    renderButton(element, options) {
      const button = document.createElement('button');
      button.textContent = 'Continue with Google';
      button.style.width = options.width + 'px';
      button.addEventListener('click', () => {
        options.click_listener?.();
        window.mockCredential({ credential: 'test-id-token' });
      });
      element.appendChild(button);
    }
  } } };
`;

async function setup(options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 1280, height: 900 } });
  const page = await context.newPage();
  const state = { signedIn: !!options.signedIn, posts: 0, scripts: 0 };
  await page.route('https://accounts.google.com/gsi/client', async (route) => {
    state.scripts++;
    if (options.script) return options.script(route, state);
    await route.fulfill({ contentType: 'application/javascript', body: googleScript });
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') {
      if (options.sessionDelay) await new Promise(resolve => setTimeout(resolve, options.sessionDelay));
      return route.fulfill({ status: state.signedIn ? 200 : 401,
        json: state.signedIn ? { user: identity } : { error: 'Sign in required.' } });
    }
    if (path === '/api/auth/google') {
      state.posts++;
      if (options.signIn) return options.signIn(route, state);
      state.signedIn = true;
      return route.fulfill({ json: identity });
    }
    const data = path.endsWith('/dashboard-summary') ? { total_projects: 0, alerts_open: 0, data_available: false,
      critical_count: 0, high_count: 0, medium_count: 0, low_count: 0, total_land_ha: 0, total_families: 0, message: 'Empty test workspace' } :
      path === '/api/alerts/summary' ? { total: 0, open: 0, critical: 0, high: 0 } :
      path === '/api/model/status' ? { trained: false } :
      path === '/api/map/geojson' ? { type: 'FeatureCollection', features: [] } : [];
    return route.fulfill({ json: data });
  });
  await page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded' });
  return { context, page, state };
}

async function visible(locator) { await locator.waitFor({ state: 'visible', timeout: 15000 }); }

test('existing server session redirects to dashboard without another Google prompt', async () => {
  const { context, page, state } = await setup({ signedIn: true, sessionDelay: 350 });
  try {
    await page.waitForURL('**/dashboard');
    assert.equal(state.scripts, 0);
  } finally { await context.close(); }
});

test('SDK loading has feedback, then renders a mobile-sized button', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { context, page } = await setup({ viewport: { width: 320, height: 760 }, script: async route => {
    await gate; await route.fulfill({ contentType: 'application/javascript', body: googleScript });
  } });
  try {
    await visible(page.getByText('Loading Google sign-in…', { exact: true }));
    release();
    const button = page.getByRole('button', { name: 'Continue with Google', exact: true });
    await visible(button);
    const bounds = await button.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 320);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.getByText('Prototype Authentication Only').count(), 0);
    await visible(page.getByText('Secure Google sign-in', { exact: true }));
  } finally { release(); await context.close(); }
});

test('blocked Google script offers a working retry', async () => {
  const { context, page, state } = await setup({ script: async (route, state) => {
    if (state.scripts === 1) return route.abort('failed');
    return route.fulfill({ contentType: 'application/javascript', body: googleScript });
  } });
  try {
    await visible(page.locator('.error-alert'));
    await page.getByRole('button', { name: 'Retry Google sign-in', exact: true }).click();
    await visible(page.getByRole('button', { name: 'Continue with Google', exact: true }));
    assert.equal(state.scripts, 2);
    assert.equal(await page.locator('.error-alert').count(), 0);
  } finally { await context.close(); }
});

test('authentication errors allow another attempt and successful redirect', async () => {
  const { context, page, state } = await setup({ signIn: async (route, state) => {
    if (state.posts === 1) return route.fulfill({ status: 401, json: { error: 'Google account could not be verified.' } });
    state.signedIn = true;
    return route.fulfill({ json: identity });
  } });
  try {
    const button = page.getByRole('button', { name: 'Continue with Google', exact: true });
    await button.click();
    await visible(page.getByText('Google account could not be verified.', { exact: true }));
    await button.click();
    await page.waitForURL('**/dashboard');
    assert.equal(state.posts, 2);
  } finally { await context.close(); }
});

test('slow sign-in shows progress and ignores duplicate credentials', { timeout: 25000 }, async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { context, page, state } = await setup({ signIn: async (route, state) => {
    await gate; state.signedIn = true; return route.fulfill({ json: identity });
  } });
  try {
    await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
    await visible(page.getByText('Signing you in…', { exact: true }));
    await page.evaluate(() => window.mockCredential({ credential: 'duplicate' }));
    await visible(page.getByText('The sign-in service is starting. This may take up to a minute.', { exact: true }));
    assert.equal(state.posts, 1);
    release();
    await page.waitForURL('**/dashboard');
  } finally { release(); await context.close(); }
});

test('theme changes keep a single functioning Google button', async () => {
  const { context, page } = await setup();
  try {
    const button = page.getByRole('button', { name: 'Continue with Google', exact: true });
    await visible(button);
    await page.getByRole('radio', { name: 'Light', exact: true }).click();
    await visible(button);
    assert.equal(await page.locator('.login-page-wrapper').getAttribute('data-theme'), 'light');
    await page.getByRole('radio', { name: 'Dark', exact: true }).click();
    await visible(button);
    assert.equal(await button.count(), 1);
    await button.click();
    await page.waitForURL('**/dashboard');
  } finally { await context.close(); }
});
