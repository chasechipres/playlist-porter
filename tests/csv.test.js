import assert from "node:assert/strict";
import { test } from "node:test";

import { CsvFormatError, firstArtist, parseCsv, readRows } from "../docs/js/csv.js";
import { csv, uri } from "./helpers.js";

test("parses quotes, doubled quotes, embedded commas and newlines, CRLF", () => {
  const text = 'a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\nplain,,end\n';
  assert.deepEqual(parseCsv(text), [
    ["a", "b", "c"],
    ["x, y", 'say "hi"', "line1\nline2"],
    ["plain", "", "end"],
  ]);
});

test("strips BOM and skips blank lines", () => {
  assert.deepEqual(parseCsv("﻿Track URI\r\n\r\nx\r\n"), [["Track URI"], ["x"]]);
});

test("reads Exportify columns", () => {
  const [row] = readRows(csv([[uri(1), "Song", "Tyler, The Creator;Kali Uchis", "Album", "2017-07-21"]]));
  assert.deepEqual(row, { row: 2, uri: uri(1), name: "Song", artists: "Tyler, The Creator;Kali Uchis", album: "Album" });
  assert.equal(firstArtist(row.artists), "Tyler, The Creator");
});

test("first artist falls back to comma separator for old exports", () => {
  assert.equal(firstArtist("A,B"), "A");
  assert.equal(firstArtist(""), "");
});

test("accepts the old 'Artist Name' column", () => {
  const [row] = readRows(csv([["", "Song", "Artist"]], ["Track URI", "Track Name", "Artist Name"]));
  assert.equal(row.artists, "Artist");
});

test("reads the full current Exportify header", () => {
  const header = (
    "Track URI,ISRC,Track Name,Album Name,Artist Name(s),Release Date,Duration (ms),Popularity,Explicit," +
    "Added By,Added At,Genres,Record Label,Danceability,Energy,Key,Loudness,Mode,Speechiness,Acousticness," +
    "Instrumentalness,Liveness,Valence,Tempo,Time Signature"
  ).split(",");
  const values = [uri(1), "USX", "Song", "Album", "A;B", "2020", "1", "1", "false", "u", "t", "trap,rage", "L", ...Array(12).fill("0.5")];
  const [row] = readRows(csv([values], header));
  assert.deepEqual([row.uri, row.name, row.album, row.artists], [uri(1), "Song", "Album", "A;B"]);
});

test("rejects an unrelated CSV", () => {
  assert.throws(() => readRows(csv([["1", "2"]], ["a", "b"]), "x.csv"), CsvFormatError);
});

test("short rows don't crash", () => {
  const [row] = readRows("Track URI,Track Name,Artist Name(s)\r\n" + uri(1) + "\r\n");
  assert.deepEqual([row.uri, row.name, row.artists], [uri(1), "", ""]);
});
