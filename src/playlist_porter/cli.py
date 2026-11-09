"""Command-line entry point."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from .api import SpotifyClient, SpotifyError
from .auth import DEFAULT_REDIRECT_URI, Auth, AuthError, TokenStore, default_token_path
from .csvfile import CsvFormatError, find_csvs
from .importer import import_csv, write_report


def _auth(args) -> Auth:
    client_id = args.client_id or os.environ.get("SPOTIFY_CLIENT_ID")
    if not client_id:
        sys.exit("Missing Client ID: pass --client-id or set SPOTIFY_CLIENT_ID.")
    return Auth(client_id, TokenStore(default_token_path()), redirect_uri=args.redirect_uri)


def cmd_login(args) -> int:
    _auth(args).login()
    print("Signed in.")
    return 0


def cmd_logout(args) -> int:
    removed = TokenStore(default_token_path()).clear()
    print("Signed out." if removed else "No saved sign-in found.")
    return 0


def cmd_import(args) -> int:
    auth = _auth(args)
    if (auth.store.load() or {}).get("client_id") != auth.client_id:
        auth.login()
    client = SpotifyClient(auth)

    files = find_csvs(Path(args.path))
    if not files:
        sys.exit(f"No CSV files found in {args.path}")

    all_skipped = []
    try:
        for f in files:
            try:
                _, skipped = import_csv(f, client, public=args.public)
            except CsvFormatError as e:
                print(f"Skipping {f.name}: {e}", file=sys.stderr)
                continue
            all_skipped.extend(skipped)
    finally:
        # Write the report even if a later file fails, so earlier skips aren't lost.
        if all_skipped:
            report = Path(args.report)
            write_report(report, all_skipped)
            print(f"{len(all_skipped)} rows skipped; see {report}")
        else:
            print("No rows skipped.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="playlist-porter",
        description="Import Exportify-style CSV playlists into Spotify with your own developer app.",
    )
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--client-id", help="Your Spotify app's Client ID (or set SPOTIFY_CLIENT_ID)")
    common.add_argument(
        "--redirect-uri",
        default=DEFAULT_REDIRECT_URI,
        help=f"Must match a Redirect URI in your app settings (default {DEFAULT_REDIRECT_URI})",
    )
    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("login", parents=[common], help="Sign in to Spotify").set_defaults(func=cmd_login)
    sub.add_parser("logout", help="Delete the saved sign-in").set_defaults(func=cmd_logout)

    imp = sub.add_parser("import", parents=[common], help="Import a CSV file or a folder of CSVs")
    imp.add_argument("path", help="A .csv file, or a folder containing .csv files")
    imp.add_argument("--public", action="store_true", help="Make playlists public (default: private)")
    imp.add_argument("--report", default="skipped-tracks.csv", help="Where to write skipped rows")
    imp.set_defaults(func=cmd_import)
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except (AuthError, SpotifyError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
