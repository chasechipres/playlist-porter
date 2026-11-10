// Shared fakes. Tests never call Spotify.

/** A syntactically valid, fake Spotify URI (22-char base62 id). */
export const uri = (n, kind = "track") => `spotify:${kind}:${String(n).padStart(22, "0")}`;

/** Build a CSV string from a header and rows, quoting as needed. */
export function csv(rows, header = ["Track URI", "Track Name", "Artist Name(s)", "Album Name", "Release Date"]) {
  const q = (v) => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [header, ...rows].map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
}

/** fetch() stand-in that records calls and replays [status, json, headers] tuples. */
export function fakeFetch(responses = []) {
  const queue = [...responses];
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, ...init });
    const [status, payload, headers = {}] = queue.shift();
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      status,
      headers: { get: (k) => lower[k.toLowerCase()] ?? null },
      text: async () => (payload === undefined || payload === null ? "" : JSON.stringify(payload)),
    };
  };
  fn.calls = calls;
  return fn;
}

export class FakeAuth {
  constructor() {
    this.refreshes = 0;
    this.token = "t0";
  }
  async accessToken() {
    return this.token;
  }
  async refresh() {
    this.refreshes++;
    this.token = `t${this.refreshes}`;
  }
}

/** In-memory stand-in for SpotifyClient used by importer tests. */
export class FakeClient {
  constructor(searchResults = {}) {
    this.searchResults = searchResults;
    this.playlists = {};
    this.addCalls = [];
    this.searches = [];
  }
  async createPlaylist(name, isPublic) {
    const id = `pl${Object.keys(this.playlists).length}`;
    this.playlists[id] = { name, public: isPublic, items: [] };
    return { id, external_urls: { spotify: `https://open.spotify.com/playlist/${id}` } };
  }
  async addItems(id, uris) {
    if (uris.length > 100) throw new Error("batch too big");
    this.addCalls.push(uris.length);
    this.playlists[id].items.push(...uris);
  }
  async searchTrack({ name, firstArtist }) {
    this.searches.push([name, firstArtist]);
    return this.searchResults[name] ?? null;
  }
}

export function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
