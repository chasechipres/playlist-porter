// Page wiring: sign-in, file selection, import, report download.

import { Auth, authorizeUrl, challengeFor, makeState, makeVerifier } from "./auth.js";
import { readRows } from "./csv.js";
import { importCsv, playlistName, reportCsv } from "./importer.js";
import { SpotifyClient } from "./spotify.js";

const CLIENT_ID_KEY = "playlist-porter:client-id";
const PKCE_KEY = "playlist-porter:pkce";

const $ = (id) => document.getElementById(id);
const redirectUri = location.origin + location.pathname.replace(/index\.html$/, "");

let files = []; // [{file, rows, error}]
let running = false;

function store(storage) {
  // Storage can throw in some privacy modes; fall back to memory.
  try {
    storage.setItem("playlist-porter:probe", "1");
    storage.removeItem("playlist-porter:probe");
    return storage;
  } catch {
    const m = new Map();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  }
}
const local = store(window.localStorage);
const session = store(window.sessionStorage);

function auth() {
  const clientId = $("client-id").value.trim();
  return clientId ? new Auth({ clientId, redirectUri, storage: local }) : null;
}

function log(text, { url, error } = {}) {
  const li = document.createElement("li");
  li.textContent = text;
  if (error) li.className = "error";
  if (url) {
    li.append(" ");
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "Open";
    li.append(a);
  }
  $("log").append(li);
  li.scrollIntoView({ block: "nearest" });
}

function render() {
  const a = auth();
  const signedIn = !!a && a.isSignedIn();
  $("auth-status").textContent = signedIn ? "Signed in" : "Not signed in";
  $("auth-status").classList.toggle("ok", signedIn);
  $("sign-in").hidden = signedIn;
  $("sign-out").hidden = !signedIn;
  $("sign-in").disabled = !a || running;
  $("client-id").disabled = running;
  const usable = files.filter((f) => !f.error);
  $("import").disabled = running || !signedIn || !usable.length;
  $("import").textContent = usable.length > 1 ? `Import ${usable.length} playlists` : "Import";
}

async function signIn() {
  const a = auth();
  if (!a) return;
  const verifier = makeVerifier();
  const state = makeState();
  session.setItem(PKCE_KEY, JSON.stringify({ verifier, state, clientId: a.clientId }));
  location.assign(authorizeUrl(a.clientId, redirectUri, await challengeFor(verifier), state));
}

async function handleRedirect() {
  const params = new URLSearchParams(location.search);
  if (!params.has("code") && !params.has("error")) return;
  history.replaceState(null, "", redirectUri); // don't leave the code in the address bar
  const saved = JSON.parse(session.getItem(PKCE_KEY) || "null");
  session.removeItem(PKCE_KEY);
  if (params.has("error")) return log(`Spotify sign-in was cancelled or denied: ${params.get("error")}`, { error: true });
  if (!saved || saved.state !== params.get("state")) return log("Sign-in state mismatch. Please sign in again.", { error: true });
  $("client-id").value = saved.clientId;
  local.setItem(CLIENT_ID_KEY, saved.clientId);
  try {
    await auth().exchangeCode(params.get("code"), saved.verifier);
    log("Signed in to Spotify.");
  } catch (e) {
    log(e.message, { error: true });
  }
}

async function selectFiles(list) {
  // For a folder, only take CSVs directly inside it, not in subfolders.
  const topLevel = (f) => !f.webkitRelativePath || f.webkitRelativePath.split("/").length === 2;
  const csvs = [...list]
    .filter((f) => /\.csv$/i.test(f.name) && topLevel(f))
    .sort((a, b) => a.name.localeCompare(b.name));
  files = await Promise.all(
    csvs.map(async (file) => {
      try {
        return { file, rows: readRows(await file.text(), file.name) };
      } catch (e) {
        return { file, error: e.message };
      }
    })
  );
  const ul = $("file-list");
  ul.replaceChildren();
  if (!files.length && list.length) log("No .csv files in that selection.", { error: true });
  for (const f of files) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = playlistName(f.file.name);
    const meta = document.createElement("span");
    meta.className = f.error ? "meta bad" : "meta";
    meta.textContent = f.error ? "not a playlist CSV" : `${f.rows.length.toLocaleString()} rows`;
    if (f.error) meta.title = f.error;
    li.append(name, meta);
    ul.append(li);
  }
  render();
}

async function runImport() {
  const a = auth();
  const usable = files.filter((f) => !f.error);
  if (!a || !usable.length) return;
  running = true;
  render();
  $("log").replaceChildren();
  $("report").hidden = true;
  const client = new SpotifyClient(a, {
    onWait: (s) => log(`Spotify rate limit hit; waiting ${s}s and retrying…`),
  });
  const isPublic = $("public").checked;
  const skipped = [];
  let createdCount = 0;
  try {
    for (const [i, f] of usable.entries()) {
      $("progress").textContent = `Importing ${i + 1} of ${usable.length}: ${f.file.name}`;
      const result = await importCsv(f.file.name, await f.file.text(), client, {
        isPublic,
        log: (text, url) => log(text, { url }),
      });
      createdCount += result.created.length;
      skipped.push(...result.skipped);
    }
    $("progress").textContent = `Done: ${createdCount} playlist${createdCount === 1 ? "" : "s"} created.`;
  } catch (e) {
    log(e.message, { error: true });
    $("progress").textContent = "Stopped because of an error. Playlists already created stay on your account.";
  } finally {
    // Offer the report even after an error, so earlier skips aren't lost.
    if (skipped.length) {
      const link = $("report");
      URL.revokeObjectURL(link.href);
      link.href = URL.createObjectURL(new Blob([reportCsv(skipped)], { type: "text/csv" }));
      link.download = "skipped-tracks.csv";
      link.textContent = `Download skipped-rows report (${skipped.length} row${skipped.length === 1 ? "" : "s"})`;
      link.hidden = false;
    } else {
      log("No rows skipped.");
    }
    running = false;
    render();
  }
}

$("redirect-uri").textContent = redirectUri;
$("copy-redirect").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(redirectUri);
    $("copy-redirect").textContent = "Copied";
    setTimeout(() => ($("copy-redirect").textContent = "Copy"), 1500);
  } catch {}
});
$("client-id").value = local.getItem(CLIENT_ID_KEY) || "";
$("client-id").addEventListener("input", () => {
  local.setItem(CLIENT_ID_KEY, $("client-id").value.trim());
  render();
});
$("sign-in").addEventListener("click", signIn);
$("sign-out").addEventListener("click", () => {
  auth()?.signOut();
  render();
});
$("files").addEventListener("change", (e) => selectFiles(e.target.files));
$("folder").addEventListener("change", (e) => selectFiles(e.target.files));
$("import").addEventListener("click", runImport);
window.addEventListener("beforeunload", (e) => {
  if (running) e.preventDefault();
});

await handleRedirect();
render();
