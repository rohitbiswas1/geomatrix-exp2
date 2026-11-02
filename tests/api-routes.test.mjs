import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { jar, cookieOptions } from './next.mock.mjs';

// Exercise the real route handlers while providing their request-scoped Next APIs.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (['next/headers', 'next/server'].includes(specifier)) {
      return { url: new URL('./next.mock.mjs', import.meta.url).href, shortCircuit: true };
    }
    if (specifier.startsWith('.') && context.parentURL) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { proxyBackend, checkOrigin, SESSION_COOKIE } = await import('../lib/backend.ts');
const { DELETE: removeProject, POST: createProject } = await import('../app/api/projects/route.ts')
  .then(async ({ POST }) => ({ POST, DELETE: (await import('../app/api/projects/[id]/route.ts')).DELETE }));
const { POST: explain } = await import('../app/api/gemini/explain/route.ts');
const { POST: logout } = await import('../app/api/auth/logout/route.ts');
const { GET: ingestionLog } = await import('../app/api/[...path]/route.ts');

beforeEach(() => {
  jar.clear(); cookieOptions.clear();
  process.env.MODEL_API_URL = 'https://api.example.com';
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
});
afterEach(() => mock.restoreAll());
function request(path, options = {}) {
  return new Request(`https://app.example.com${path}`, {
    ...options, headers: { Origin: 'https://app.example.com', ...options.headers },
  });
}

test('unauthenticated requests never reach the backend', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', () => { throw Error('must not fetch'); });
  assert.equal((await createProject(request('/api/projects', { method: 'POST', body: '{}' }))).status, 401);
  assert.equal(fetchMock.mock.callCount(), 0);
});
test('cross-origin and missing-origin cookie writes are rejected', () => {
  for (const origin of ['https://attacker.example', 'null', '']) {
    assert.equal(checkOrigin(request('/api/projects', { method: 'POST', headers: { Origin: origin } })).status, 403);
  }
  assert.equal(checkOrigin(request('/api/projects', { method: 'POST' })), null);
});
test('project creation forwards body, session and persisted backend response', async () => {
  jar.set(SESSION_COOKIE, 'server-token');
  mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://api.example.com/api/projects');
    assert.equal(init.headers.get('Authorization'), 'Bearer server-token');
    assert.deepEqual(JSON.parse(new TextDecoder().decode(init.body)), { name: 'Saved project' });
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    return Response.json({ id: 'persisted-id', risk_score: null }, { status: 201 });
  });
  const response = await createProject(request('/api/projects', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer forged-client-token' },
    body: JSON.stringify({ name: 'Saved project' }),
  }));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: 'persisted-id', risk_score: null });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('backend validation errors and delete responses are preserved', async () => {
  jar.set(SESSION_COOKIE, 'server-token');
  mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));
  const deleted = await removeProject(request('/api/projects/id', { method: 'DELETE' }));
  assert.equal(deleted.status, 204);
  assert.equal(await deleted.text(), '');
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () => Response.json({ detail: 'duplicate project' }, { status: 409 }));
  const conflict = await createProject(request('/api/projects', { method: 'POST', body: '{}' }));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).detail, 'duplicate project');
});
test('multipart historical uploads preserve the query and boundary', async () => {
  jar.set(SESSION_COOKIE, 'server-token');
  const form = new FormData();
  form.append('file', new File(['project_code,delayed\np1,true'], 'history.csv'));
  mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://api.example.com/api/ingest/upload?data_type=historical');
    assert.match(init.headers.get('content-type'), /multipart\/form-data; boundary=/);
    assert.match(new TextDecoder().decode(init.body), /history.csv/);
    return Response.json({ records_saved: 1 });
  });
  assert.equal((await proxyBackend(request('/api/ingest/upload?data_type=historical', { method: 'POST', body: form }))).status, 200);
});
test('missing ingestion-log route now forwards to the backend', async () => {
  jar.set(SESSION_COOKIE, 'server-token');
  mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(url, 'https://api.example.com/api/ingest/log?limit=20');
    return Response.json([]);
  });
  assert.deepEqual(await (await ingestionLog(request('/api/ingest/log?limit=20'))).json(), []);
});
test('Gemini handler forwards to the configured authenticated backend', async () => {
  jar.set(SESSION_COOKIE, 'server-token');
  mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://api.example.com/api/gemini/explain');
    assert.equal(init.headers.get('Authorization'), 'Bearer server-token');
    return Response.json({ summary: 'Explanation', source: 'gemini' });
  });
  assert.equal((await (await explain(request('/api/gemini/explain', { method: 'POST', body: '{}' }))).json()).source, 'gemini');
});
test('backend outages fail explicitly without successful fake records', async () => {
  jar.set(SESSION_COOKIE, 'server-token');
  mock.method(globalThis, 'fetch', async () => { throw Error('unavailable'); });
  assert.equal((await createProject(request('/api/projects', { method: 'POST', body: '{}' }))).status, 503);
});
test('large streaming bodies are rejected before forwarding', async () => {
  jar.set(SESSION_COOKIE, 'server-token');
  const fetchMock = mock.method(globalThis, 'fetch', async () => { throw Error('must not fetch'); });
  assert.equal((await createProject(request('/api/projects', { method: 'POST', body: 'x'.repeat(12 * 1024 * 1024) }))).status, 413);
  assert.equal(fetchMock.mock.callCount(), 0);
});
test('logout revokes the backend session before clearing the cookie', async () => {
  jar.set(SESSION_COOKIE, 'server-token');
  mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(url, 'https://api.example.com/api/auth/logout');
    return new Response(null, { status: 204 });
  });
  assert.equal((await logout(request('/api/auth/logout', { method: 'POST' }))).status, 204);
  assert.equal(jar.has(SESSION_COOKIE), false);
});
test('logout outage retains cookie so revocation can be retried', async () => {
  jar.set(SESSION_COOKIE, 'server-token');
  mock.method(globalThis, 'fetch', async () => { throw Error('unavailable'); });
  assert.equal((await logout(request('/api/auth/logout', { method: 'POST' }))).status, 503);
  assert.equal(jar.has(SESSION_COOKIE), true);
});

