import assert from "node:assert/strict";
import { test } from "node:test";

import { Auth, AuthError, authorizeUrl, challengeFor, makeVerifier } from "../docs/js/auth.js";
import { fakeFetch, memoryStorage } from "./helpers.js";

test("PKCE challenge is unpadded base64url SHA-256", async () => {
  // SHA-256("abc") is the standard test vector.
  assert.equal(await challengeFor("abc"), "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
});

test("verifier length and charset fit PKCE", () => {
  const v = makeVerifier();
  assert.ok(v.length >= 43 && v.length <= 128);
  assert.match(v, /^[A-Za-z0-9\-._~]+$/);
});

test("authorize URL has PKCE params, both playlist scopes, no secret", () => {
  const q = new URL(authorizeUrl("cid", "https://x.github.io/playlist-porter/", "ch", "st")).searchParams;
  assert.equal(q.get("client_id"), "cid");
  assert.equal(q.get("response_type"), "code");
  assert.equal(q.get("redirect_uri"), "https://x.github.io/playlist-porter/");
  assert.equal(q.get("code_challenge_method"), "S256");
  assert.equal(q.get("code_challenge"), "ch");
  assert.equal(q.get("state"), "st");
  assert.deepEqual(q.get("scope").split(" ").sort(), ["playlist-modify-private", "playlist-modify-public"]);
  assert.ok(![...q.keys()].some((k) => k.includes("secret")));
});

function make(responses, nowSeconds = 1000) {
  const fetch = fakeFetch(responses);
  const storage = memoryStorage();
  const auth = new Auth({ clientId: "cid", redirectUri: "https://r/", storage, fetch, now: () => nowSeconds * 1000 });
  return { auth, fetch, storage };
}

const saved = (auth) => auth.load();

test("exchangeCode posts the verifier (no secret) and stores the token", async () => {
  const { auth, fetch } = make([[200, { access_token: "a", refresh_token: "r", expires_in: 3600 }]]);
  await auth.exchangeCode("code123", "verif");
  const form = new URLSearchParams(fetch.calls[0].body);
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(form.get("code_verifier"), "verif");
  assert.equal(form.get("client_id"), "cid");
  assert.equal(form.has("client_secret"), false);
  assert.deepEqual(saved(auth), { client_id: "cid", access_token: "a", refresh_token: "r", expires_at: 4600 });
  assert.equal(auth.isSignedIn(), true);
});

test("expired token refreshes and keeps the old refresh token", async () => {
  const { auth, fetch } = make([[200, { access_token: "new", expires_in: 3600 }]]);
  auth._store({ access_token: "old", refresh_token: "r", expires_in: 30 });
  assert.equal(await auth.accessToken(), "new");
  const form = new URLSearchParams(fetch.calls[0].body);
  assert.equal(form.get("grant_type"), "refresh_token");
  assert.equal(form.get("refresh_token"), "r");
  assert.equal(saved(auth).refresh_token, "r");
});

test("fresh token is used from storage", async () => {
  const { auth, fetch } = make([]);
  auth._store({ access_token: "a", refresh_token: "r", expires_in: 3600 });
  assert.equal(await auth.accessToken(), "a");
  assert.equal(fetch.calls.length, 0);
});

test("a token for another Client ID is not used", async () => {
  const { auth, storage } = make([]);
  storage.setItem("playlist-porter:token", JSON.stringify({ client_id: "other", access_token: "a", refresh_token: "r", expires_at: 9e9 }));
  assert.equal(auth.isSignedIn(), false);
  await assert.rejects(auth.accessToken(), AuthError);
});

test("token errors are reported", async () => {
  const { auth } = make([[400, { error: "invalid_grant", error_description: "bad code" }]]);
  await assert.rejects(auth.exchangeCode("x", "y"), /bad code/);
});

test("sign out clears the token", async () => {
  const { auth } = make([]);
  auth._store({ access_token: "a", refresh_token: "r", expires_in: 3600 });
  auth.signOut();
  assert.equal(auth.isSignedIn(), false);
});
