export function escapeCsvCell(cell: string) {
  return '"' + cell.replaceAll('"', '""') + '"';
}
export function writeCsvRow(cells: string[]) {
  return cells.map(escapeCsvCell).join(',');
}
