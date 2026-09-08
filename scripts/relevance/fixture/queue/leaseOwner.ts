export function renewLease(token: number, current: number, expires: number) {
  return token === current && expires > 0;
}
export function releaseLease(token: number, current: number) {
  return token === current;
}
