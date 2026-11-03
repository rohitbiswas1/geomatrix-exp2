import { backendUrl } from './backend';
import { waitForBackend } from './backendReady';

export function waitForAuthBackend(options = {}) {
  return waitForBackend(backendUrl('/health'), options);
}
