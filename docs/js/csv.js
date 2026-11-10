// Reading Exportify-style playlist CSVs.

export const URI_COLUMN = "Track URI";
export const NAME_COLUMN = "Track Name";
// Current Exportify writes "Artist Name(s)"; older exports used "Artist Name".
export const ARTIST_COLUMNS = ["Artist Name(s)", "Artist Name"];
export const ALBUM_COLUMN = "Album Name";

export class CsvFormatError extends Error {}

/** RFC 4180 parser: quoted fields, doubled quotes, CRLF/LF, leading BOM. */
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const records = [];
  let record = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || record.length) {
    record.push(field);
    records.push(record);
  }
  // Drop completely blank lines, like Python's csv.DictReader.
  return records.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Exportify separates artists with ";" so names like "Tyler, The Creator" keep
 *  their commas. Older exports used ",". */
export function firstArtist(artists) {
  const sep = artists.includes(";") ? ";" : ",";
  return artists.split(sep)[0].trim();
}

/** Rows as {row, uri, name, artists, album}; `row` is the spreadsheet row number
 *  (header is row 1). */
export function readRows(text, fileName = "CSV") {
  const [header = [], ...records] = parseCsv(text);
  const col = (name) => header.indexOf(name);
  if (col(URI_COLUMN) < 0 && col(NAME_COLUMN) < 0) {
    throw new CsvFormatError(
      `${fileName}: expected a '${URI_COLUMN}' or '${NAME_COLUMN}' column, found ${JSON.stringify(header)}`
    );
  }
  const artistCol = ARTIST_COLUMNS.map(col).find((i) => i >= 0) ?? -1;
  const get = (rec, i) => (i >= 0 ? (rec[i] ?? "").trim() : "");
  return records.map((rec, n) => ({
    row: n + 2,
    uri: get(rec, col(URI_COLUMN)),
    name: get(rec, col(NAME_COLUMN)),
    artists: get(rec, artistCol),
    album: get(rec, col(ALBUM_COLUMN)),
  }));
}
