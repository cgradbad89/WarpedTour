// RFC 4180 CSV tokenizer — pure, dependency-free, and SSR-safe (no DOM or Node
// APIs). Turns an uploaded taste export into rows of string cells for
// src/lib/tasteCsv.ts. Handles quoted fields, "" escapes, embedded commas and
// newlines, a leading UTF-8 BOM, and CRLF / CR / LF line endings.
//
// We hand-roll this rather than pull in papaparse: the input is tiny (a taste
// export), the app is fully static with no other deps, and a correct ~50-line
// state machine keeps the bundle lean and the supply chain empty.

/** Parse CSV text into a 2-D array of raw (untrimmed) cell strings. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input; // strip BOM

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let started = false; // any content seen on the current row (keeps a lone trailing field)

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    started = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // consume the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      started = true;
    } else if (c === ",") {
      endField();
      started = true;
    } else if (c === "\n") {
      endRow();
    } else if (c === "\r") {
      if (text[i + 1] === "\n") i++; // CRLF → one line break
      endRow();
    } else {
      field += c;
      started = true;
    }
  }

  // Flush a final field/row unless the file ended exactly on a line break.
  if (started || field.length > 0 || row.length > 0) endRow();

  return rows;
}
