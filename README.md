# playlist-porter

Import playlists from CSV files into Spotify, with no limit on how many playlists or tracks you import.

It reads [Exportify](https://exportify.net)-style CSVs, signs you in with **your own** Spotify developer app (OAuth Authorization Code + PKCE, no client secret), and creates one playlist per CSV.

Not affiliated with or endorsed by Spotify.

## Getting your CSVs: use Exportify

playlist-porter only imports. To get CSVs of your playlists, use [Exportify](https://exportify.net) ([source](https://github.com/pavelkomarov/exportify)). Its exports include more than track lists:

- **Genres**, from each artist's Spotify profile
- **Audio features**: Danceability, Energy, Valence (how happy a track sounds), Tempo, Key, Loudness and more

These columns let you re-sort a library by mood, not just by artist. For example, use Genres to pick a family (trap, R&B/pop, hyperpop…), then Valence and Energy to split hype tracks from moody ones, song by song. Do the sorting with a spreadsheet, a script or an AI chat, save each group as its own CSV, then import the folder with playlist-porter.

**Why playlist-porter can't export these itself:** Spotify closed its audio-features endpoint to new developer apps in November 2024. In February 2026 it also removed the bulk artist lookup that genres come from for development-mode apps. Exportify still calls both, through its own long-standing app that every Exportify user signs in to. Your own new app (see below) can't make those calls. Exportify's access is up to Spotify and could end at any time. playlist-porter doesn't depend on it, because importing only needs the `Track URI` column.

## Features

- One CSV becomes one playlist, named after the file. Pass a folder to import every `.csv` in it.
- Playlists are **private** by default. Use `--public` to make them public.
- Uses the `Track URI` column when present. If a row has no URI, it searches Spotify by track name and artist.
- Keeps the CSV's row order.
- Adds tracks in batches of 100 and retries on rate limits (`429` + `Retry-After`).
- Splits playlists over Spotify's 10,000-track cap into `Name (Part 1 of N)`, `Name (Part 2 of N)`, ….
- Skips `spotify:local:` files, unrecognised URIs and rows with no search match, and writes them all to a report CSV.
- No dependencies beyond the Python standard library.

## Why bring your own app?

Since February 2026, Spotify's **Development Mode** has these limits:

- The app owner needs an **active Spotify Premium** subscription, or the app stops working.
- Each app can have **at most 5 users**, and each user must be added by email in the app's dashboard.
- Spotify applied these rules to new apps from 11 February 2026 and to existing Development Mode apps from 9 March 2026.

Extended Quota Mode removes these limits, but Spotify grants it only to established businesses. So instead of everyone sharing one app (which caps out at 5 people), **each user registers their own free developer app** and uses its Client ID. PKCE means no client secret is ever needed or stored.

## Setup

You need Python 3.10+ and a Spotify Premium account.

### 1. Create a Spotify developer app

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and log in.
2. Click **Create app**.
3. Enter any name and description.
4. Under **Redirect URIs**, add exactly:
   ```
   http://127.0.0.1:8888/callback
   ```
   Spotify only allows plain `http` for loopback IP addresses, so use `127.0.0.1`, not `localhost`.
5. Under **Which API/SDKs are you planning to use?**, tick **Web API**.
6. Accept the terms and click **Save**.
7. Open the app's **Settings** and copy the **Client ID**. You don't need the client secret.
8. If someone other than the app owner will use it, add their name and Spotify account email under **User Management** (5 users max).

### 2. Install

```bash
git clone <this repo>
cd playlist-porter
pip install .
```

### 3. Sign in

```bash
export SPOTIFY_CLIENT_ID=your_client_id        # PowerShell: $env:SPOTIFY_CLIENT_ID="your_client_id"
playlist-porter login
```

Your browser opens Spotify's consent page. After you approve, the token is saved to your user config folder, never to the project folder:

- Windows: `%APPDATA%\playlist-porter\token.json`
- macOS / Linux: `~/.config/playlist-porter/token.json`

The token refreshes automatically. `playlist-porter logout` deletes it.

The app requests only the `playlist-modify-private` and `playlist-modify-public` scopes.

## Usage

```bash
# One CSV -> one private playlist named "Road Trip"
playlist-porter import "Road Trip.csv"

# Every CSV in a folder
playlist-porter import ./exports

# Public playlists, and a custom report location
playlist-porter import ./exports --public --report skipped.csv
```

You can pass `--client-id` instead of setting `SPOTIFY_CLIENT_ID`. If you registered a different redirect URI, pass it with `--redirect-uri`. `import` signs you in first if you aren't signed in yet.

### CSV format

These are the columns Exportify writes. Other columns are ignored.

| Column | Used for |
| --- | --- |
| `Track URI` | Added as-is when it's a `spotify:track:` or `spotify:episode:` URI |
| `Track Name` | Search fallback when there's no URI |
| `Artist Name(s)` (or older `Artist Name`) | Search fallback; a match must share an artist |
| `Album Name` | Picks between equally good search matches |

A CSV needs at least a `Track URI` or a `Track Name` column.

### Skipped-rows report

If any rows are skipped, `skipped-tracks.csv` (or your `--report` path) lists each one:

```
file,row,track_name,artists,uri,reason
Road Trip.csv,14,My Demo,Me,spotify:local:Me::My Demo:201,local file (not on Spotify)
Road Trip.csv,30,Rare B-Side,Some Band,,no search match
```

`row` is the spreadsheet row number, with the header as row 1.

## Limits and behaviour

- **10,000 tracks per playlist** (Spotify's cap): larger CSVs become multiple playlists.
- **100 tracks per request**: tracks are added in batches of 100, in order.
- **Rate limits**: on a `429` the tool waits for the `Retry-After` time and retries, up to 8 times per request. If Spotify asks for a wait longer than 10 minutes, it stops with an error instead of hanging.
- **Search** returns at most 10 results per query under the 2026 API rules. A row matches only if the result shares an artist with the CSV, which avoids wrong matches but can miss some songs. Missed rows appear in the report.
- **Failures part-way through**: playlists already created stay on your account. Re-running creates new playlists rather than updating old ones.

## Development

```bash
pip install -e ".[test]"
pytest
```

The tests use a fake HTTP transport and never call Spotify.

## License

[MIT](LICENSE)
