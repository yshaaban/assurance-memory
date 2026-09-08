export function leaseDisplayStatus(expires: number) {
  return expires > 0 ? "available" : "expired";
}
