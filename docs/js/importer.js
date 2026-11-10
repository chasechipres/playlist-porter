// Turn CSV rows into Spotify playlists.

import { firstArtist, readRows } from "./csv.js";

export const BATCH_SIZE = 100; // max items per add request
export const PLAYLIST_CAP = 10_000; // Spotify's max items per playlist

const URI_RE = /^spotify:(track|episode):[A-Za-z0-9]{22}$/;

/** URIs in CSV order, plus every row that could not be imported. */
export async function resolve(rows, client, source, onProgress = () => {}) {
  const uris = [];
  const skipped = [];
  const skip = (r, reason) =>
    skipped.push({ file: source, row: r.row, trackName: r.name, artists: r.artists, uri: r.uri, reason });

  for (const [i, r] of rows.entries()) {
    if (r.uri.startsWith("spotify:local:")) {
      skip(r, "local file (not on Spotify)");
    } else if (r.uri) {
      if (URI_RE.test(r.uri)) uris.push(r.uri);
      else skip(r, "unrecognised URI");
    } else if (!r.name) {
      skip(r, "no URI and no track name");
    } else {
      const found = await client.searchTrack({ ...r, firstArtist: firstArtist(r.artists) });
      if (found) uris.push(found);
      else skip(r, "no search match");
    }
    onProgress(i + 1, rows.length);
  }
  return { uris, skipped };
}

export function splitParts(name, uris, cap = PLAYLIST_CAP) {
  const chunks = [];
  for (let i = 0; i < uris.length; i += cap) chunks.push(uris.slice(i, i + cap));
  if (chunks.length <= 1) return [[name, uris]];
  return chunks.map((c, i) => [`${name} (Part ${i + 1} of ${chunks.length})`, c]);
}

/** Playlist name for a file: its name without the .csv extension. */
export function playlistName(fileName) {
  return fileName.replace(/\.csv$/i, "");
}

/** Import one CSV's text as one playlist (or several parts). */
export async function importCsv(fileName, text, client, { isPublic = false, log = () => {} } = {}) {
  const rows = readRows(text, fileName);
  const { uris, skipped } = await resolve(rows, client, fileName);
  if (!uris.length) {
    log(`${fileName}: no importable tracks; no playlist created.`);
    return { created: [], skipped };
  }
  const created = [];
  for (const [name, part] of splitParts(playlistName(fileName), uris)) {
    const playlist = await client.createPlaylist(name, isPublic);
    for (let i = 0; i < part.length; i += BATCH_SIZE) {
      await client.addItems(playlist.id, part.slice(i, i + BATCH_SIZE));
    }
    const url = playlist.external_urls?.spotify ?? "";
    created.push({ name, id: playlist.id, url, count: part.length });
    log(`Created '${name}' with ${part.length} track${part.length === 1 ? "" : "s"}`, url);
  }
  return { created, skipped };
}

export const REPORT_FIELDS = ["file", "row", "track_name", "artists", "uri", "reason"];

function csvField(v) {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function reportCsv(skipped) {
  const lines = [REPORT_FIELDS.join(",")];
  for (const s of skipped) {
    lines.push([s.file, s.row, s.trackName, s.artists, s.uri, s.reason].map(csvField).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
