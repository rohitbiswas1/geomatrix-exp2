import { backendUrl } from './backend';

// Wake an idle API using a read-only request. Never replay a credential POST:
// registration may already have committed even if its response was lost.
export async function waitForAuthBackend({ timeoutMs = 120000, retryMs = 1000 } = {}) {
  const healthUrl = backendUrl('/health');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl, {
        cache: 'no-store', redirect: 'error',
        signal: AbortSignal.timeout(Math.max(1, Math.min(10000, deadline - Date.now()))),
      });
      if (response.ok && (await response.json()).status === 'ok') return;
      await response.body?.cancel();
      if (![502, 503, 504].includes(response.status)) throw new Error('Unexpected API health response.');
    } catch (error) {
      // Connection failures and gateway startup pages are safe to retry here.
      if (error instanceof Error && error.message === 'Unexpected API health response.') throw error;
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(retryMs, remaining)));
  }
  throw new Error('Authentication API did not become ready.');
}
