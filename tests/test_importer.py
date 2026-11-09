import csv

from csv_playlist_import.importer import import_csv, split_parts, write_report
from conftest import FakeClient, uri, write_csv


def test_keeps_csv_order_and_mixes_in_search_results(tmp_path):
    p = write_csv(
        tmp_path / "Road Trip.csv",
        [
            [uri(1), "A", "X", "", ""],
            ["", "B", "Y", "", ""],  # resolved by search
            [uri(3), "C", "Z", "", ""],
        ],
    )
    client = FakeClient(search_results={"B": uri(2)})
    created, skipped = import_csv(p, client, log=lambda _: None)
    assert skipped == []
    assert [c.name for c in created] == ["Road Trip"]
    assert client.playlists["pl0"]["items"] == [uri(1), uri(2), uri(3)]
    assert client.searches == [("B", "Y")]


def test_private_by_default_and_public_option(tmp_path):
    p = write_csv(tmp_path / "p.csv", [[uri(1), "A", "X", "", ""]])
    c1, c2 = FakeClient(), FakeClient()
    import_csv(p, c1, log=lambda _: None)
    import_csv(p, c2, public=True, log=lambda _: None)
    assert c1.playlists["pl0"]["public"] is False
    assert c2.playlists["pl0"]["public"] is True


def test_skips_local_unmatched_invalid_and_empty_rows(tmp_path):
    p = write_csv(
        tmp_path / "s.csv",
        [
            ["spotify:local:Artist:Album:Song:123", "Local", "Me", "", ""],
            ["", "Nowhere", "Nobody", "", ""],
            ["not-a-uri", "Bad", "X", "", ""],
            ["", "", "", "", ""],
            [uri(1), "Good", "X", "", ""],
        ],
    )
    created, skipped = import_csv(p, FakeClient(), log=lambda _: None)
    assert created[0].count == 1
    assert [(s.row, s.reason) for s in skipped] == [
        (2, "local file (not on Spotify)"),
        (3, "no search match"),
        (4, "unrecognised URI"),
        (5, "no URI and no track name"),
    ]


def test_no_playlist_when_nothing_importable(tmp_path):
    p = write_csv(tmp_path / "e.csv", [["spotify:local:a:b:c:1", "L", "", "", ""]])
    client = FakeClient()
    created, skipped = import_csv(p, client, log=lambda _: None)
    assert created == [] and client.playlists == {} and len(skipped) == 1


def test_adds_in_batches_of_100(tmp_path):
    p = write_csv(tmp_path / "big.csv", [[uri(i), f"T{i}", "A", "", ""] for i in range(250)])
    client = FakeClient()
    import_csv(p, client, log=lambda _: None)
    assert client.add_calls == [100, 100, 50]
    assert client.playlists["pl0"]["items"] == [uri(i) for i in range(250)]


def test_splits_over_cap_into_parts(tmp_path):
    p = write_csv(tmp_path / "Huge.csv", [[uri(i), f"T{i}", "A", "", ""] for i in range(10_001)])
    client = FakeClient()
    created, _ = import_csv(p, client, log=lambda _: None)
    assert [(c.name, c.count) for c in created] == [("Huge (Part 1 of 2)", 10_000), ("Huge (Part 2 of 2)", 1)]
    assert client.playlists["pl1"]["items"] == [uri(10_000)]


def test_split_parts_exact_cap_is_single_playlist():
    uris = [uri(i) for i in range(4)]
    assert split_parts("N", uris, cap=4) == [("N", uris)]
    assert [n for n, _ in split_parts("N", uris + [uri(9)], cap=4)] == ["N (Part 1 of 2)", "N (Part 2 of 2)"]


def test_write_report(tmp_path):
    p = write_csv(tmp_path / "s.csv", [["spotify:local:a:b:c:1", "Local", "Me", "", ""]])
    _, skipped = import_csv(p, FakeClient(), log=lambda _: None)
    out = tmp_path / "report.csv"
    write_report(out, skipped)
    with open(out, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    assert rows == [
        {"file": "s.csv", "row": "2", "track_name": "Local", "artists": "Me",
         "uri": "spotify:local:a:b:c:1", "reason": "local file (not on Spotify)"}
    ]
