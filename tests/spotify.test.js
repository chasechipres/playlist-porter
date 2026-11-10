import assert from "node:assert/strict";
import { test } from "node:test";

import { SpotifyClient, SpotifyError, pickMatch } from "../docs/js/spotify.js";
import { FakeAuth, fakeFetch, uri } from "./helpers.js";

function make(responses, opts = {}) {
  const fetch = fakeFetch(responses);
  const sleeps = [];
  const auth = new FakeAuth();
  const client = new SpotifyClient(auth, { fetch, sleep: async (s) => sleeps.push(s), ...opts });
  return { client, fetch, sleeps, auth };
}

test("create playlist uses POST /me/playlists", async () => {
  const { client, fetch } = make([[201, { id: "p1" }]]);
  assert.deepEqual(await client.createPlaylist("Mix", false), { id: "p1" });
  const call = fetch.calls[0];
  assert.equal(call.method, "POST");
  assert.equal(call.url, "https://api.spotify.com/v1/me/playlists");
  assert.deepEqual(JSON.parse(call.body), { name: "Mix", public: false });
  assert.equal(call.headers.Authorization, "Bearer t0");
});

test("add items uses POST /playlists/{id}/items", async () => {
  const { client, fetch } = make([[201, { snapshot_id: "s" }]]);
  await client.addItems("p1", [uri(1), uri(2)]);
  assert.equal(fetch.calls[0].url, "https://api.spotify.com/v1/playlists/p1/items");
  assert.deepEqual(JSON.parse(fetch.calls[0].body), { uris: [uri(1), uri(2)] });
});

test("add items rejects more than 100", async () => {
  const { client } = make([]);
  await assert.rejects(client.addItems("p1", Array.from({ length: 101 }, (_, i) => uri(i))), RangeError);
});

test("retries 429 using Retry-After, defaulting to 5s", async () => {
  const { client, fetch, sleeps } = make([
    [429, null, { "Retry-After": "7" }],
    [429, null],
    [201, { snapshot_id: "s" }],
  ]);
  await client.addItems("p1", [uri(1)]);
  assert.deepEqual(sleeps, [7, 5]);
  assert.equal(fetch.calls.length, 3);
});

test("reports waits through onWait", async () => {
  const waits = [];
  const { client } = make([[429, null, { "retry-after": "3" }], [201, {}]], { onWait: (s) => waits.push(s) });
  await client.addItems("p1", [uri(1)]);
  assert.deepEqual(waits, [3]);
});

test("gives up after max retries", async () => {
  const { client, sleeps } = make(Array(3).fill([429, null, { "retry-after": "1" }]), { maxRetries: 2 });
  await assert.rejects(client.addItems("p1", [uri(1)]), /gave up/);
  assert.equal(sleeps.length, 2);
});

test("refuses a very long Retry-After instead of hanging", async () => {
  const { client, sleeps } = make([[429, null, { "retry-after": "86400" }]]);
  await assert.rejects(client.addItems("p1", [uri(1)]), /wait 86400s/);
  assert.deepEqual(sleeps, []);
});

test("POST is not retried on 5xx", async () => {
  const { client, fetch } = make([[502, null]]);
  await assert.rejects(client.addItems("p1", [uri(1)]), SpotifyError);
  assert.equal(fetch.calls.length, 1);
});

test("GET is retried on 5xx with backoff", async () => {
  const { client, sleeps } = make([[503, null], [200, { tracks: { items: [] } }]]);
  await client.request("GET", "/search", { params: { q: "x" } });
  assert.deepEqual(sleeps, [2]);
});

test("refreshes the token once on 401", async () => {
  const { client, fetch, auth } = make([[401, null], [201, { id: "p" }]]);
  await client.createPlaylist("x", false);
  assert.equal(auth.refreshes, 1);
  assert.equal(fetch.calls[1].headers.Authorization, "Bearer t1");
});

test("surfaces Spotify's error message", async () => {
  const { client } = make([[403, { error: { status: 403, message: "Forbidden" } }]]);
  await assert.rejects(client.createPlaylist("x", false), /403.*Forbidden/);
});

const track = (u, name, artists, album = "") => ({ uri: u, name, artists: artists.map((a) => ({ name: a })), album: { name: album } });

test("search uses field filters and limit 10", async () => {
  const { client, fetch } = make([[200, { tracks: { items: [track(uri(1), "Song", ["Band"])] } }]]);
  assert.equal(await client.searchTrack({ name: "Song", artists: "Band", firstArtist: "Band", album: "" }), uri(1));
  const url = new URL(fetch.calls[0].url);
  assert.equal(url.searchParams.get("q"), 'track:"Song" artist:"Band"');
  assert.equal(url.searchParams.get("limit"), "10");
  assert.equal(url.searchParams.get("type"), "track");
});

test("search falls back to a plain query", async () => {
  const { client, fetch } = make([
    [200, { tracks: { items: [] } }],
    [200, { tracks: { items: [track(uri(2), "Song", ["Band"])] } }],
  ]);
  assert.equal(await client.searchTrack({ name: "Song", artists: "Band", firstArtist: "Band", album: "" }), uri(2));
  assert.equal(new URL(fetch.calls[1].url).searchParams.get("q"), "Song Band");
});

test("pickMatch requires a shared artist and prefers the same album", () => {
  const cands = [track(uri(1), "Song", ["Someone Else"]), track(uri(2), "Song", ["Band"], "Live"), track(uri(3), "Song", ["Band"], "Studio")];
  assert.equal(pickMatch(cands, "Song", "Band", "Studio"), uri(3));
  assert.equal(pickMatch(cands, "Song", "Band", ""), uri(2));
  assert.equal(pickMatch(cands.slice(0, 1), "Song", "Band", ""), null);
});

test("pickMatch handles artist names containing commas", () => {
  const cands = [track(uri(1), "See You Again", ["Tyler, The Creator"])];
  assert.equal(pickMatch(cands, "See You Again", "Tyler, The Creator;Kali Uchis", ""), uri(1));
});

test("pickMatch without an artist needs an exact name", () => {
  const cands = [track(uri(1), "Song (Remix)", ["A"]), track(uri(2), "song", ["B"])];
  assert.equal(pickMatch(cands, "Song", "", ""), uri(2));
});
