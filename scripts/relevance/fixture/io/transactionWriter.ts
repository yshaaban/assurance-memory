export function commitTransaction(write: () => void, rollback: () => void) {
  try { write(); } catch (error) { rollback(); throw error; }
}
