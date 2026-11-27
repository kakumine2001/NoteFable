#!/usr/bin/env python3
"""Write the repository's Google Play store listing to Google Play.

Sources of truth:
  docs/play-store/listing.md   app name, short and full description of every Play language
                               (es-419 and es-ES share one section)
  mobile/android/play-store/   icon-512.png, feature-graphic-1024x500.png and screenshots/*.png in
                               file-name order, for the default language en-US only; the other
                               languages show the default language's images

Modes:
  --check          validate the document and images; no network, no credentials
  (default)        dry run: open an edit, read, print the differences per language, delete the edit
  --apply          apply only the differences and commit the edit. Committing sends the changes to
                   Google's review, together with changes waiting in Play Console; with managed
                   publishing off they go live once approved.
  --apply --hold   commit with changesNotSentForReview: this commit doesn't send the changes for
                   review. Not a lasting lock: held changes join the unsent ones in Play Console, and
                   a later commit without hold (an apply, or the next Android release) may send them

Writes only the title and the two descriptions of the languages above and the en-US icon, feature
graphic and phone screenshots. It never removes a listing, never changes another language or image
type, and never touches tracks, releases, testers, pricing, subscriptions, app details, data safety
or account permissions.

Python standard library plus the openssl CLI (RS256). The service account key is read from
ALPHA_PLAY_SERVICE_ACCOUNT_JSON. The logs are public: the key, the account's email and the tokens are
never printed.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import contextlib
import difflib
import hashlib
import http.client
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

PACKAGE_NAME = "com.kakumine.notefable"
PLAY_STORE_DOC = "docs/play-store/listing.md"
ASSET_DIR = "mobile/android/play-store"
SECRET_ENV = "ALPHA_PLAY_SERVICE_ACCOUNT_JSON"

# The Play languages the repository manages, as written in the headings of PLAY_STORE_DOC.
LANGUAGES = (
    "en-US", "zh-CN", "zh-TW", "ja-JP", "ko-KR", "es-419", "es-ES", "fr-FR", "de-DE", "pt-BR",
    "it-IT", "id", "vi", "th", "hi-IN", "ar", "tr-TR", "ru-RU",
)  # fmt: skip
DEFAULT_LANGUAGE = "en-US"  # the images go here

# (API field, label, limit in characters)
TEXT_FIELDS = (
    ("title", "app name", 30),
    ("shortDescription", "short description", 80),
    ("fullDescription", "full description", 4000),
)
IMAGE_TYPES = ("icon", "featureGraphic", "phoneScreenshots")
SCREENSHOTS_MIN, SCREENSHOTS_MAX = 2, 8
# The store images are drawn by code, not by an AI model: the answer docs/play-store/console-answers.md
# gives for Console's AI asset declaration.
AI_GENERATED_STATE = "aiGeneratedStateNotAiGenerated"

API_ROOT = "https://androidpublisher.googleapis.com"
APPLICATION_PATH = f"/androidpublisher/v3/applications/{PACKAGE_NAME}"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPE = "https://www.googleapis.com/auth/androidpublisher"
TOKEN_LIFETIME_SECONDS = 3600
TRANSIENT_HTTP_STATUSES = {429, 500, 502, 503, 504}
MAX_ATTEMPTS = 3
# Never cancel a review that is already running (a release, for example): fail the commit instead.
REVIEW_BEHAVIOR = "changesInReviewBehavior=ERROR_IF_IN_REVIEW"


class ListingError(ValueError):
    """The document or images can't be turned into a listing."""


