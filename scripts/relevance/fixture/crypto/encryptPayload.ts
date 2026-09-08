import { selectTenantKey } from './tenantKey.js';
export function encryptPayload(tenant: string, keys: Map<string, string>, payload: string) {
  return [selectTenantKey(tenant, keys), payload]; // Retrieval fixture, not encryption.
}
