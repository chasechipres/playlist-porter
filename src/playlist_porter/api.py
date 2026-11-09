"""The few Spotify Web API calls this tool needs, with retry on rate limits."""

from __future__ import annotations

import json
import time
import urllib.parse
from typing import Callable, Optional

from .auth import Auth
from .transport import Response, Send, urllib_send

API_BASE = "https://api.spotify.com/v1"
SEARCH_LIMIT = 10  # Spotify's maximum since the February 2026 changes


class SpotifyError(RuntimeError):
    pass


def _retry_after(resp: Response) -> float:
    try:
        return max(1.0, float(resp.headers.get("retry-after", "5")))
    except ValueError:
        return 5.0


class SpotifyClient:
    def __init__(
        self,
        auth: Auth,
        send: Send = urllib_send,
        sleep: Callable[[float], None] = time.sleep,
        max_retries: int = 8,
        max_retry_wait: float = 600,
    ):
        self._auth = auth
        self._send = send
        self._sleep = sleep
        self.max_retries = max_retries
        self.max_retry_wait = max_retry_wait

    def request(self, method: str, path: str, params: Optional[dict] = None, body=None):
        url = API_BASE + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        data = json.dumps(body).encode() if body is not None else None
        refreshed = False
        attempts = 0
        while True:
            headers = {"Authorization": f"Bearer {self._auth.access_token()}"}
            if data is not None:
                headers["Content-Type"] = "application/json"
            resp = self._send(method, url, headers, data)

            if resp.status == 401 and not refreshed:
                self._auth.refresh()
                refreshed = True
                continue

            # 429 means the request was not applied, so any method is safe to retry.
            # 5xx is only retried for GET, so a POST is never applied twice.
            retryable = resp.status == 429 or (resp.status >= 500 and method == "GET")
            if retryable:
                attempts += 1
                if attempts > self.max_retries:
                    raise SpotifyError(f"{method} {path}: gave up after {self.max_retries} retries ({resp.status})")
                wait = _retry_after(resp) if resp.status == 429 else min(2.0**attempts, 30.0)
                if wait > self.max_retry_wait:
                    raise SpotifyError(
                        f"Spotify asked to wait {wait:.0f}s before retrying (limit {self.max_retry_wait:.0f}s). "
                        "Try again later."
                    )
                self._sleep(wait)
                continue

            if resp.status >= 400:
                try:
                    msg = (resp.json() or {}).get("error", {}).get("message", "")
                except (ValueError, AttributeError):
                    msg = resp.body[:200].decode(errors="replace")
                raise SpotifyError(f"{method} {path} failed ({resp.status}): {msg}")
            return resp.json()

    def create_playlist(self, name: str, public: bool) -> dict:
        return self.request("POST", "/me/playlists", body={"name": name, "public": public})

    def add_items(self, playlist_id: str, uris: list[str]) -> None:
        if len(uris) > 100:
            raise ValueError("Spotify accepts at most 100 items per request")
        self.request("POST", f"/playlists/{playlist_id}/items", body={"uris": uris})

    def search_track(self, name: str, artists: str, first_artist: str, album: str) -> Optional[str]:
        """Best-effort match by name and artist. Returns a track URI, or None."""
        clean = lambda s: s.replace('"', "")
        queries = []
        if first_artist:
            queries.append(f'track:"{clean(name)}" artist:"{clean(first_artist)}"')
            queries.append(f"{name} {first_artist}")
        else:
            queries.append(f'track:"{clean(name)}"')
        for q in queries:
            result = self.request("GET", "/search", params={"q": q, "type": "track", "limit": SEARCH_LIMIT})
            uri = pick_match((result or {}).get("tracks", {}).get("items", []), name, artists, album)
            if uri:
                return uri
        return None


def pick_match(candidates: list[dict], name: str, artists: str, album: str) -> Optional[str]:
    """Accept a result only if an artist matches (or, with no artist, the name matches
    exactly). Among accepted results, prefer one from the same album."""
    artists_cf = artists.casefold()
    accepted = []
    for c in candidates:
        if not c or not c.get("uri"):
            continue
        if artists:
            ok = any(a.get("name") and a["name"].casefold() in artists_cf for a in c.get("artists", []))
        else:
            ok = c.get("name", "").casefold() == name.casefold()
        if ok:
            accepted.append(c)
    if not accepted:
        return None
    if album:
        for c in accepted:
            if (c.get("album") or {}).get("name", "").casefold() == album.casefold():
                return c["uri"]
    return accepted[0]["uri"]
