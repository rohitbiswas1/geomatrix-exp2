class BackendHealthError extends Error {}

// Only the read-only readiness request is retried. Credential and write
// requests must never be replayed after a lost response.
export async function waitForBackend(healthUrl: string, { timeoutMs = 120000, retryMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl, {
        cache: 'no-store', redirect: 'error', headers: { Connection: 'close' },
        signal: AbortSignal.timeout(Math.max(1, Math.min(10000, deadline - Date.now()))),
      });
      if (response.ok) {
        let payload;
        try { payload = await response.json(); } catch { throw new BackendHealthError('Invalid API health response.'); }
        if (payload?.status === 'ok') return;
        throw new BackendHealthError('Unexpected API health response.');
      }
      await response.body?.cancel();
      if (![502, 503, 504].includes(response.status)) throw new BackendHealthError('Unexpected API health response.');
    } catch (error) {
      if (error instanceof BackendHealthError) throw error;
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(retryMs, remaining)));
  }
  throw new Error('Authentication API did not become ready.');
}