// Login additionally needs the project's installed Zod dependency.
test('login sets a secure HttpOnly cookie and never exposes the session token', {
  skip: !existsSync(new URL('../node_modules/zod/package.json', import.meta.url)),
}, async () => {
  const { POST: login } = await import('../app/api/auth/google/route.ts');
  process.env.NODE_ENV = 'production';
  try {
    mock.method(globalThis, 'fetch', async () => Response.json({
      token: 'private-token', user: { email: 'officer@example.com' }, expires_in: 28800,
    }));
    const response = await login(request('/api/auth/google', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: 'google-id-token' }) }));
    assert.deepEqual(await response.json(), { email: 'officer@example.com' });
    assert.equal(jar.get(SESSION_COOKIE), 'private-token');
    assert.deepEqual(cookieOptions.get(SESSION_COOKIE), {
      httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 28800,
    });
  } finally { delete process.env.NODE_ENV; }
});

test('password registration and login set HttpOnly sessions without returning credentials', async () => {
  const { passwordAuth } = await import('../lib/passwordAuth.ts');
  for (const action of ['login', 'register']) {
    jar.clear();
    mock.method(globalThis, 'fetch', async (url, init) => {
      assert.equal(url, `https://api.example.com/api/auth/${action}`);
      const body = JSON.parse(init.body);
      assert.equal(body.email, 'officer@example.com');
      assert.equal(body.password, 'A long test passphrase');
      assert.equal(body.confirmPassword, undefined);
      return Response.json({ token: 'private-token', user: { name: 'Officer' }, expires_in: 28800 }, { status: action === 'register' ? 201 : 200 });
    });
    const response = await passwordAuth(request(`/api/auth/${action}`, { method: 'POST',
      body: JSON.stringify({ email: 'officer@example.com', password: 'A long test passphrase', name: 'Officer', confirmPassword: 'never forward this' }) }), action);
    assert.deepEqual(await response.json(), { name: 'Officer' });
    assert.equal(jar.get(SESSION_COOKIE), 'private-token');
    assert.equal(cookieOptions.get(SESSION_COOKIE).httpOnly, true);
    assert.equal(cookieOptions.get(SESSION_COOKIE).sameSite, 'lax');
    mock.restoreAll();
  }
});

test('password auth rejects invalid input and cross-origin requests before upstream', async () => {
  const { passwordAuth } = await import('../lib/passwordAuth.ts');
  const fetchMock = mock.method(globalThis, 'fetch', () => { throw Error('must not fetch'); });
  assert.equal((await passwordAuth(request('/api/auth/register', { method: 'POST', body: JSON.stringify({email:'a@b.com', password:'short', name:'A'}) }), 'register')).status, 400);
  assert.equal((await passwordAuth(request('/api/auth/login', { method: 'POST', body: 'invalid' }), 'login')).status, 400);
  assert.equal((await passwordAuth(request('/api/auth/login', { method: 'POST', body: '{}', headers: { Origin: 'https://attacker.example' } }), 'login')).status, 403);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('password auth preserves errors and never saves a cookie on failure', async () => {
  const { passwordAuth } = await import('../lib/passwordAuth.ts');
  mock.method(globalThis, 'fetch', async () => Response.json({ detail: 'Too many attempts.' }, { status: 429 }));
  const response = await passwordAuth(request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'a@b.com', password: 'wrong' }) }), 'login');
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error, 'Too many attempts.');
  assert.equal(jar.size, 0);
});