class PlayError(RuntimeError):
    """A Google API call (or the credential for it) failed."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


def redact(text: str) -> str:
    """Take account identifiers and tokens out of anything that goes to the public log."""
    text = re.sub(r"[A-Za-z0-9._%+-]+(?:@|%40)[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "[email]", text)
    text = re.sub(r"ya29\.[A-Za-z0-9._-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "[token]", text)
    return re.sub(r"(?i)(projects?(?: number)?[ =/:#]+)\d{6,}", r"\1[number]", text)


# --- Document ----------------------------------------------------------------------------------

_LABEL = re.compile(r"^\*\*[^*]+\*\*\s*[:：]\s*(.*?)\s*$")


def parse_play_listing(text: str) -> dict[str, dict[str, str]]:
    """Play language code -> {title, shortDescription, fullDescription}."""
    sections: list[tuple[str, list[str]]] = []
    for line in text.splitlines():
        match = re.match(r"^## +(.*\S)\s*$", line)
        if match:
            sections.append((match.group(1), []))
        elif sections:
            sections[-1][1].append(line.rstrip())

    found: dict[str, dict[str, str]] = {}
    for heading, lines in sections:
        match = re.search(r"\(([^()]+)\)$", heading)
        if not match:
            continue  # not a language section (the other store fields)
        codes = [code.strip() for code in match.group(1).split(",")]
        # Labels are translated, so they are read by position: name, short and full description.
        labels = [(i, m.group(1)) for i, line in enumerate(lines) if (m := _LABEL.match(line))]
        if (
            len(labels) != 3
            or not labels[0][1]
            or not labels[1][1]
            or labels[2][1]
            or sum(bool(line) for line in lines[: labels[2][0]]) != 2  # nothing but the first two labels
        ):
            raise ListingError(
                f"{PLAY_STORE_DOC}: '## {heading}' needs three labels and nothing else before the full "
                "description: app name and short description with their value on the same line, then "
                "full description with the text below it."
            )
        description = "\n".join(lines[labels[2][0] + 1 :]).strip("\n")
        if not description:
            raise ListingError(f"{PLAY_STORE_DOC}: '## {heading}' has no full description.")
        for code in codes:
            if code not in LANGUAGES:
                raise ListingError(f"{PLAY_STORE_DOC}: '## {heading}' is a language this script doesn't manage.")
            if code in found:
                raise ListingError(f"{PLAY_STORE_DOC}: two sections for {code}.")
            found[code] = {"title": labels[0][1], "shortDescription": labels[1][1], "fullDescription": description}
    missing = [code for code in LANGUAGES if code not in found]
    if missing:
        raise ListingError(f"{PLAY_STORE_DOC}: no section for {', '.join(missing)}.")
    return {code: found[code] for code in LANGUAGES}


def load_texts(repo_root: Path) -> dict[str, dict[str, str]]:
    path = repo_root / PLAY_STORE_DOC
    try:
        texts = parse_play_listing(path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError) as exc:
        raise ListingError(f"Can't read {path}: {exc}") from exc
    problems = [
        f"{language}: {label} is {len(entry[name])} characters (limit {limit})"
        for language, entry in texts.items()
        for name, label, limit in TEXT_FIELDS
        if len(entry[name]) > limit
    ]
    if problems:
        raise ListingError("\n".join(problems))
    return texts


# --- Image files -------------------------------------------------------------------------------


@dataclass(frozen=True)
class Image:
    path: Path
    width: int
    height: int
    size: int
    sha256: str

    @property
    def label(self) -> str:
        return f"{self.path.name} {self.width}x{self.height}"


def png_info(data: bytes) -> tuple[int, int, bool]:
    """(width, height, has transparency) of a PNG."""
    if len(data) < 33 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise ListingError("not a PNG file")
    width, height = struct.unpack(">II", data[16:24])
    transparent = data[25] in (4, 6)  # color types with an alpha channel
    offset = 8
    while offset + 8 <= len(data):
        length, kind = struct.unpack(">I4s", data[offset : offset + 8])
        if kind == b"IDAT":
            break
        transparent = transparent or kind == b"tRNS"
        offset += length + 12
    return width, height, transparent


def _image_problem(image_type: str, width: int, height: int, size: int, transparent: bool) -> str | None:
    """Play Console's rules for one image."""
    megabyte = 1024 * 1024
    if image_type == "icon":
        # Console asks for a 32-bit PNG but has taken the repository's opaque one, so alpha is optional.
        if (width, height) != (512, 512):
            return f"is {width}x{height}, the icon must be 512x512"
        return "is larger than 1024 KB" if size > megabyte else None
    if transparent:
        return "has transparency; it must be an opaque PNG"
    if image_type == "featureGraphic":
        if (width, height) != (1024, 500):
            return f"is {width}x{height}, the feature graphic must be 1024x500"
        return "is larger than 15 MB" if size > 15 * megabyte else None
    short, long = sorted((width, height))
    if short < 320 or long > 3840:
        return f"is {width}x{height}, each side must be 320-3840 pixels"
    if long > 2 * short:
        return f"is {width}x{height}, the long side may be at most twice the short one"
    return "is larger than 8 MB" if size > 8 * megabyte else None


