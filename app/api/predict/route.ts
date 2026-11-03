import { checkOrigin, jsonError, proxyBackend } from '../../../lib/backend';

export async function POST(request: Request) {
  const originError = checkOrigin(request);
  if (originError) return originError;
  let body;
  try { body = await request.json(); } catch { return jsonError('Provide a project ID.', 400); }
  if (typeof body?.project_id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.project_id)) return jsonError('Provide a valid project ID.', 400);
  return proxyBackend(new Request(new URL('/api/projects/' + body.project_id + '/predict-risk', request.url), {
    method: 'POST', headers: request.headers,
  }));
}
export async function GET() { return jsonError('Submit a project ID using POST.', 405); }
