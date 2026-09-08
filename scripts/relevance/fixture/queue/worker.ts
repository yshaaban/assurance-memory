import { renewLease } from './leaseOwner.js';
export function acknowledgeJob(token: number, current: number, expires: number) {
  return renewLease(token, current, expires);
}