def load_images(repo_root: Path) -> dict[str, list[Image]]:
    """Image type -> files in upload order. Every managed type must be there: replacing deletes first."""
    root = repo_root / ASSET_DIR
    problems: list[str] = []
    screenshots: list[Path] = []
    folder = root / "screenshots"
    for path in sorted(folder.iterdir(), key=lambda p: p.name) if folder.is_dir() else []:
        if path.name.startswith("."):
            continue
        if path.is_file() and path.suffix == ".png":
            screenshots.append(path)
        else:
            problems.append(f"{ASSET_DIR}/screenshots/{path.name}: only .png files belong here")
    if not SCREENSHOTS_MIN <= len(screenshots) <= SCREENSHOTS_MAX:
        problems.append(
            f"{ASSET_DIR}/screenshots/: {len(screenshots)} screenshots, Play takes "
            f"{SCREENSHOTS_MIN}-{SCREENSHOTS_MAX}"
        )
    files = {
        "icon": [root / "icon-512.png"],
        "featureGraphic": [root / "feature-graphic-1024x500.png"],
        "phoneScreenshots": screenshots,
    }
    images: dict[str, list[Image]] = {}
    for image_type, paths in files.items():
        images[image_type] = []
        for path in paths:
            where = path.relative_to(repo_root).as_posix()
            try:
                data = path.read_bytes()
                width, height, transparent = png_info(data)
            except (OSError, ListingError) as exc:
                problems.append(f"{where}: {'missing' if isinstance(exc, FileNotFoundError) else exc}")
                continue
            problem = _image_problem(image_type, width, height, len(data), transparent)
            if problem:
                problems.append(f"{where}: {problem}")
            images[image_type].append(Image(path, width, height, len(data), hashlib.sha256(data).hexdigest()))
    if problems:
        raise ListingError("\n".join(problems))
    return images


# --- Credential --------------------------------------------------------------------------------


@dataclass(frozen=True, repr=False)  # no repr: it would show the key
class Credentials:
    email: str
    private_key: str
    key_id: str | None


def read_credentials(environ=None) -> Credentials:
    raw = (os.environ if environ is None else environ).get(SECRET_ENV, "").strip()
    if not raw:
        raise PlayError(f"{SECRET_ENV} is not set.")
    try:
        data = json.loads(raw)
        email, key, key_id = data["client_email"], data["private_key"], data.get("private_key_id")
    except (ValueError, KeyError, TypeError, AttributeError):
        email = key = key_id = None
    if not (isinstance(email, str) and email and isinstance(key, str) and key):
        raise PlayError(f"{SECRET_ENV} is not a service account JSON key (client_email, private_key).")
    return Credentials(email, key, key_id if isinstance(key_id, str) else None)


