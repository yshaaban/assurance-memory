export function selectTenantKey(tenant: string, keys: Map<string, string>) {
  return keys.get(tenant);
}
