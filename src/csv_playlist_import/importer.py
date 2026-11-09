"""Turn CSV rows into Spotify playlists."""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional, Protocol

from .csvfile import Row, read_rows

BATCH_SIZE = 100  # max items per add request
PLAYLIST_CAP = 10_000  # Spotify's max items per playlist

URI_RE = re.compile(r"^spotify:(track|episode):[A-Za-z0-9]{22}$")


class Client(Protocol):
    def create_playlist(self, name: str, public: bool) -> dict: ...
    def add_items(self, playlist_id: str, uris: list[str]) -> None: ...
    def search_track(self, name: str, artists: str, first_artist: str, album: str) -> Optional[str]: ...


@dataclass(frozen=True)
class Skipped:
    file: str
    row: int
    track_name: str
    artists: str
    uri: str
    reason: str


@dataclass(frozen=True)
class Created:
    name: str
    id: str
    url: str
    count: int


def resolve(rows: list[Row], client: Client, source: str) -> tuple[list[str], list[Skipped]]:
    """URIs in CSV order, plus every row that could not be imported."""
    uris: list[str] = []
    skipped: list[Skipped] = []

    def skip(r: Row, reason: str):
        skipped.append(Skipped(source, r.row, r.name, r.artists, r.uri, reason))

    for r in rows:
        if r.uri.startswith("spotify:local:"):
            skip(r, "local file (not on Spotify)")
        elif r.uri:
            if URI_RE.match(r.uri):
                uris.append(r.uri)
            else:
                skip(r, "unrecognised URI")
        elif not r.name:
            skip(r, "no URI and no track name")
        else:
            found = client.search_track(r.name, r.artists, r.first_artist, r.album)
            if found:
                uris.append(found)
            else:
                skip(r, "no search match")
    return uris, skipped


def split_parts(name: str, uris: list[str], cap: int = PLAYLIST_CAP) -> list[tuple[str, list[str]]]:
    chunks = [uris[i : i + cap] for i in range(0, len(uris), cap)]
    if len(chunks) <= 1:
        return [(name, uris)]
    n = len(chunks)
    return [(f"{name} (Part {i} of {n})", c) for i, c in enumerate(chunks, start=1)]


def import_csv(
    path: Path,
    client: Client,
    public: bool = False,
    log: Callable[[str], None] = print,
) -> tuple[list[Created], list[Skipped]]:
    rows = read_rows(path)
    uris, skipped = resolve(rows, client, path.name)
    if not uris:
        log(f"{path.name}: no importable tracks; no playlist created.")
        return [], skipped

    created = []
    for name, part in split_parts(path.stem, uris):
        playlist = client.create_playlist(name, public)
        for i in range(0, len(part), BATCH_SIZE):
            client.add_items(playlist["id"], part[i : i + BATCH_SIZE])
        url = (playlist.get("external_urls") or {}).get("spotify", "")
        created.append(Created(name, playlist["id"], url, len(part)))
        log(f"Created '{name}' with {len(part)} tracks {url}".rstrip())
    return created, skipped


REPORT_FIELDS = ["file", "row", "track_name", "artists", "uri", "reason"]


def write_report(path: Path, skipped: list[Skipped]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(REPORT_FIELDS)
        for s in skipped:
            w.writerow([s.file, s.row, s.track_name, s.artists, s.uri, s.reason])