@contextlib.contextmanager
def temporary_key_file(private_key: str):
    """The PEM key in a private temporary directory that is removed on exit (openssl needs a file)."""
    directory = tempfile.mkdtemp(prefix="play-key.")
    try:
        path = os.path.join(directory, "key.pem")
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(private_key.encode("utf-8"))
        yield path
    finally:
        shutil.rmtree(directory, ignore_errors=True)


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def sign_jwt(credentials: Credentials, key_file: str, now: int) -> str:
    """The RS256 assertion that is exchanged for an access token."""
    header = {"alg": "RS256", "typ": "JWT"}
    if credentials.key_id:
        header["kid"] = credentials.key_id
    claims = {
        "iss": credentials.email,
        "scope": SCOPE,
        "aud": TOKEN_URL,
        "iat": now,
        "exp": now + TOKEN_LIFETIME_SECONDS,
    }
    signing_input = ".".join(
        _b64url(json.dumps(part, separators=(",", ":")).encode("utf-8")) for part in (header, claims)
    )
    process = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", key_file],
        input=signing_input.encode("ascii"),
        capture_output=True,
        check=False,
    )
    if process.returncode != 0 or not process.stdout:
        raise PlayError(f"openssl could not sign with the private key in {SECRET_ENV}.")
    return f"{signing_input}.{_b64url(process.stdout)}"


# --- Google API --------------------------------------------------------------------------------


def _api_error(what: str, status: int, raw: bytes) -> PlayError:
    """Google's status, message and reasons; never a raw body."""
    try:
        error = json.loads(raw.decode("utf-8"))["error"]
    except (ValueError, KeyError, TypeError):
        error = None
    parts = [f"{what}: HTTP {status}"]
    if isinstance(error, dict):
        items = [*(error.get("errors") or []), *(error.get("details") or [])]
        reasons = sorted({str(i["reason"]) for i in items if isinstance(i, dict) and i.get("reason")})
        parts += [str(error[key]) for key in ("status", "message") if error.get(key)]
        if reasons:
            parts.append(f"({', '.join(reasons)})")
    elif isinstance(error, str):
        parts.append(error)  # the token endpoint; its description can name the account
    return PlayError(redact(" ".join(parts)), status=status)


class PlayClient:
    """Google Play Developer API v3, paths relative to this app."""

    def __init__(self, credentials: Credentials, key_file: str, sleep_fn=time.sleep, time_fn=time.time) -> None:
        self._credentials = credentials
        self._key_file = key_file
        self._sleep = sleep_fn
        self._time = time_fn
        self._token: str | None = None
        self._token_expires = 0.0

    def _send(self, what: str, request: urllib.request.Request, safe_to_resend: bool) -> Any:
        """Send, retrying a rate limit and, when sending twice does no harm, errors of the moment."""
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                with urllib.request.urlopen(request, timeout=120) as response:
                    raw = response.read()
                break
            except urllib.error.HTTPError as exc:
                try:
                    body = exc.read()
                except (OSError, http.client.HTTPException):
                    body = b""
                resend = exc.code == 429 or (safe_to_resend and exc.code in TRANSIENT_HTTP_STATUSES)
                if not resend or attempt == MAX_ATTEMPTS:
                    raise _api_error(what, exc.code, body) from None
            except (OSError, http.client.HTTPException) as exc:  # URLError, timeouts, dropped connections
                if not safe_to_resend or attempt == MAX_ATTEMPTS:
                    raise PlayError(redact(f"{what}: network error: {exc}")) from None
            self._sleep(2**attempt)
        if not raw:
            return None
        try:
            return json.loads(raw.decode("utf-8"))
        except ValueError:
            raise PlayError(f"{what}: Google sent a response that isn't JSON.") from None

    def _access_token(self) -> str:
        now = int(self._time())
        if not self._token or now >= self._token_expires - 60:
            body = urllib.parse.urlencode(
                {
                    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    "assertion": sign_jwt(self._credentials, self._key_file, now),
                }
            ).encode("ascii")
            request = urllib.request.Request(
                TOKEN_URL, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST"
            )
            response = self._send("Getting an access token", request, safe_to_resend=True)
            token = response.get("access_token") if isinstance(response, dict) else None
            if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9._~+/=-]+", token):
                raise PlayError("Getting an access token: Google sent no usable token.")
            self._token = token
            self._token_expires = now + int(response.get("expires_in") or TOKEN_LIFETIME_SECONDS)
        return self._token

    def request(
        self, method: str, path: str, payload: dict[str, Any] | None = None, media: bytes | None = None
    ) -> Any:
        headers = {"Authorization": f"Bearer {self._access_token()}", "Accept": "application/json"}
        url = f"{API_ROOT}{APPLICATION_PATH}{path}"
        data = None
        if media is not None:
            url = f"{API_ROOT}/upload{APPLICATION_PATH}{path}"
            data, headers["Content-Type"] = media, "image/png"
        elif payload is not None:
            data, headers["Content-Type"] = json.dumps(payload).encode("utf-8"), "application/json"
        elif method == "POST":
            data = b""  # validate and commit take an empty body, which still needs a length
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        return self._send(f"{method} {path}", request, safe_to_resend=method == "GET")


