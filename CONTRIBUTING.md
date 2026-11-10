# Contributing to playlist-porter

Thanks for helping. This is a small, dependency-free project, and the rules below keep it that way.

## How changes land

- `main` is protected. Every change goes through a pull request; direct pushes, force-pushes and deleting `main` are blocked.
- The **CI / test** check must pass before a PR can merge. It runs `npm test` on Node 22.
- PRs are **squash-merged**, so each PR becomes one commit on `main`. Write the PR title as that commit's message: short and imperative, like "Add ISRC search fallback".
- Merging to `main` publishes the site, because GitHub Pages serves `docs/` from `main`.

## Workflow

1. Fork the repo, or create a branch if you have write access:
   ```bash
   git switch -c my-change
   ```
2. Make your change, and add or update tests in `tests/`.
3. Run the tests (Node 20 or newer, no install step):
   ```bash
   npm test
   ```
4. Update `README.md` if your change affects what users see or do: new options, changed behaviour, limits or setup steps.
5. Push and open a pull request against `main`. Describe what changed, how you tested it, and anything you couldn't test, such as a real Spotify sign-in.

## Ground rules

- **No dependencies, no build step.** The site is plain HTML, CSS and ES modules in `docs/`, and the tests use Node's built-in `node:test`. Please don't add a package unless there's no reasonable alternative, and discuss it in an issue first.
- **Never call Spotify from tests.** Use the fakes in `tests/helpers.js` (`fakeFetch`, `FakeClient`, `FakeAuth`).
- **Keep user data in the browser.** Nothing may send CSV contents, tokens or Client IDs anywhere except Spotify's own endpoints. No analytics or third-party scripts.
- **Respect Spotify's current API rules.** As of 2026, development-mode apps use `POST /me/playlists` and `/playlists/{id}/items`, search returns at most 10 results, and audio features and bulk artist lookups are unavailable. Check the [Web API changelog](https://developer.spotify.com/documentation/web-api/references/changes) before relying on an endpoint.

## Trying the page locally

Serve `docs/` on `127.0.0.1` and add that address as an extra Redirect URI in your own Spotify app:

```bash
python -m http.server 8000 --bind 127.0.0.1 --directory docs
```

Then open `http://127.0.0.1:8000/` and add `http://127.0.0.1:8000/` in your app's settings. Spotify allows plain `http` only for loopback IP addresses, so use `127.0.0.1`, not `localhost`.

## Using Claude Code here

The repo's `.claude/settings.json` has a hook that stops Claude Code from running `gh pr create` until `README.md` has changed on the branch. If a change really doesn't need a README update, open the PR yourself.

## Reporting bugs

Open an issue with the steps to reproduce, what you expected, and what happened. A sample CSV with a few rows helps, but **remove anything personal**. Never paste sign-in tokens or the contents of your browser storage.
