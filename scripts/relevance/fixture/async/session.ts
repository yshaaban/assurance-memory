export function cancelSession(session: { active: boolean }) {
  session.active = false;
}
export function deliverCallback(session: { active: boolean }, deliver: () => void) {
  if (session.active) deliver();
}