_EDIT = r"/edits/[^/?:]+"
_TYPES = f"(?:{'|'.join(IMAGE_TYPES)})"
_OWN_IMAGES = rf"{_EDIT}/listings/{DEFAULT_LANGUAGE}/{_TYPES}"
_OWN_TEXT = rf"{_EDIT}/listings/(?:{'|'.join(LANGUAGES)})"
# Every request the script may send. Anything else (tracks, bundles, testers, app details, deleting
# listings, in-app products, ...) is refused before it reaches Google.
READS_AND_EDIT_LIFECYCLE = (
    ("POST", r"/edits"),
    ("DELETE", _EDIT),  # abandons the edit
    ("GET", rf"{_EDIT}/details"),
    ("GET", rf"{_EDIT}/listings"),
    ("GET", rf"{_EDIT}/listings/[A-Za-z0-9-]+/{_TYPES}"),
)
ALLOWED_WRITES = (
    ("PATCH", _OWN_TEXT),
    ("PUT", _OWN_TEXT),
    ("DELETE", _OWN_IMAGES),
    ("POST", rf"{_OWN_IMAGES}\?uploadType=media&aiGeneratedState={AI_GENERATED_STATE}"),
    ("POST", rf"{_EDIT}:validate"),
    ("POST", rf"{_EDIT}:commit\?{REVIEW_BEHAVIOR}(?:&changesNotSentForReview=true)?"),
)


class GuardedClient:
    """PlayClient wrapper that sends only the listed requests, and no listing write in a dry run."""

    def __init__(self, client: Any, allow_writes: bool) -> None:
        self._client = client
        self._allowed = READS_AND_EDIT_LIFECYCLE + (ALLOWED_WRITES if allow_writes else ())

    def request(
        self, method: str, path: str, payload: dict[str, Any] | None = None, media: bytes | None = None
    ) -> Any:
        if not any(method == m and re.fullmatch(pattern, path) for m, pattern in self._allowed):
            raise PlayError(f"Refusing to send {method} {path}.")
        return self._client.request(method, path, payload=payload, media=media)


# --- Plan --------------------------------------------------------------------------------------


def _normalized(value: str | None) -> str:
    return (value or "").replace("\r\n", "\n").strip()


def _hex_digest(value: str | None) -> str:
    """Google doesn't say how Image.sha256 is encoded: read hex or base64."""
    text = (value or "").strip()
    if re.fullmatch(r"[0-9a-fA-F]{64}", text):
        return text.lower()
    try:
        raw = base64.b64decode(text.replace("-", "+").replace("_", "/") + "=" * (-len(text) % 4), validate=True)
    except (binascii.Error, ValueError):
        return text
    return raw.hex() if len(raw) == 32 else text


