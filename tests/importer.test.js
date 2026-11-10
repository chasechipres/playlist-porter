import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCsv } from "../docs/js/csv.js";
import { importCsv, playlistName, reportCsv, splitParts } from "../docs/js/importer.js";
import { FakeClient, csv, uri } from "./helpers.js";

test("keeps CSV order and mixes in search results", async () => {
  const text = csv([
    [uri(1), "A", "X", "", ""],
    ["", "B", "Y;Z", "", ""], // resolved by search
    [uri(3), "C", "Z", "", ""],
  ]);
  const client = new FakeClient({ B: uri(2) });
  const { created, skipped } = await importCsv("Road Trip.csv", text, client);
  assert.deepEqual(skipped, []);
  assert.deepEqual(created.map((c) => c.name), ["Road Trip"]);
  assert.deepEqual(client.playlists.pl0.items, [uri(1), uri(2), uri(3)]);
  assert.deepEqual(client.searches, [["B", "Y"]]);
});

test("private by default, public on request", async () => {
  const text = csv([[uri(1), "A", "X", "", ""]]);
  const c1 = new FakeClient();
  const c2 = new FakeClient();
  await importCsv("p.csv", text, c1);
  await importCsv("p.csv", text, c2, { isPublic: true });
  assert.equal(c1.playlists.pl0.public, false);
  assert.equal(c2.playlists.pl0.public, true);
});

test("skips local, unmatched, invalid and empty rows", async () => {
  const text = csv([
    ["spotify:local:Artist:Album:Song:123", "Local", "Me", "", ""],
    ["", "Nowhere", "Nobody", "", ""],
    ["not-a-uri", "Bad", "X", "", ""],
    ["", "", "", "", ""],
    [uri(1), "Good", "X", "", ""],
  ]);
  const { created, skipped } = await importCsv("s.csv", text, new FakeClient());
  assert.equal(created[0].count, 1);
  assert.deepEqual(
    skipped.map((s) => [s.row, s.reason]),
    [
      [2, "local file (not on Spotify)"],
      [3, "no search match"],
      [4, "unrecognised URI"],
      [5, "no URI and no track name"],
    ]
  );
});

test("no playlist when nothing is importable", async () => {
  const client = new FakeClient();
  const { created, skipped } = await importCsv("e.csv", csv([["spotify:local:a:b:c:1", "L", "", "", ""]]), client);
  assert.deepEqual(created, []);
  assert.deepEqual(client.playlists, {});
  assert.equal(skipped.length, 1);
});

test("adds in batches of 100, in order", async () => {
  const text = csv(Array.from({ length: 250 }, (_, i) => [uri(i), `T${i}`, "A", "", ""]));
  const client = new FakeClient();
  await importCsv("big.csv", text, client);
  assert.deepEqual(client.addCalls, [100, 100, 50]);
  assert.deepEqual(client.playlists.pl0.items, Array.from({ length: 250 }, (_, i) => uri(i)));
});

test("splits over 10,000 tracks into parts", async () => {
  const text = csv(Array.from({ length: 10_001 }, (_, i) => [uri(i), `T${i}`, "A", "", ""]));
  const client = new FakeClient();
  const { created } = await importCsv("Huge.csv", text, client);
  assert.deepEqual(
    created.map((c) => [c.name, c.count]),
    [
      ["Huge (Part 1 of 2)", 10_000],
      ["Huge (Part 2 of 2)", 1],
    ]
  );
  assert.deepEqual(client.playlists.pl1.items, [uri(10_000)]);
});

test("exactly the cap is a single playlist", () => {
  const uris = [uri(0), uri(1), uri(2), uri(3)];
  assert.deepEqual(splitParts("N", uris, 4), [["N", uris]]);
  assert.deepEqual(
    splitParts("N", [...uris, uri(9)], 4).map(([n]) => n),
    ["N (Part 1 of 2)", "N (Part 2 of 2)"]
  );
});

test("playlist name is the file name without .csv", () => {
  assert.equal(playlistName("Road Trip.CSV"), "Road Trip");
  assert.equal(playlistName("a.b.csv"), "a.b");
});

test("report CSV round-trips, quoting commas", async () => {
  const text = csv([["spotify:local:a:b:c:1", "Local, Live", "Me", "", ""]]);
  const { skipped } = await importCsv("s.csv", text, new FakeClient());
  assert.deepEqual(parseCsv(reportCsv(skipped)), [
    ["file", "row", "track_name", "artists", "uri", "reason"],
    ["s.csv", "2", "Local, Live", "Me", "spotify:local:a:b:c:1", "local file (not on Spotify)"],
  ]);
});
