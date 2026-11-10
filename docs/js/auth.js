// Spotify OAuth: Authorization Code with PKCE, entirely in the browser.
// No client secret: each user registers their own Spotify app and pastes its
// Client ID. Tokens stay in this browser's storage.

export const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
export const TOKEN_URL = "https://accounts.spotify.com/api/token";
export const SCOPES = "playlist-modify-private playlist-modify-public";
const TOKEN_KEY = "playlist-porter:token";

export class AuthError extends Error {}

function base64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function makeVerifier() {
  // 64 random bytes -> 86 url-safe chars, within PKCE's 43..128 range.
  return base64url(crypto.getRandomValues(new Uint8Array(64)));
}

export function makeState() {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

export async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function authorizeUrl(clientId, redirectUri, challenge, state) {
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SCOPES,
    state,
  });
  return `${AUTHORIZE_URL}?${q}`;
}

export class Auth {
  constructor({ clientId, redirectUri, storage, fetch = globalThis.fetch.bind(globalThis), now = Date.now }) {
    this.clientId = clientId;
    this.redirectUri = redirectUri;
    this.storage = storage;
    this._fetch = fetch;
    this._now = () => now() / 1000; // seconds
  }

  load() {
    try {
      return JSON.parse(this.storage.getItem(TOKEN_KEY) || "null");
    } catch {
      return null;
    }
  }

  isSignedIn() {
    const t = this.load();
    return !!t && t.client_id === this.clientId && !!t.refresh_token;
  }

  signOut() {
    this.storage.removeItem(TOKEN_KEY);
  }

  async _tokenRequest(form) {
    const resp = await this._fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
    const text = await resp.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {}
    if (resp.status !== 200) {
      throw new AuthError(
        `Token request failed (${resp.status}): ${data.error_description || data.error || text.slice(0, 200)}`
      );
    }
    return data;
  }

  _store(data, previous) {
    const token = {
      client_id: this.clientId,
      access_token: data.access_token,
      // Spotify may omit refresh_token on refresh; keep the old one then.
      refresh_token: data.refresh_token || previous?.refresh_token,
      expires_at: this._now() + Number(data.expires_in ?? 3600),
    };
    this.storage.setItem(TOKEN_KEY, JSON.stringify(token));
    return token;
  }

  async exchangeCode(code, verifier) {
    const data = await this._tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri,
      client_id: this.clientId,
      code_verifier: verifier,
    });
    return this._store(data);
  }

  async refresh() {
    const current = this.load();
    if (!current || current.client_id !== this.clientId || !current.refresh_token) {
      throw new AuthError("Not signed in. Sign in with Spotify first.");
    }
    const data = await this._tokenRequest({
      grant_type: "refresh_token",
      refresh_token: current.refresh_token,
      client_id: this.clientId,
    });
    return this._store(data, current);
  }

  async accessToken() {
    let token = this.load();
    if (!token || token.client_id !== this.clientId) {
      throw new AuthError("Not signed in with this Client ID. Sign in with Spotify first.");
    }
    if (token.expires_at - 60 <= this._now()) token = await this.refresh();
    return token.access_token;
  }
}
