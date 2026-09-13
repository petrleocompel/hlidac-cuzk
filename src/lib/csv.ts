/** Spreadsheets must not evaluate an exported value as a formula. */
export function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${guarded.replaceAll('"', '""')}"`
}

/** RFC 4180 line endings; callers pass already-stringified cells. */
export function csvRows(rows: string[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}