@dataclass
class TextPlan:
    desired: dict[str, str]
    current: dict[str, Any] | None  # None: Play has no listing for this language yet

    @property
    def changes(self) -> dict[str, str]:
        current = self.current or {}
        return {k: v for k, v in self.desired.items() if _normalized(current.get(k)) != _normalized(v)}


@dataclass
class ImagePlan:
    local: list[Image]
    current: list[dict] = field(default_factory=list)

    @property
    def unchanged(self) -> bool:
        return [_hex_digest(i.get("sha256")) for i in self.current] == [i.sha256 for i in self.local]


@dataclass
class Plan:
    default_language: str | None
    warnings: list[str]
    texts: dict[str, TextPlan]
    images: dict[str, ImagePlan]

    @property
    def has_changes(self) -> bool:
        return any(t.changes for t in self.texts.values()) or any(not i.unchanged for i in self.images.values())


def _list_images(client: Any, edit: str, language: str, image_type: str) -> list[dict]:
    response = client.request("GET", f"{edit}/listings/{urllib.parse.quote(language, safe='')}/{image_type}")
    return (response or {}).get("images") or []


def build_plan(client: Any, edit: str, texts: dict[str, dict[str, str]], images: dict[str, list[Image]]) -> Plan:
    default = (client.request("GET", f"{edit}/details") or {}).get("defaultLanguage")
    response = client.request("GET", f"{edit}/listings") or {}
    remote = {str(item.get("language")): item for item in response.get("listings") or []}

    warnings = []
    if default != DEFAULT_LANGUAGE:
        warnings.append(
            f"The default language on Play is {default}, not {DEFAULT_LANGUAGE}: languages without their own "
            f"images show the {default} ones, which this script doesn't change."
        )
    extra = sorted(set(remote) - set(texts))
    if extra:
        warnings.append(f"Play also has listings for {', '.join(extra)}, not in the document; left unchanged.")
    for language in sorted(set(remote) - {DEFAULT_LANGUAGE}):
        own = [f"{len(found)} {t}" for t in IMAGE_TYPES if (found := _list_images(client, edit, language, t))]
        if own:
            warnings.append(
                f"{language} has its own images on Play ({', '.join(own)}): it shows them instead of the "
                f"repository's {DEFAULT_LANGUAGE} ones; left unchanged."
            )

    image_plans = {t: ImagePlan(images[t]) for t in IMAGE_TYPES}
    if DEFAULT_LANGUAGE in remote:  # images can only be listed for a language that has a listing
        for image_type, plan in image_plans.items():
            plan.current = _list_images(client, edit, DEFAULT_LANGUAGE, image_type)
    return Plan(
        default_language=default,
        warnings=warnings,
        texts={language: TextPlan(entry, remote.get(language)) for language, entry in texts.items()},
        images=image_plans,
    )


# --- Report ------------------------------------------------------------------------------------


def _command(kind: str, message: str) -> str:
    """A GitHub Actions annotation on one line."""
    return f"::{kind}::" + " ".join(redact(message).split())


def _print_change(out, label: str, current: str, new: str) -> None:
    # The runner reads a line that starts with "::" as a command, so every text line sits behind a "|".
    if "\n" not in current and "\n" not in new:
        out(f"  {label}: CHANGE")
        out(f"    current: {current or '(empty)'}")
        out(f"    new:     {new}")
        return
    out(f"  {label}: CHANGE ({len(current)} -> {len(new)} characters)")
    diff = difflib.unified_diff(current.split("\n"), new.split("\n"), lineterm="", n=1)
    for line in list(diff)[2:]:  # without the two file name lines
        out(f"    | {line}")


