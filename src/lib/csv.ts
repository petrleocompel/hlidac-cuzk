/** Spreadsheets must not evaluate an exported value as a formula. */
export function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${guarded.replaceAll('"', '""')}"`
}

/** RFC 4180 line endings; callers pass already-stringified cells. */
export function csvRows(rows: string[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

/**
 * Minimal RFC 4180 reader for user-supplied files: quoted fields, escaped
 * quotes, CRLF or LF, optional BOM, comma or semicolon (Czech Excel) delimiter.
 */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '')
  const firstLine = input.split(/\r?\n/, 1)[0] ?? ''
  const outsideQuotes = firstLine.replace(/"[^"]*"/g, '')
  const delimiter =
    outsideQuotes.split(';').length > outsideQuotes.split(',').length
      ? ';'
      : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let started = false
  const endField = () => {
    row.push(field.trim())
    field = ''
  }
  const endRow = () => {
    endField()
    if (row.some((value) => value !== '')) rows.push(row)
    row = []
    started = false
  }
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += char
      continue
    }
    if (char === '"' && !started) {
      quoted = true
      started = true
      continue
    }
    if (char === delimiter) {
      endField()
      started = false
      continue
    }
    if (char === '\r') continue
    if (char === '\n') {
      endRow()
      continue
    }
    field += char
    started = true
  }
  if (field !== '' || row.length) endRow()
  return rows
}
