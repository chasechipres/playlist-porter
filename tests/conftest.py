import json

import pytest

from csv_playlist_import.transport import Response


def uri(n: int, kind: str = "track") -> str:
    """A syntactically valid, fake Spotify URI (22-char base62 id)."""
    return f"spotify:{kind}:{n:022d}"


class FakeSend:
    """Records requests and replays queued responses."""

    def __init__(self, responses=()):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url, headers, body))
        status, payload, *rest = self.responses.pop(0)
        body = json.dumps(payload).encode() if payload is not None else b""
        return Response(status, body, rest[0] if rest else {})


class FakeAuth:
    def __init__(self):
        self.refreshes = 0
        self.token = "t0"

    def access_token(self):
        return self.token

    def refresh(self):
        self.refreshes += 1
        self.token = f"t{self.refreshes}"


class FakeClient:
    """In-memory stand-in for SpotifyClient used by importer tests."""

    def __init__(self, search_results=None):
        self.search_results = search_results or {}
        self.playlists = {}  # id -> {"name", "public", "items"}
        self.add_calls = []
        self.searches = []

    def create_playlist(self, name, public):
        pid = f"pl{len(self.playlists)}"
        self.playlists[pid] = {"name": name, "public": public, "items": []}
        return {"id": pid, "external_urls": {"spotify": f"https://open.spotify.com/playlist/{pid}"}}

    def add_items(self, playlist_id, uris):
        assert len(uris) <= 100
        self.add_calls.append(len(uris))
        self.playlists[playlist_id]["items"].extend(uris)

    def search_track(self, name, artists, first_artist, album):
        self.searches.append((name, first_artist))
        return self.search_results.get(name)


def write_csv(path, rows, header=("Track URI", "Track Name", "Artist Name(s)", "Album Name", "Release Date")):
    import csv

    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    return path


@pytest.fixture
def fake_auth():
    return FakeAuth()
