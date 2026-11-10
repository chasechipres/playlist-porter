# playlist-porter

Import playlists from CSV files into Spotify, with no limit on how many playlists or tracks you import.

**Use it here: https://chasechipres.github.io/playlist-porter/**

It's a single web page that runs entirely in your browser. It reads [Exportify](https://exportify.net)-style CSVs, signs you in with **your own** Spotify developer app (OAuth Authorization Code + PKCE, no client secret), and creates one playlist per CSV. Your files are read locally and never uploaded anywhere. There's no server: the page talks straight to Spotify.

Not affiliated with or endorsed by Spotify.

## Getting your CSVs: use Exportify

playlist-porter only imports. To get CSVs of your playlists, use [Exportify](https://exportify.net) ([source](https://github.com/pavelkomarov/exportify)). Its exports include more than track lists:

- **Genres**, from each artist's Spotify profile
- **Audio features**: Danceability, Energy, Valence (how happy a track sounds), Tempo, Key, Loudness and more

These columns let you re-sort a library by mood, not just by artist. For example, use Genres to pick a family (trap, R&B/pop, hyperpop…), then Valence and Energy to split hype tracks from moody ones, song by song. Do the sorting with a spreadsheet, a script or an AI chat, save each group as its own CSV, then import them all with playlist-porter.

**Why playlist-porter can't export these itself:** Spotify closed its audio-features endpoint to new developer apps in November 2024. In February 2026 it also removed the bulk artist lookup that genres come from for development-mode apps. Exportify still calls both, through its own long-standing app that every Exportify user signs in to. Your own new app (see below) can't make those calls. Exportify's access is up to Spotify and could end at any time. playlist-porter doesn't depend on it, because importing only needs the `Track URI` column.

## Features

- One CSV becomes one playlist, named after the file. Pick several files, or a whole folder.
- Playlists are **private** by default, with a checkbox to make them public.
- Uses the `Track URI` column when present. If a row has no URI, it searches Spotify by track name and artist.
- Keeps the CSV's row order.
- Adds tracks in batches of 100 and retries on rate limits (`429` + `Retry-After`).
- Splits playlists over Spotify's 10,000-track cap into `Name (Part 1 of N)`, `Name (Part 2 of N)`, ….
- Skips `spotify:local:` files, unrecognised URIs and rows with no search match, and offers a downloadable report listing them.
- Plain HTML, CSS and JavaScript. No build step, no dependencies, no tracking.

## Why bring your own app?

Since February 2026, Spotify's **Development Mode** has these limits:

- The app owner needs an **active Spotify Premium** subscription, or the app stops working.
- Each app can have **at most 5 users**, and each user must be added by email in the app's dashboard.
- Spotify applied these rules to new apps from 11 February 2026 and to existing Development Mode apps from 9 March 2026.

Extended Quota Mode removes these limits, but Spotify grants it only to established businesses. So instead of everyone sharing one app (which caps out at 5 people), **each user registers their own free developer app** and pastes its Client ID into the page. PKCE means no client secret is ever needed or stored.

## Set up your Spotify app

You need a Spotify Premium account. This takes about two minutes and only has to be done once.

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and log in.
2. Click **Create app**.
3. Enter any name and description.
4. Under **Redirect URIs**, add exactly:
   ```
   https://chasechipres.github.io/playlist-porter/
   ```
   The page shows this address with a Copy button. It must match exactly, including the trailing `/`.
5. Under **Which API/SDKs are you planning to use?**, tick **Web API**.
6. Accept the terms and click **Save**.
7. Open the app's **Settings** and copy the **Client ID**. You don't need the client secret.
8. If someone other than the app owner will use it, add their name and Spotify account email under **User Management** (5 users max).

## Use it

1. Open https://chasechipres.github.io/playlist-porter/.
2. Paste your Client ID and click **Sign in with Spotify**. Approve the request, and Spotify sends you back to the page.
3. Choose CSV files or a folder. The page lists each playlist it will create and how many rows it has.
4. Tick **Make playlists public** if you want that, then click **Import**.
5. Keep the tab open until it finishes. Each created playlist gets an **Open** link. If any rows were skipped, a **Download skipped-rows report** link appears.

The page asks only for the `playlist-modify-private` and `playlist-modify-public` permissions. Your Client ID and sign-in token are kept in this browser's local storage. **Sign out** deletes the token.

### CSV format

These are the columns Exportify writes. Other columns are ignored.

| Column | Used for |
| --- | --- |
| `Track URI` | Added as-is when it's a `spotify:track:` or `spotify:episode:` URI |
| `Track Name` | Search fallback when there's no URI |
| `Artist Name(s)` (or older `Artist Name`) | Search fallback; a match must share an artist. Exportify separates multiple artists with `;` |
| `Album Name` | Picks between equally good search matches |

A CSV needs at least a `Track URI` or a `Track Name` column.

### Skipped-rows report

The report lists each skipped row:

```
file,row,track_name,artists,uri,reason
Road Trip.csv,14,My Demo,Me,spotify:local:Me::My Demo:201,local file (not on Spotify)
Road Trip.csv,30,Rare B-Side,Some Band,,no search match
```

`row` is the spreadsheet row number, with the header as row 1.

## Limits and behaviour

- **10,000 tracks per playlist** (Spotify's cap): larger CSVs become multiple playlists.
- **100 tracks per request**: tracks are added in batches of 100, in order.
- **Rate limits**: on a `429` the page waits for the `Retry-After` time and retries, up to 8 times per request. If Spotify asks for a wait longer than 10 minutes, it stops with an error instead of hanging.
- **Search** returns at most 10 results per query under the 2026 API rules. A row matches only if the result shares an artist with the CSV, which avoids wrong matches but can miss some songs. Missed rows appear in the report.
- **Folders**: only CSVs directly inside the chosen folder are used, not ones in subfolders.
- **Failures part-way through**: playlists already created stay on your account. Re-running creates new playlists rather than updating old ones.

## Development

The site is the `docs/` folder, published by GitHub Pages from `main`.

```
docs/
  index.html, style.css
  js/csv.js        CSV parsing
  js/auth.js       PKCE sign-in and token refresh
  js/spotify.js    API calls, retry, search matching
  js/importer.js   rows -> playlists, batching, parts, report
  js/app.js        page wiring
tests/             node:test suites with a fake fetch; they never call Spotify
```

Run the tests with Node 20+:

```bash
npm test
```

To try the page locally, serve `docs/` over `127.0.0.1` and add that address as an extra Redirect URI in your Spotify app. For example, run `python -m http.server 8000 --bind 127.0.0.1 --directory docs` and add `http://127.0.0.1:8000/`. Spotify only allows plain `http` for loopback IP addresses, so use `127.0.0.1`, not `localhost`.

## License

[MIT](LICENSE)
