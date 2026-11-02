import { jsonError, proxyBackend } from '../../../lib/backend';

// Only the known domain namespaces may be proxied. Auth has explicit handlers.
function forward(request: Request) {
  const namespace = new URL(request.url).pathname.split('/')[2];
  if (!['projects', 'alerts', 'ingest', 'model', 'map'].includes(namespace)) {
    return jsonError('API endpoint not found.', 404);
  }
  return proxyBackend(request);
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const DELETE = forward;
