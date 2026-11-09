"""Spotify OAuth: Authorization Code with PKCE. No client secret involved.

Each user registers their own Spotify developer app and passes its Client ID.
Tokens are cached in the user's config directory, never in the project folder.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import sys
import time
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Callable, Optional

from .transport import Send, urllib_send

AUTHORIZE_URL = "https://accounts.spotify.com/authorize"
TOKEN_URL = "https://accounts.spotify.com/api/token"
SCOPES = "playlist-modify-private playlist-modify-public"
# Spotify requires loopback redirect URIs to use an IP literal, not "localhost".
DEFAULT_REDIRECT_URI = "http://127.0.0.1:8888/callback"
APP_DIR_NAME = "csv-playlist-import"


class AuthError(RuntimeError):
    pass


def make_verifier() -> str:
    # 64 random bytes -> 86 url-safe chars, within PKCE's 43..128 range.
    return secrets.token_urlsafe(64)


def challenge_for(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def authorize_url(client_id: str, redirect_uri: str, challenge: str, state: str) -> str:
    query = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "code_challenge_method": "S256",
            "code_challenge": challenge,
            "scope": SCOPES,
            "state": state,
        }
    )
    return f"{AUTHORIZE_URL}?{query}"


def default_token_path() -> Path:
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming")
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    return base / APP_DIR_NAME / "token.json"


class TokenStore:
    def __init__(self, path: Path):
        self.path = path

    def load(self) -> Optional[dict]:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None

    def save(self, token: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(token), encoding="utf-8")
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass

    def clear(self) -> bool:
        try:
            self.path.unlink()
            return True
        except FileNotFoundError:
            return False


def _wait_for_callback(redirect_uri: str, timeout: float) -> dict:
    """Serve one request on the loopback redirect URI and return its query params."""
    parsed = urllib.parse.urlparse(redirect_uri)
    result: dict = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            url = urllib.parse.urlparse(self.path)
            if url.path != parsed.path:
                self.send_response(404)
                self.end_headers()
                return
            params = dict(urllib.parse.parse_qsl(url.query))
            result.update(params)
            ok = "code" in params
            self.send_response(200 if ok else 400)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            msg = "Signed in. You can close this tab." if ok else "Sign-in failed. Check the terminal."
            self.wfile.write(f"<html><body><p>{msg}</p></body></html>".encode())

        def log_message(self, *args):
            pass

    server = HTTPServer((parsed.hostname or "127.0.0.1", parsed.port or 80), Handler)
    server.timeout = 1
    deadline = time.monotonic() + timeout
    try:
        while not result and time.monotonic() < deadline:
            server.handle_request()
    finally:
        server.server_close()
    if not result:
        raise AuthError("Timed out waiting for the Spotify sign-in redirect.")
    return result


class Auth:
    def __init__(
        self,
        client_id: str,
        store: TokenStore,
        redirect_uri: str = DEFAULT_REDIRECT_URI,
        send: Send = urllib_send,
        now: Callable[[], float] = time.time,
    ):
        self.client_id = client_id
        self.store = store
        self.redirect_uri = redirect_uri
        self._send = send
        self._now = now

    # --- token endpoint -------------------------------------------------
    def _token_request(self, form: dict) -> dict:
        body = urllib.parse.urlencode(form).encode()
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        resp = self._send("POST", TOKEN_URL, headers, body)
        data = resp.json() or {}
        if resp.status != 200:
            raise AuthError(
                f"Token request failed ({resp.status}): "
                f"{data.get('error_description') or data.get('error') or resp.body[:200]!r}"
            )
        return data

    def _store_token(self, data: dict, previous: Optional[dict] = None) -> dict:
        token = {
            "client_id": self.client_id,
            "access_token": data["access_token"],
            # Spotify may omit refresh_token on refresh; keep the old one then.
            "refresh_token": data.get("refresh_token") or (previous or {}).get("refresh_token"),
            "expires_at": self._now() + int(data.get("expires_in", 3600)),
        }
        self.store.save(token)
        return token

    def exchange_code(self, code: str, verifier: str) -> dict:
        data = self._token_request(
            {
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": self.redirect_uri,
                "client_id": self.client_id,
                "code_verifier": verifier,
            }
        )
        return self._store_token(data)

    def refresh(self) -> dict:
        current = self.store.load()
        if not current or current.get("client_id") != self.client_id or not current.get("refresh_token"):
            raise AuthError("Not signed in. Run: csv-playlist-import login")
        data = self._token_request(
            {
                "grant_type": "refresh_token",
                "refresh_token": current["refresh_token"],
                "client_id": self.client_id,
            }
        )
        return self._store_token(data, previous=current)

    # --- public API -----------------------------------------------------
    def login(self, open_browser: Callable[[str], bool] = webbrowser.open, timeout: float = 300) -> dict:
        verifier = make_verifier()
        state = secrets.token_urlsafe(16)
        url = authorize_url(self.client_id, self.redirect_uri, challenge_for(verifier), state)
        print("Opening Spotify sign-in in your browser. If it does not open, visit:\n" + url)
        open_browser(url)
        params = _wait_for_callback(self.redirect_uri, timeout)
        if "error" in params:
            raise AuthError(f"Spotify sign-in was denied: {params['error']}")
        if params.get("state") != state:
            raise AuthError("Sign-in state mismatch; aborting.")
        return self.exchange_code(params["code"], verifier)

    def access_token(self) -> str:
        token = self.store.load()
        if not token or token.get("client_id") != self.client_id:
            raise AuthError("Not signed in with this Client ID. Run: csv-playlist-import login")
        if token["expires_at"] - 60 <= self._now():
            token = self.refresh()
        return token["access_token"]
