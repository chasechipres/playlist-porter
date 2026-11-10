"""Reading Exportify-style playlist CSVs."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path

URI_COLUMN = "Track URI"
NAME_COLUMN = "Track Name"
# Current Exportify writes "Artist Name(s)"; older exports used "Artist Name".
ARTIST_COLUMNS = ("Artist Name(s)", "Artist Name")
ALBUM_COLUMN = "Album Name"


@dataclass(frozen=True)
class Row:
    row: int  # spreadsheet row number (header is row 1)
    uri: str
    name: str
    artists: str  # raw artist string as exported
    album: str

    @property
    def first_artist(self) -> str:
        # Exportify separates artists with ";" so names like "Tyler, The Creator"
        # keep their commas. Older exports used ",".
        sep = ";" if ";" in self.artists else ","
        return self.artists.split(sep)[0].strip()


class CsvFormatError(ValueError):
    pass


def read_rows(path: Path) -> list[Row]:
    # utf-8-sig strips the BOM that Excel and some exporters add.
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames or []
        if URI_COLUMN not in fields and NAME_COLUMN not in fields:
            raise CsvFormatError(
                f"{path.name}: expected a '{URI_COLUMN}' or '{NAME_COLUMN}' column, "
                f"found {fields}"
            )
        artist_col = next((c for c in ARTIST_COLUMNS if c in fields), None)
        rows = []
        for i, rec in enumerate(reader, start=2):
            rows.append(
                Row(
                    row=i,
                    uri=(rec.get(URI_COLUMN) or "").strip(),
                    name=(rec.get(NAME_COLUMN) or "").strip(),
                    artists=(rec.get(artist_col) or "").strip() if artist_col else "",
                    album=(rec.get(ALBUM_COLUMN) or "").strip(),
                )
            )
        return rows


def find_csvs(path: Path) -> list[Path]:
    """A single CSV, or every *.csv directly inside a folder (sorted by name)."""
    if path.is_dir():
        return sorted(p for p in path.iterdir() if p.is_file() and p.suffix.lower() == ".csv")
    return [path]
