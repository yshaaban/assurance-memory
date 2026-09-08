import { commitTransaction } from './transactionWriter.js';
export function exportDocument(write: () => void, rollback: () => void) {
  commitTransaction(write, rollback);
}
