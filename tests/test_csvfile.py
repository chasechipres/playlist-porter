import pytest

from csv_playlist_import.csvfile import CsvFormatError, find_csvs, read_rows
from conftest import uri, write_csv


def test_reads_exportify_columns(tmp_path):
    p = write_csv(tmp_path / "Mix.csv", [[uri(1), "Song", "Tyler, The Creator,Kali Uchis", "Album", "2017-07-21"]])
    (row,) = read_rows(p)
    assert row.row == 2
    assert row.uri == uri(1)
    assert row.name == "Song"
    assert row.artists == "Tyler, The Creator,Kali Uchis"
    assert row.first_artist == "Tyler"
    assert row.album == "Album"


def test_handles_utf8_bom(tmp_path):
    p = tmp_path / "bom.csv"
    p.write_bytes("﻿Track URI,Track Name\r\n" .encode("utf-8") + f"{uri(1)},Song\r\n".encode())
    assert read_rows(p)[0].uri == uri(1)


def test_accepts_old_artist_column(tmp_path):
    p = write_csv(tmp_path / "old.csv", [["", "Song", "Artist"]], header=("Track URI", "Track Name", "Artist Name"))
    assert read_rows(p)[0].artists == "Artist"


def test_rejects_unrelated_csv(tmp_path):
    p = write_csv(tmp_path / "x.csv", [["1", "2"]], header=("a", "b"))
    with pytest.raises(CsvFormatError):
        read_rows(p)


def test_find_csvs_folder_sorted_and_filtered(tmp_path):
    for n in ["b.csv", "a.CSV", "notes.txt"]:
        (tmp_path / n).write_text("Track URI\n")
    (tmp_path / "sub").mkdir()
    assert [p.name for p in find_csvs(tmp_path)] == ["a.CSV", "b.csv"]


def test_find_csvs_single_file(tmp_path):
    p = tmp_path / "one.csv"
    assert find_csvs(p) == [p]
