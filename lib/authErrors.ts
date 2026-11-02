/** Read only known message fields; never stringify unknown objects or validation inputs. */
export function authErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fallback;
  const value = payload as Record<string, unknown>;
  const nested = value.error && typeof value.error === 'object' && !Array.isArray(value.error)
    ? value.error as Record<string, unknown> : null;
  if (nested && ['DEPLOYMENT_PROTECTED', 'AUTHENTICATION_REQUIRED', 'DEPLOYMENT_NOT_FOUND'].includes(String(nested.code))) {
    return 'This preview needs renewed access. Reopen the preview link or use the live site.';
  }
  for (const candidate of [value.error, value.detail, value.message, nested?.message]) {
    if (typeof candidate === 'string' && candidate.trim() && candidate.length <= 500 &&
        candidate.trim() !== '[object Object]' && !/<[a-z][\s\S]*>/i.test(candidate)) return candidate.trim();
  }
  return fallback;
}
