// The few Spotify Web API calls this tool needs, with retry on rate limits.

export const API_BASE = "https://api.spotify.com/v1";
export const SEARCH_LIMIT = 10; // Spotify's maximum since the February 2026 changes

export class SpotifyError extends Error {}

const realSleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

function retryAfter(resp) {
  const v = Number(resp.headers.get("retry-after") ?? "5");
  return Number.isFinite(v) ? Math.max(1, v) : 5;
}

export class SpotifyClient {
  constructor(
    auth,
    { fetch = globalThis.fetch.bind(globalThis), sleep = realSleep, maxRetries = 8, maxRetryWait = 600, onWait = () => {} } = {}
  ) {
    this.auth = auth;
    this._fetch = fetch;
    this._sleep = sleep;
    this.maxRetries = maxRetries;
    this.maxRetryWait = maxRetryWait;
    this.onWait = onWait;
  }

  async request(method, path, { params, body } = {}) {
    let url = API_BASE + path;
    if (params) url += "?" + new URLSearchParams(params);
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    let refreshed = false;
    let attempts = 0;
    for (;;) {
      const headers = { Authorization: `Bearer ${await this.auth.accessToken()}` };
      if (data !== undefined) headers["Content-Type"] = "application/json";
      const resp = await this._fetch(url, { method, headers, body: data });

      if (resp.status === 401 && !refreshed) {
        await this.auth.refresh();
        refreshed = true;
        continue;
      }

      // 429 means the request was not applied, so any method is safe to retry.
      // 5xx is only retried for GET, so a POST is never applied twice.
      const retryable = resp.status === 429 || (resp.status >= 500 && method === "GET");
      if (retryable) {
        attempts++;
        if (attempts > this.maxRetries) {
          throw new SpotifyError(`${method} ${path}: gave up after ${this.maxRetries} retries (${resp.status})`);
        }
        const wait = resp.status === 429 ? retryAfter(resp) : Math.min(2 ** attempts, 30);
        if (wait > this.maxRetryWait) {
          throw new SpotifyError(
            `Spotify asked to wait ${wait}s before retrying (limit ${this.maxRetryWait}s). Try again later.`
          );
        }
        this.onWait(wait);
        await this._sleep(wait);
        continue;
      }

      const text = await resp.text();
      if (resp.status >= 400) {
        let msg = text.slice(0, 200);
        try {
          msg = JSON.parse(text).error?.message ?? msg;
        } catch {}
        throw new SpotifyError(`${method} ${path} failed (${resp.status}): ${msg}`);
      }
      return text ? JSON.parse(text) : null;
    }
  }

  createPlaylist(name, isPublic) {
    return this.request("POST", "/me/playlists", { body: { name, public: isPublic } });
  }

  async addItems(playlistId, uris) {
    if (uris.length > 100) throw new RangeError("Spotify accepts at most 100 items per request");
    await this.request("POST", `/playlists/${playlistId}/items`, { body: { uris } });
  }

  /** Best-effort match by name and artist. Returns a track URI, or null. */
  async searchTrack({ name, artists, firstArtist, album }) {
    const clean = (s) => s.replace(/"/g, "");
    const queries = firstArtist
      ? [`track:"${clean(name)}" artist:"${clean(firstArtist)}"`, `${name} ${firstArtist}`]
      : [`track:"${clean(name)}"`];
    for (const q of queries) {
      const result = await this.request("GET", "/search", { params: { q, type: "track", limit: SEARCH_LIMIT } });
      const uri = pickMatch(result?.tracks?.items ?? [], name, artists, album);
      if (uri) return uri;
    }
    return null;
  }
}

/** Accept a result only if an artist matches (or, with no artist, the name matches
 *  exactly). Among accepted results, prefer one from the same album. */
export function pickMatch(candidates, name, artists, album) {
  const lower = (s) => (s ?? "").toLowerCase();
  const artistsLc = lower(artists);
  const accepted = candidates.filter((c) => {
    if (!c?.uri) return false;
    if (artists) return (c.artists ?? []).some((a) => a?.name && artistsLc.includes(lower(a.name)));
    return lower(c.name) === lower(name);
  });
  if (!accepted.length) return null;
  if (album) {
    const same = accepted.find((c) => lower(c.album?.name) === lower(album));
    if (same) return same.uri;
  }
  return accepted[0].uri;
}
