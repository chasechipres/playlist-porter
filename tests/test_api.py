import json

import pytest

from playlist_porter.api import SpotifyClient, SpotifyError, pick_match
from conftest import FakeSend, uri


def make(responses, auth, **kw):
    send = FakeSend(responses)
    sleeps = []
    client = SpotifyClient(auth, send=send, sleep=sleeps.append, **kw)
    return client, send, sleeps


def test_create_playlist_uses_me_endpoint(fake_auth):
    client, send, _ = make([(201, {"id": "p1"})], fake_auth)
    assert client.create_playlist("Mix", public=False) == {"id": "p1"}
    method, url, headers, body = send.calls[0]
    assert (method, url) == ("POST", "https://api.spotify.com/v1/me/playlists")
    assert json.loads(body) == {"name": "Mix", "public": False}
    assert headers["Authorization"] == "Bearer t0"


def test_add_items_uses_items_endpoint(fake_auth):
    client, send, _ = make([(201, {"snapshot_id": "s"})], fake_auth)
    client.add_items("p1", [uri(1), uri(2)])
    method, url, _, body = send.calls[0]
    assert (method, url) == ("POST", "https://api.spotify.com/v1/playlists/p1/items")
    assert json.loads(body) == {"uris": [uri(1), uri(2)]}


def test_add_items_rejects_more_than_100(fake_auth):
    client, _, _ = make([], fake_auth)
    with pytest.raises(ValueError):
        client.add_items("p1", [uri(i) for i in range(101)])


def test_retries_429_using_retry_after(fake_auth):
    client, send, sleeps = make(
        [(429, None, {"retry-after": "7"}), (429, None, {}), (201, {"snapshot_id": "s"})], fake_auth
    )
    client.add_items("p1", [uri(1)])
    assert sleeps == [7.0, 5.0]  # missing header falls back to 5s
    assert len(send.calls) == 3


def test_gives_up_after_max_retries(fake_auth):
    client, _, sleeps = make([(429, None, {"retry-after": "1"})] * 3, fake_auth, max_retries=2)
    with pytest.raises(SpotifyError, match="gave up"):
        client.add_items("p1", [uri(1)])
    assert len(sleeps) == 2


def test_refuses_very_long_retry_after(fake_auth):
    client, _, sleeps = make([(429, None, {"retry-after": "86400"})], fake_auth)
    with pytest.raises(SpotifyError, match="wait 86400s"):
        client.add_items("p1", [uri(1)])
    assert sleeps == []


def test_post_not_retried_on_5xx(fake_auth):
    client, send, _ = make([(502, None)], fake_auth)
    with pytest.raises(SpotifyError, match="502"):
        client.add_items("p1", [uri(1)])
    assert len(send.calls) == 1


def test_get_retried_on_5xx(fake_auth):
    client, _, sleeps = make([(503, None), (200, {"tracks": {"items": []}})], fake_auth)
    client.request("GET", "/search", params={"q": "x"})
    assert sleeps == [2.0]


def test_refreshes_token_once_on_401(fake_auth):
    client, send, _ = make([(401, None), (201, {"id": "p"})], fake_auth)
    client.create_playlist("x", False)
    assert fake_auth.refreshes == 1
    assert send.calls[1][2]["Authorization"] == "Bearer t1"


def test_error_message_surfaces(fake_auth):
    client, _, _ = make([(403, {"error": {"status": 403, "message": "Forbidden"}})], fake_auth)
    with pytest.raises(SpotifyError, match="403.*Forbidden"):
        client.create_playlist("x", False)


def track(u, name, artists, album=""):
    return {"uri": u, "name": name, "artists": [{"name": a} for a in artists], "album": {"name": album}}


def test_search_uses_field_filters_and_limit_10(fake_auth):
    client, send, _ = make([(200, {"tracks": {"items": [track(uri(1), "Song", ["Band"])]}})], fake_auth)
    assert client.search_track("Song", "Band", "Band", "") == uri(1)
    url = send.calls[0][1]
    assert "limit=10" in url and "type=track" in url
    assert "track%3A%22Song%22+artist%3A%22Band%22" in url


def test_search_falls_back_to_plain_query(fake_auth):
    client, send, _ = make(
        [(200, {"tracks": {"items": []}}), (200, {"tracks": {"items": [track(uri(2), "Song", ["Band"])]}})],
        fake_auth,
    )
    assert client.search_track("Song", "Band", "Band", "") == uri(2)
    assert len(send.calls) == 2


def test_pick_match_requires_artist_and_prefers_album():
    cands = [
        track(uri(1), "Song", ["Someone Else"]),
        track(uri(2), "Song", ["Band"], "Live"),
        track(uri(3), "Song", ["Band"], "Studio"),
    ]
    assert pick_match(cands, "Song", "Band", "Studio") == uri(3)
    assert pick_match(cands, "Song", "Band", "") == uri(2)
    assert pick_match(cands[:1], "Song", "Band", "") is None


def test_pick_match_handles_artist_names_with_commas():
    cands = [track(uri(1), "See You Again", ["Tyler, The Creator"])]
    assert pick_match(cands, "See You Again", "Tyler, The Creator,Kali Uchis", "") == uri(1)


def test_pick_match_without_artist_needs_exact_name():
    cands = [track(uri(1), "Song (Remix)", ["A"]), track(uri(2), "song", ["B"])]
    assert pick_match(cands, "Song", "", "") == uri(2)
