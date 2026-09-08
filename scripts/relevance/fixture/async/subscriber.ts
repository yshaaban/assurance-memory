import { deliverCallback } from './session.js';
export function subscribeSession(session: { active: boolean }, listener: () => void) {
  return () => deliverCallback(session, listener);
}