def print_plan(plan: Plan, out=print) -> None:
    out(f"App {PACKAGE_NAME}, default language on Play: {plan.default_language}")
    for warning in plan.warnings:
        out(_command("warning", warning))
    for language, text in plan.texts.items():
        out("")
        if text.current is None:
            out(f"[{language}] not on Play yet, will be added")
        elif not text.changes:
            out(f"[{language}] unchanged")
            continue
        else:
            out(f"[{language}]")
        for name, label, _ in TEXT_FIELDS:
            if name in text.changes:
                current = _normalized((text.current or {}).get(name))
                _print_change(out, label, current, _normalized(text.desired[name]))

    out("")
    out(f"Images ({DEFAULT_LANGUAGE}; other languages show these)")
    for image_type, images in plan.images.items():
        if images.unchanged:
            out(f"  {image_type}: unchanged ({len(images.local)} in place)")
            continue
        out(f"  {image_type}: replace {len(images.current)} current with {len(images.local)} new")
        for number, image in enumerate(images.current, 1):
            out(f"    current {number}: sha256 {_hex_digest(image.get('sha256'))[:16] or '(none)'}")
        for number, image in enumerate(images.local, 1):
            out(f"    new {number}: {image.label} ({image.size} bytes) sha256 {image.sha256[:16]}")

    texts = plan.texts.values()
    out("")
    out(
        "Summary: "
        f"{sum(len(t.changes) for t in texts if t.current is not None)} field changes, "
        f"{sum(t.current is None for t in texts)} languages to add, "
        f"{sum(not i.unchanged for i in plan.images.values())} image types to replace."
    )


def print_check(texts: dict[str, dict[str, str]], images: dict[str, list[Image]], out=print) -> None:
    out(f"Play listing OK: {len(texts)} languages.")
    out("language name short  full")
    for language, entry in texts.items():
        lengths = [len(entry[name]) for name, _, _ in TEXT_FIELDS]
        shared = [other for other, value in texts.items() if value == entry and other != language]
        note = f"  (same text as {', '.join(shared)})" if shared else ""
        out(f"{language:<8} {lengths[0]:>4} {lengths[1]:>5} {lengths[2]:>5}{note}")
    out(f"Images ({DEFAULT_LANGUAGE}):")
    for image_type, files in images.items():
        for image in files:
            out(f"  {image_type}: {image.label}")


# --- Writing -----------------------------------------------------------------------------------


def apply_changes(client: Any, edit: str, plan: Plan, out=print) -> None:
    """Put the differences into the edit. Any failure raises, so a partial edit is never committed."""
    for language, text in plan.texts.items():
        if text.current is None:
            client.request("PUT", f"{edit}/listings/{language}", payload={"language": language, **text.desired})
            out(f"Added {language}.")
        elif text.changes:
            # PATCH leaves what the repository doesn't manage (the promo video) as it is.
            client.request("PATCH", f"{edit}/listings/{language}", payload={"language": language, **text.changes})
            out(f"Updated {language}: {', '.join(text.changes)}.")

    for image_type, images in plan.images.items():
        if images.unchanged:
            continue
        path = f"{edit}/listings/{DEFAULT_LANGUAGE}/{image_type}"
        client.request("DELETE", path)
        uploaded = []
        # One at a time, in order: Play has no ordering call, screenshots show in upload order.
        for image in images.local:
            query = f"uploadType=media&aiGeneratedState={AI_GENERATED_STATE}"
            response = client.request("POST", f"{path}?{query}", media=image.path.read_bytes()) or {}
            result = response.get("image") or {}
            if not result.get("id"):
                raise PlayError(f"Play didn't take {image.label}.")
            uploaded.append(result["id"])
            if result.get("sha256") and _hex_digest(result["sha256"]) != image.sha256:
                out(_command("warning", f"Play reports another sha256 for {image.label}: later runs will "
                                        "see it as changed and upload it again."))
        listed = [i.get("id") for i in _list_images(client, edit, DEFAULT_LANGUAGE, image_type)]
        if listed != uploaded:
            raise PlayError(f"Play doesn't list the uploaded {image_type} as sent (count or order differs).")
        out(f"Replaced {image_type}: {len(images.current)} -> {len(uploaded)}.")


