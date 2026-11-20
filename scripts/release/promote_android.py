#!/usr/bin/env python3
"""Promote an existing, tested Google Play internal release without rebuilding it.

Requires google-api-python-client and google-auth. Runs only from a trusted
GitHub Actions workflow, with the service account injected as an environment secret.
"""
import json
import os
import sys

from google.oauth2 import service_account
from googleapiclient.discovery import build

PACKAGE = "com.kakumine.notefable"
SCOPES = ["https://www.googleapis.com/auth/androidpublisher"]


def fail(message):
    raise ValueError(message)


def prepare_promotion(tracks, version_code, target, rollout_percent):
    """Select one completed internal release; never upload or rebuild an AAB."""
    if not version_code.isdigit() or int(version_code) < 1:
        fail("version_code must be a positive integer")
    if target not in ("alpha", "beta", "production"):
        fail("Unsupported destination track")

    # The Play API may call the internal track 'internal' or 'qa' depending on
    # the existing app/track representation. Identify it by returned name.
    internal = next(
        (t for t in tracks if t.get("track") in ("internal", "qa")), None
    )
    if internal is None:
        fail("Internal testing track not found in Google Play")

    source = [
        r
        for r in internal.get("releases", [])
        if version_code in [str(code) for code in r.get("versionCodes", [])]
        and r.get("status") == "completed"
    ]
    if len(source) != 1:
        fail(f"versionCode {version_code} is not one completed internal release")

    destination = next((t for t in tracks if t.get("track") == target), None)
    previous = destination.get("releases", []) if destination else []
    for release in previous:
        codes = [int(code) for code in release.get("versionCodes", [])]
        if int(version_code) in codes:
            fail(f"versionCode {version_code} already exists on {target}; manage rollout in Play Console")
        if any(code > int(version_code) for code in codes):
            fail(f"{target} contains a newer versionCode; refusing downgrade")
        if release.get("status") in ("inProgress", "draft"):
            fail(f"{target} already has an active staged/draft release; handle it in Play Console")

    selected = source[0]
    release = {
        "versionCodes": [version_code],
        "name": selected.get("name", f"Android {version_code}"),
    }
    if selected.get("releaseNotes"):
        release["releaseNotes"] = selected["releaseNotes"]

    if target == "production":
        # Force a staged rollout; do not allow accidental 100% production deploy.
        if rollout_percent not in (5, 10, 20, 25, 50):
            fail("Production rollout_percent must be one of 5, 10, 20, 25, 50")
        release["status"] = "inProgress"
        release["userFraction"] = rollout_percent / 100
    else:
        release["status"] = "completed"

    return {"track": target, "releases": [release]}


def main():
    if os.environ.get("GITHUB_REF") != "refs/heads/main":
        fail("Only main may promote existing releases")

    version_code = os.environ["VERSION_CODE"].strip()
    target = os.environ["TARGET_TRACK"].strip()
    rollout_percent = int(os.environ.get("ROLLOUT_PERCENT", "10"))
    info = json.loads(os.environ["GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"])

    credentials = service_account.Credentials.from_service_account_info(
        info, scopes=SCOPES
    )
    publisher = build(
        "androidpublisher", "v3", credentials=credentials, cache_discovery=False
    )
    edit_id = publisher.edits().insert(packageName=PACKAGE, body={}).execute()["id"]
    tracks = publisher.edits().tracks().list(
        packageName=PACKAGE, editId=edit_id
    ).execute().get("tracks", [])
    planned = prepare_promotion(tracks, version_code, target, rollout_percent)
    print(f"Promoting existing internal versionCode {version_code} to {target}")
    print(f"Planned release: {json.dumps(planned, ensure_ascii=False)}")
    publisher.edits().tracks().update(
        packageName=PACKAGE, editId=edit_id, track=target, body=planned
    ).execute()
    publisher.edits().commit(packageName=PACKAGE, editId=edit_id).execute()
    print("Google Play edit committed. Store review / rollout may still be pending.")


if __name__ == "__main__":
    try:
        main()
    except (KeyError, ValueError) as exc:
        print(f"::error::{exc}", file=sys.stderr)
        sys.exit(1)
