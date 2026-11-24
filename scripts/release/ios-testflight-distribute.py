#!/usr/bin/env python3
"""Distribute an uploaded iOS build to an App Store Connect TestFlight external group.

Uses only Python's standard library plus the `openssl` CLI to sign ES256 JWTs for
the App Store Connect REST API v1:
  1. Look up the app by bundle ID.
  2. Look up the target external beta group by name.
  3. Poll until the uploaded build finishes processing (`processingState == VALID`).
  4. Create or update the build's localized `whatsNew` ("What to Test") text.
  5. Add the build to the external beta group.
  6. Submit the build for Beta App Review if not already submitted or approved.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

ASC_API_BASE = "https://api.appstoreconnect.apple.com/v1"
JWT_LIFETIME_SECONDS = 900
JWT_REFRESH_MARGIN_SECONDS = 60
TRANSIENT_HTTP_STATUSES = {429, 500, 502, 503, 504}
SUBMITTED_REVIEW_STATES = {"WAITING_FOR_REVIEW", "IN_REVIEW", "APPROVED"}


class AscError(RuntimeError):
    """Error raised when an App Store Connect API call fails."""

    def __init__(self, message: str, status: int | None = None, body: Any = None):
        super().__init__(message)
        self.status = status
        self.body = body


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _read_der_length(buf: bytes, offset: int) -> tuple[int, int]:
    if offset >= len(buf):
        raise ValueError("Unexpected end of DER data while reading length.")
    first = buf[offset]
    offset += 1
    if first < 0x80:
        return first, offset
    num_bytes = first & 0x7F
    if num_bytes == 0 or offset + num_bytes > len(buf):
        raise ValueError("Invalid DER length encoding.")
    length = int.from_bytes(buf[offset : offset + num_bytes], "big")
    return length, offset + num_bytes


def der_to_raw_ecdsa(der_sig: bytes, part_len: int = 32) -> bytes:
    """Convert an ASN.1 DER ECDSA signature into raw R || S bytes for JWT ES256."""
    if len(der_sig) < 8 or der_sig[0] != 0x30:
        raise ValueError("Invalid DER ECDSA signature: missing SEQUENCE tag.")
    seq_len, offset = _read_der_length(der_sig, 1)
    if offset + seq_len != len(der_sig):
        raise ValueError("Invalid DER ECDSA signature: sequence length mismatch.")

    parts: list[bytes] = []
    for _ in range(2):
        if offset >= len(der_sig) or der_sig[offset] != 0x02:
            raise ValueError("Invalid DER ECDSA signature: missing INTEGER tag.")
        int_len, offset = _read_der_length(der_sig, offset + 1)
        if int_len <= 0 or offset + int_len > len(der_sig):
            raise ValueError("Invalid DER ECDSA signature: invalid INTEGER length.")
        raw_int = der_sig[offset : offset + int_len]
        offset += int_len
        if len(raw_int) > part_len:
            raw_int = raw_int.lstrip(b"\x00")
            if len(raw_int) > part_len:
                raise ValueError(
                    f"DER ECDSA integer exceeds {part_len} bytes ({len(raw_int)})."
                )
        parts.append(raw_int.rjust(part_len, b"\x00"))

    if offset != len(der_sig):
        raise ValueError("Invalid DER ECDSA signature: trailing bytes.")

    return parts[0] + parts[1]


def sign_jwt_es256(
    key_id: str,
    issuer_id: str,
    key_file: str,
    now: int | None = None,
    lifetime: int = JWT_LIFETIME_SECONDS,
) -> tuple[str, int]:
    """Generate a signed App Store Connect ES256 JWT and return (token, exp)."""
    issued_at = int(time.time()) if now is None else int(now)
    expires_at = issued_at + lifetime

    header = {"alg": "ES256", "kid": key_id, "typ": "JWT"}
    payload = {
        "iss": issuer_id,
        "iat": issued_at,
        "exp": expires_at,
        "aud": "appstoreconnect-v1",
    }

    header_b64 = _b64url_encode(
        json.dumps(header, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    payload_b64 = _b64url_encode(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")

    proc = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", key_file],
        input=signing_input,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace").strip()
        raise AscError(f"openssl failed to sign App Store Connect JWT: {err}")

    raw_sig = der_to_raw_ecdsa(proc.stdout, part_len=32)
    token = f"{header_b64}.{payload_b64}.{_b64url_encode(raw_sig)}"
    return token, expires_at


def _format_api_error(status: int, body: Any) -> str:
    if isinstance(body, dict) and isinstance(body.get("errors"), list):
        parts = []
        for item in body["errors"]:
            if not isinstance(item, dict):
                continue
            code = item.get("code", "")
            title = item.get("title", "")
            detail = item.get("detail", "")
            text = ": ".join(p for p in (code, title, detail) if p)
            if text:
                parts.append(text)
        if parts:
            return f"HTTP {status}: " + " | ".join(parts)
    if isinstance(body, str) and body.strip():
        return f"HTTP {status}: {body.strip()[:400]}"
    return f"HTTP {status}"


class AscClient:
    """Minimal App Store Connect REST API v1 client."""

    def __init__(
        self,
        key_id: str,
        issuer_id: str,
        key_file: str,
        base_url: str = ASC_API_BASE,
        max_retries: int = 3,
        sleep_fn=time.sleep,
        time_fn=time.time,
    ) -> None:
        self.key_id = key_id
        self.issuer_id = issuer_id
        self.key_file = key_file
        self.base_url = base_url.rstrip("/")
        self.max_retries = max_retries
        self._sleep = sleep_fn
        self._time = time_fn
        self._token: str | None = None
        self._token_exp: int = 0

    def _get_token(self) -> str:
        now = int(self._time())
        if not self._token or now >= self._token_exp - JWT_REFRESH_MARGIN_SECONDS:
            self._token, self._token_exp = sign_jwt_es256(
                self.key_id, self.issuer_id, self.key_file, now=now
            )
        return self._token

    def request(
        self,
        method: str,
        path_or_url: str,
        payload: dict[str, Any] | None = None,
        allow_404: bool = False,
    ) -> Any:
        if path_or_url.startswith("http://") or path_or_url.startswith("https://"):
            url = path_or_url
        else:
            url = f"{self.base_url}{path_or_url}"

        body_bytes = (
            json.dumps(payload).encode("utf-8") if payload is not None else None
        )

        for attempt in range(1, self.max_retries + 1):
            headers = {
                "Authorization": f"Bearer {self._get_token()}",
                "Accept": "application/json",
            }
            if body_bytes is not None:
                headers["Content-Type"] = "application/json"

            req = urllib.request.Request(
                url, data=body_bytes, headers=headers, method=method
            )
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    raw = resp.read()
                    if resp.status == 204 or not raw:
                        return None
                    return json.loads(raw.decode("utf-8"))
            except urllib.error.HTTPError as exc:
                raw_err = exc.read().decode("utf-8", errors="replace")
                parsed_err: Any = raw_err
                try:
                    parsed_err = json.loads(raw_err)
                except Exception:
                    pass

                if allow_404 and exc.code == 404:
                    return None

                if exc.code in TRANSIENT_HTTP_STATUSES and attempt < self.max_retries:
                    retry_after = exc.headers.get("Retry-After") if exc.headers else None
                    delay = (
                        int(retry_after)
                        if retry_after and retry_after.isdigit()
                        else 2**attempt
                    )
                    self._sleep(min(delay, 60))
                    continue

                raise AscError(
                    _format_api_error(exc.code, parsed_err),
                    status=exc.code,
                    body=parsed_err,
                ) from exc
            except urllib.error.URLError as exc:
                if attempt < self.max_retries:
                    self._sleep(2**attempt)
                    continue
                raise AscError(f"Network error calling {method} {url}: {exc}") from exc

        raise AscError(f"Exhausted retries calling {method} {url}")


def find_app_id(client: AscClient, bundle_id: str) -> str:
    query = urllib.parse.urlencode({"filter[bundleId]": bundle_id, "limit": 5})
    resp = client.request("GET", f"/apps?{query}")
    for app in (resp or {}).get("data", []):
        attrs = app.get("attributes") or {}
        if attrs.get("bundleId") == bundle_id:
            return app["id"]
    raise AscError(f"No App Store Connect app found with bundleId '{bundle_id}'.")


def find_external_beta_group_id(client: AscClient, app_id: str, group_name: str) -> str:
    next_url: str | None = f"/apps/{app_id}/betaGroups?limit=200"
    while next_url:
        resp = client.request("GET", next_url) or {}
        for group in resp.get("data", []):
            attrs = group.get("attributes") or {}
            if (
                attrs.get("name") == group_name
                and attrs.get("isInternalGroup") is False
            ):
                return group["id"]
        next_url = (resp.get("links") or {}).get("next")
    raise AscError(
        f"No external TestFlight beta group named '{group_name}' found for app {app_id}."
    )


def wait_for_valid_build(
    client: AscClient,
    app_id: str,
    marketing_version: str,
    build_number: str,
    poll_interval: int = 20,
    poll_timeout: int = 1200,
    sleep_fn=time.sleep,
    time_fn=time.time,
) -> str:
    query = urllib.parse.urlencode(
        {
            "filter[app]": app_id,
            "filter[preReleaseVersion.version]": marketing_version,
            "filter[version]": build_number,
            "limit": 5,
        }
    )
    deadline = time_fn() + poll_timeout
    last_state = "NOT_FOUND"

    while True:
        resp = client.request("GET", f"/builds?{query}") or {}
        builds = resp.get("data", [])
        if builds:
            build = builds[0]
            build_id = build["id"]
            state = (build.get("attributes") or {}).get("processingState", "UNKNOWN")
            last_state = state
            if state == "VALID":
                print(
                    f"Build {marketing_version} ({build_number}) is VALID (id={build_id})."
                )
                return build_id
            if state in ("FAILED", "INVALID"):
                raise AscError(
                    f"Build {marketing_version} ({build_number}) finished with state '{state}'."
                )
            print(
                f"Build {marketing_version} ({build_number}) is still {state}; waiting..."
            )
        else:
            print(
                f"Build {marketing_version} ({build_number}) not visible in App Store Connect yet; waiting..."
            )

        remaining = deadline - time_fn()
        if remaining <= 0:
            raise AscError(
                f"Timed out after {poll_timeout}s waiting for build {marketing_version} ({build_number}) "
                f"to become VALID (last state: {last_state})."
            )
        sleep_fn(min(poll_interval, max(1, remaining)))


def upsert_whats_new(
    client: AscClient, build_id: str, locale: str, whats_new: str
) -> None:
    resp = client.request("GET", f"/builds/{build_id}/betaBuildLocalizations?limit=50")
    existing_id: str | None = None
    for item in (resp or {}).get("data", []):
        if (item.get("attributes") or {}).get("locale") == locale:
            existing_id = item["id"]
            break

    if existing_id:
        client.request(
            "PATCH",
            f"/betaBuildLocalizations/{existing_id}",
            payload={
                "data": {
                    "type": "betaBuildLocalizations",
                    "id": existing_id,
                    "attributes": {"whatsNew": whats_new},
                }
            },
        )
        print(f"Updated betaBuildLocalization ({locale}) for build {build_id}.")
    else:
        client.request(
            "POST",
            "/betaBuildLocalizations",
            payload={
                "data": {
                    "type": "betaBuildLocalizations",
                    "attributes": {"locale": locale, "whatsNew": whats_new},
                    "relationships": {
                        "build": {"data": {"type": "builds", "id": build_id}}
                    },
                }
            },
        )
        print(f"Created betaBuildLocalization ({locale}) for build {build_id}.")


def add_build_to_group(client: AscClient, group_id: str, build_id: str) -> None:
    client.request(
        "POST",
        f"/betaGroups/{group_id}/relationships/builds",
        payload={"data": [{"type": "builds", "id": build_id}]},
    )
    print(f"Added build {build_id} to external beta group {group_id}.")


def _get_review_state(client: AscClient, build_id: str) -> str | None:
    resp = client.request(
        "GET", f"/builds/{build_id}/betaAppReviewSubmission", allow_404=True
    )
    data = (resp or {}).get("data")
    if isinstance(data, dict):
        return (data.get("attributes") or {}).get("betaReviewState")
    return None


def submit_for_beta_review(client: AscClient, build_id: str) -> str:
    existing_state = _get_review_state(client, build_id)
    if existing_state in SUBMITTED_REVIEW_STATES:
        print(
            f"Build {build_id} already has Beta App Review state '{existing_state}'; skipping submission."
        )
        return existing_state

    try:
        resp = client.request(
            "POST",
            "/betaAppReviewSubmissions",
            payload={
                "data": {
                    "type": "betaAppReviewSubmissions",
                    "relationships": {
                        "build": {"data": {"type": "builds", "id": build_id}}
                    },
                }
            },
        )
        state = (
            ((resp or {}).get("data") or {}).get("attributes") or {}
        ).get("betaReviewState", "SUBMITTED")
        print(f"Submitted build {build_id} for Beta App Review (state={state}).")
        return state
    except AscError as exc:
        if exc.status == 409:
            rechecked = _get_review_state(client, build_id)
            if rechecked in SUBMITTED_REVIEW_STATES:
                print(
                    f"Build {build_id} is already in Beta App Review state '{rechecked}'."
                )
                return rechecked
        raise


def distribute_external(
    client: AscClient,
    bundle_id: str,
    marketing_version: str,
    build_number: str,
    group_name: str,
    locale: str,
    whats_new: str,
    poll_interval: int = 20,
    poll_timeout: int = 1200,
    sleep_fn=time.sleep,
    time_fn=time.time,
) -> dict[str, str]:
    app_id = find_app_id(client, bundle_id)
    group_id = find_external_beta_group_id(client, app_id, group_name)
    build_id = wait_for_valid_build(
        client,
        app_id=app_id,
        marketing_version=marketing_version,
        build_number=build_number,
        poll_interval=poll_interval,
        poll_timeout=poll_timeout,
        sleep_fn=sleep_fn,
        time_fn=time_fn,
    )
    upsert_whats_new(client, build_id=build_id, locale=locale, whats_new=whats_new)
    add_build_to_group(client, group_id=group_id, build_id=build_id)
    review_state = submit_for_beta_review(client, build_id=build_id)
    return {
        "app_id": app_id,
        "group_id": group_id,
        "build_id": build_id,
        "review_state": review_state,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Distribute an iOS build to a TestFlight external group."
    )
    parser.add_argument("--bundle-id", required=True)
    parser.add_argument("--marketing-version", required=True)
    parser.add_argument("--build-number", required=True)
    parser.add_argument("--group-name", default="External")
    parser.add_argument("--locale", default="en-US")
    parser.add_argument("--whats-new-file", required=True)
    parser.add_argument("--poll-interval", type=int, default=20)
    parser.add_argument("--poll-timeout", type=int, default=1200)
    args = parser.parse_args(argv)

    key_id = os.environ.get("APPSTORE_API_KEY_ID", "").strip()
    issuer_id = os.environ.get("APPSTORE_API_ISSUER_ID", "").strip()
    key_b64 = "".join(os.environ.get("APPSTORE_API_KEY_P8_B64", "").split())
    if not key_id or not issuer_id or not key_b64:
        print(
            "::error::APPSTORE_API_KEY_ID, APPSTORE_API_ISSUER_ID, and APPSTORE_API_KEY_P8_B64 are required.",
            file=sys.stderr,
        )
        return 1

    with open(args.whats_new_file, "r", encoding="utf-8") as fh:
        whats_new = fh.read().strip()
    if not whats_new:
        print("::error::What-to-Test file is empty.", file=sys.stderr)
        return 1

    key_dir = tempfile.mkdtemp(prefix="asc-dist-key.")
    try:
        os.chmod(key_dir, 0o700)
        key_file = os.path.join(key_dir, f"AuthKey_{key_id}.p8")
        pem_bytes = base64.b64decode(key_b64, validate=True)
        fd = os.open(key_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as fh:
            fh.write(pem_bytes)

        client = AscClient(key_id=key_id, issuer_id=issuer_id, key_file=key_file)
        result = distribute_external(
            client=client,
            bundle_id=args.bundle_id,
            marketing_version=args.marketing_version,
            build_number=args.build_number,
            group_name=args.group_name,
            locale=args.locale,
            whats_new=whats_new,
            poll_interval=args.poll_interval,
            poll_timeout=args.poll_timeout,
        )
        print(
            f"External TestFlight distribution complete: group={args.group_name} "
            f"build_id={result['build_id']} review_state={result['review_state']}"
        )
        return 0
    except AscError as exc:
        print(f"::error::{exc}", file=sys.stderr)
        return 1
    finally:
        shutil.rmtree(key_dir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