def _commit_hint(error: PlayError, hold: bool) -> str:
    text = str(error)
    if "CHANGES_ALREADY_IN_REVIEW" in text or "changes in review" in text:
        return "Play already has changes in review. Run again after that review finishes."
    if "changesNotSentForReview" in text:
        if hold:
            return "Google doesn't accept hold for this app now. Run again without hold if the changes may be reviewed."
        return (
            "Google won't send these changes for review automatically (usually after a rejection). Run again "
            "with hold, then send them from Play Console > Publishing overview."
        )
    return ""


def sync(
    client: Any,
    texts: dict[str, dict[str, str]],
    images: dict[str, list[Image]],
    apply: bool,
    hold: bool = False,
    out=print,
) -> None:
    """Open an edit, print the plan and, with apply, commit it. An edit that isn't committed is deleted."""
    guarded = GuardedClient(client, allow_writes=apply)
    edit_id = (guarded.request("POST", "/edits", payload={}) or {}).get("id")
    if not edit_id:
        raise PlayError("Google opened no edit.")
    edit = f"/edits/{edit_id}"
    keep_edit = False
    try:
        plan = build_plan(guarded, edit, texts, images)
        print_plan(plan, out)
        out("")
        if not apply:
            out("Dry run: nothing was changed. Run with apply to write these values.")
            return
        if not plan.has_changes:
            out("Nothing to change; nothing was committed.")
            return
        out("Applying...")
        apply_changes(guarded, edit, plan, out)
        guarded.request("POST", f"{edit}:validate")
        query = REVIEW_BEHAVIOR + ("&changesNotSentForReview=true" if hold else "")
        try:
            guarded.request("POST", f"{edit}:commit?{query}")
        except PlayError as exc:
            if exc.status is None or exc.status >= 500:
                keep_edit = True
                raise PlayError(
                    f"{exc}\nThe commit may or may not have gone through: look at Play Console > Publishing "
                    "overview before running again.",
                    exc.status,
                ) from None
            hint = _commit_hint(exc, hold)
            raise PlayError("\n".join(filter(None, [str(exc), hint, "Nothing was committed."])), exc.status) from None
        keep_edit = True
        if hold:
            out("Committed and held: not sent for review. Send it from Play Console > Publishing overview.")
            out(_command("warning", "Hold doesn't last by itself: a later commit without hold (an apply, or the next "
                                    "Android release) may send these changes for review too."))
        else:
            out(
                "Committed and sent for Google's review, with any changes that were waiting in Play Console. With "
                "managed publishing off, it goes live once approved."
            )
    finally:
        if not keep_edit:
            try:
                guarded.request("DELETE", edit)
            except PlayError as exc:
                out(_command("warning", f"Couldn't delete the unused edit (it expires by itself): {exc}"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write the repository's Google Play store listing to Google Play.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="validate the document and images only (no network)")
    mode.add_argument("--apply", action="store_true", help="commit the changes (default: dry run)")
    parser.add_argument("--hold", action="store_true", help="with --apply: don't send them for review in this commit")
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args(argv)
    if args.hold and not args.apply:
        parser.error("--hold only works with --apply")
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):  # Windows consoles default to a legacy code page
            stream.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

    try:
        texts = load_texts(args.repo_root)
        images = load_images(args.repo_root)
        if args.check:
            print_check(texts, images)
            return 0
        credentials = read_credentials()
        with temporary_key_file(credentials.private_key) as key_file:
            sync(PlayClient(credentials, key_file), texts, images, args.apply, args.hold)
        return 0
    except (ListingError, PlayError) as exc:
        for line in str(exc).split("\n"):
            print(_command("error", line), file=sys.stderr)
        if getattr(exc, "status", None) == 403:
            print(_command("error", "Check that the service account has 'Manage store presence' for this app."),
                  file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
