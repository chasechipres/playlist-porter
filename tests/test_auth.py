import threading
import time
import urllib.parse
import urllib.request

import pytest

from csv_playlist_import.auth import (
    Auth,
    AuthError,
    TokenStore,
    _wait_for_callback,
    authorize_url,
    challenge_for,
    make_verifier,
)
from conftest import FakeSend


def test_pkce_challenge_is_unpadded_base64url_sha256():
    # SHA-256("abc") is the standard test vector; base64url, no '=' padding, '-'/'_' alphabet.
    assert challenge_for("abc") == "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0"


def test_verifier_length_and_charset():
    v = make_verifier()
    assert 43 <= len(v) <= 128
    assert set(v) <= set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")


def test_authorize_url_has_pkce_params_and_no_secret():
    q = urllib.parse.parse_qs(urllib.parse.urlparse(authorize_url("cid", "http://127.0.0.1:8888/callback", "ch", "st")).query)
    assert q["client_id"] == ["cid"]
    assert q["response_type"] == ["code"]
    assert q["code_challenge_method"] == ["S256"]
    assert q["code_challenge"] == ["ch"]
    assert q["state"] == ["st"]
    assert set(q["scope"][0].split()) == {"playlist-modify-private", "playlist-modify-public"}
    assert not any("secret" in k for k in q)


def make_auth(tmp_path, responses, now=1000.0):
    send = FakeSend(responses)
    auth = Auth("cid", TokenStore(tmp_path / "token.json"), send=send, now=lambda: now)
    return auth, send


def test_exchange_code_stores_token(tmp_path):
    auth, send = make_auth(tmp_path, [(200, {"access_token": "a", "refresh_token": "r", "expires_in": 3600})])
    auth.exchange_code("code123", "verif")
    form = urllib.parse.parse_qs(send.calls[0][3].decode())
    assert form["grant_type"] == ["authorization_code"]
    assert form["code_verifier"] == ["verif"]
    assert "client_secret" not in form
    assert auth.store.load() == {"client_id": "cid", "access_token": "a", "refresh_token": "r", "expires_at": 4600.0}


def test_access_token_refreshes_when_expired_and_keeps_refresh_token(tmp_path):
    auth, send = make_auth(tmp_path, [(200, {"access_token": "new", "expires_in": 3600})])
    auth.store.save({"client_id": "cid", "access_token": "old", "refresh_token": "r", "expires_at": 1030.0})
    assert auth.access_token() == "new"
    form = urllib.parse.parse_qs(send.calls[0][3].decode())
    assert form["grant_type"] == ["refresh_token"] and form["refresh_token"] == ["r"]
    assert auth.store.load()["refresh_token"] == "r"


def test_access_token_uses_cache_when_fresh(tmp_path):
    auth, send = make_auth(tmp_path, [])
    auth.store.save({"client_id": "cid", "access_token": "a", "refresh_token": "r", "expires_at": 5000.0})
    assert auth.access_token() == "a"
    assert send.calls == []


def test_token_for_other_client_id_is_not_used(tmp_path):
    auth, _ = make_auth(tmp_path, [])
    auth.store.save({"client_id": "other", "access_token": "a", "refresh_token": "r", "expires_at": 5000.0})
    with pytest.raises(AuthError, match="Not signed in"):
        auth.access_token()


def test_token_error_is_reported(tmp_path):
    auth, _ = make_auth(tmp_path, [(400, {"error": "invalid_grant", "error_description": "bad code"})])
    with pytest.raises(AuthError, match="bad code"):
        auth.exchange_code("x", "y")


def test_callback_server_captures_code():
    redirect = "http://127.0.0.1:8899/callback"
    result = {}
    t = threading.Thread(target=lambda: result.update(_wait_for_callback(redirect, timeout=10)))
    t.start()
    for _ in range(50):
        try:
            urllib.request.urlopen(redirect + "?code=abc&state=xyz", timeout=2).read()
            break
        except OSError:
            time.sleep(0.1)
    t.join(10)
    assert result == {"code": "abc", "state": "xyz"}
