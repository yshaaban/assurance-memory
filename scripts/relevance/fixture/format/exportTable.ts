import { writeCsvRow } from './csvWriter.js';
export function exportTable(cells: string[][]) {
  return cells.map(writeCsvRow).join('\n');
}
