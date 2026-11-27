#!/usr/bin/env python3
"""Unit tests for scripts/release/play-store-listing.py. No network: Google Play is faked."""

from __future__ import annotations

import base64
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import urllib.parse
import zlib
from pathlib import Path
from typing import Any
from unittest import mock

_HERE = Path(__file__).resolve().parent
REPO_ROOT = _HERE.parents[1]


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, _HERE / filename)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # dataclasses look their module up here
    spec.loader.exec_module(module)
    return module


play = _load("play_store_listing", "play-store-listing.py")
ListingError = play.ListingError
PlayError = play.PlayError
EMAIL = "play-release@example-project.iam.gserviceaccount.com"


# --- Fixtures ----------------------------------------------------------------------------------


def png(width: int, height: int, tag: str = "", color_type: int = 2, trns: bool = False) -> bytes:
    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))

    header = struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0)
    extra = chunk(b"tRNS", b"\x00\x00") if trns else b""
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"tEXt", b"tag\x00" + tag.encode())
        + extra
        + chunk(b"IDAT", zlib.compress(b"\x00"))
        + chunk(b"IEND", b"")
    )


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


ASSETS = {
    "icon-512.png": png(512, 512, "icon"),
    "feature-graphic-1024x500.png": png(1024, 500, "feature"),
    "screenshots/02-b.png": png(1080, 1920, "b"),
    "screenshots/01-a.png": png(1080, 1920, "a"),
}


def write_assets(root: Path, files: dict[str, bytes | None]) -> None:
    for name, data in files.items():
        path = root / play.ASSET_DIR / name
        path.parent.mkdir(parents=True, exist_ok=True)
        if data is None:
            path.unlink(missing_ok=True)
        else:
            path.write_bytes(data)


def document(overrides: dict[str, str] | None = None) -> str:
    """A listing document with one section per language, Spanish shared like the real one."""
    parts = ["# Title", "", "Intro (not a section).", ""]
    for code in play.LANGUAGES:
        if code == "es-ES":
            continue
        codes = "es-419, es-ES" if code == "es-419" else code
        body = (overrides or {}).get(code) or (
            f"**Name**: App {code}\n\n**Short**：Short {code}\n\n**Full**:\n\nFirst {code}\n\n• Second"
        )
        parts += [f"## Language ({codes})", "", body, ""]
    parts += ["## 其他字段", "", "| a | b |"]
    return "\n".join(parts)


def texts() -> dict[str, dict[str, str]]:
    return play.parse_play_listing(document())


class FakePlay:
    """The endpoints the listing script uses, kept in memory. Changes count only once committed."""

    def __init__(self, listings: dict | None = None, images: dict | None = None, default: str = "en-US") -> None:
        self.listings = listings if listings is not None else {k: {"language": k, **v} for k, v in texts().items()}
        self.images = images if images is not None else {}
        self.default = default
        self.calls: list[tuple[str, str]] = []
        self.payloads: dict[tuple[str, str], Any] = {}
        self.fail: dict[tuple[str, str], PlayError] = {}
        self.encode = lambda digest: digest
        self.reverse_list = False
        self.next_id = 0

    def add_images(self, language: str, image_type: str, *contents: bytes) -> None:
        for content in contents:
            self.next_id += 1
            self.images.setdefault((language, image_type), []).append(
                {"id": f"i{self.next_id}", "sha256": self.encode(sha(content))}
            )

    def writes(self) -> list[tuple[str, str]]:
        return [(m, p) for m, p in self.calls if m != "GET"]

    def request(self, method: str, path: str, payload=None, media=None) -> Any:
        self.calls.append((method, path))
        self.payloads[(method, path)] = payload
        for (fail_method, prefix), error in self.fail.items():
            if method == fail_method and path.startswith(prefix):
                raise error
        path = path.partition("?")[0]
        if (method, path) == ("POST", "/edits"):
            return {"id": "e1"}
        if path in ("/edits/e1", "/edits/e1:validate", "/edits/e1:commit"):
            return {"id": "e1"}
        if path == "/edits/e1/details":
            return {"defaultLanguage": self.default, "contactEmail": "someone@example.com"}
        if path == "/edits/e1/listings":
            return {"listings": list(self.listings.values())}
        parts = path.removeprefix("/edits/e1/listings/").split("/")
        if len(parts) == 1:
            language = parts[0]
            base = self.listings.get(language, {}) if method == "PATCH" else {}
            self.listings[language] = {**base, **payload}
            return self.listings[language]
        key = (parts[0], parts[1])
        if method == "GET":
            found = list(self.images.get(key, []))
            return {"images": found[::-1] if self.reverse_list else found}
        if method == "DELETE":
            return {"deleted": self.images.pop(key, [])}
        self.add_images(*key, media)
        return {"image": self.images[key][-1]}


class Base(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="play-listing."))
        self.addCleanup(shutil.rmtree, self.root, True)
        write_assets(self.root, ASSETS)
        self.lines: list[str] = []

    def images(self) -> dict:
        return play.load_images(self.root)

    def sync(self, fake: FakePlay, apply: bool = False, hold: bool = False) -> None:
        play.sync(fake, texts(), self.images(), apply, hold, out=self.lines.append)

    def text(self) -> str:
        return "\n".join(self.lines)

    def in_place(self) -> FakePlay:
        fake = FakePlay()
        for image_type, files in self.images().items():
            fake.add_images("en-US", image_type, *(f.path.read_bytes() for f in files))
        return fake


# --- Documents and images ----------------------------------------------------------------------


class DocumentTests(unittest.TestCase):
    def test_the_repository_document(self) -> None:
        listing = play.load_texts(REPO_ROOT)
        self.assertEqual(list(listing), list(play.LANGUAGES))
        self.assertEqual(listing["es-419"], listing["es-ES"])
        self.assertEqual(listing["en-US"]["title"], "NoteFable: AI Chat & Workspace")
        self.assertTrue(listing["en-US"]["fullDescription"].endswith("https://notefable.com/privacy"))
        self.assertNotIn("**", listing["ru-RU"]["fullDescription"])

    def test_reads_names_and_descriptions_like_the_app_store_script(self) -> None:
        ios = _load("ios_store_listing_for_play", "ios-store-listing.py")
        source = (REPO_ROOT / play.PLAY_STORE_DOC).read_text(encoding="utf-8")
        listing = play.parse_play_listing(source)
        for code, (name, description) in ios.parse_play_listing(source).items():
            for language in code.split(", "):
                self.assertEqual((listing[language]["title"], listing[language]["fullDescription"]), (name, description))

    def test_rejects_a_document_it_cannot_read_safely(self) -> None:
        cases = {
            "no section for fr-FR": document().replace("(fr-FR)", "French"),
            "doesn't manage": document().replace("(fr-FR)", "(fr-CA)"),
            "two sections for ja-JP": document().replace("(ko-KR)", "(ja-JP)"),
            "three labels": document({"de-DE": "**Name**: A\n\n**Short**: first line\nwrapped\n\n**Full**:\n\nText"}),
            "no full description": document({"de-DE": "**Name**: A\n\n**Short**: B\n\n**Full**:"}),
        }
        for message, source in cases.items():
            with self.subTest(message), self.assertRaisesRegex(ListingError, message):
                play.parse_play_listing(source)

    def test_enforces_the_character_limits(self) -> None:
        root = Path(tempfile.mkdtemp(prefix="play-listing-doc."))
        self.addCleanup(shutil.rmtree, root, True)
        path = root / play.PLAY_STORE_DOC
        path.parent.mkdir(parents=True)
        long = f"**Name**: {'n' * 31}\n\n**Short**: {'s' * 81}\n\n**Full**:\n\n{'f' * 4001}"
        path.write_text(document({"ar": long}), encoding="utf-8")
        with self.assertRaises(ListingError) as ctx:
            play.load_texts(root)
        for message in ("name is 31", "short description is 81", "full description is 4001"):
            self.assertIn(f"ar: {message}", str(ctx.exception).replace("app name", "name"))


class ImageTests(Base):
    def test_the_repository_images(self) -> None:
        images = play.load_images(REPO_ROOT)
        self.assertEqual(len(images["icon"]), 1)
        names = [i.path.name for i in images["phoneScreenshots"]]
        self.assertEqual(names, sorted(names))

    def test_screenshots_are_taken_in_file_name_order(self) -> None:
        self.assertEqual([i.path.name for i in self.images()["phoneScreenshots"]], ["01-a.png", "02-b.png"])

    def test_rejects_images_play_would_not_take(self) -> None:
        cases = {
            "512x512": {"icon-512.png": png(500, 500)},
            "1024x500": {"feature-graphic-1024x500.png": png(1024, 512)},
            "feature-graphic-1024x500.png: has transparency": {
                "feature-graphic-1024x500.png": png(1024, 500, color_type=6)
            },
            "03-c.png: has transparency": {"screenshots/03-c.png": png(1080, 1920, trns=True)},
            "twice the short one": {"screenshots/03-c.png": png(1080, 2400)},
            "320-3840": {"screenshots/03-c.png": png(300, 500)},
            "1 screenshots": {"screenshots/02-b.png": None},
            "9 screenshots": {f"screenshots/1{n}.png": png(1080, 1920) for n in range(7)},
            "only .png": {"screenshots/03-c.jpg": b"x"},
            "not a PNG": {"screenshots/03-c.png": b"x" * 40},
            "icon-512.png: missing": {"icon-512.png": None},
        }
        for message, files in cases.items():
            with self.subTest(message):
                shutil.rmtree(self.root / play.ASSET_DIR)
                write_assets(self.root, {**ASSETS, **files})
                with self.assertRaisesRegex(ListingError, re.escape(message)):
                    self.images()

    def test_check_needs_no_network_and_no_credential(self) -> None:
        output = io.StringIO()
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch(
            "urllib.request.urlopen", side_effect=AssertionError("network")
        ), contextlib.redirect_stdout(output):
            self.assertEqual(play.main(["--check", "--repo-root", str(REPO_ROOT)]), 0)
        self.assertIn("18 languages", output.getvalue())
        self.assertIn("(same text as es-ES)", output.getvalue())

    def test_hold_needs_apply(self) -> None:
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            play.main(["--hold"])


# --- Credential and HTTP -----------------------------------------------------------------------


class CredentialTests(unittest.TestCase):
    def test_reads_the_service_account_key_without_echoing_it(self) -> None:
        value = json.dumps({"client_email": EMAIL, "private_key": "PEM", "private_key_id": "k"})
        credentials = play.read_credentials({play.SECRET_ENV: value})
        self.assertEqual((credentials.email, credentials.private_key, credentials.key_id), (EMAIL, "PEM", "k"))
        self.assertNotIn(EMAIL, repr(credentials))
        for bad in ("", "not json SECRET", '"SECRET"', '["SECRET"]', '{"client_email": "SECRET"}'):
            with self.subTest(bad=bad), self.assertRaises(PlayError) as ctx:
                play.read_credentials({play.SECRET_ENV: bad})
            self.assertNotIn("SECRET", str(ctx.exception))

    @unittest.skipUnless(shutil.which("openssl"), "openssl is not installed")
    def test_signs_an_rs256_assertion(self) -> None:
        pem = subprocess.run(["openssl", "genrsa", "2048"], capture_output=True, check=True).stdout.decode()
        with play.temporary_key_file(pem) as key_file:
            assertion = play.sign_jwt(play.Credentials(EMAIL, pem, "kid-1"), key_file, now=1000)
            header, claims, signature = assertion.split(".")
            decode = lambda part: base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))
            directory = Path(key_file).parent
            public = directory / "public.pem"
            subprocess.run(["openssl", "rsa", "-in", key_file, "-pubout", "-out", str(public)],
                           capture_output=True, check=True)
            (directory / "signature").write_bytes(decode(signature))
            verified = subprocess.run(
                ["openssl", "dgst", "-sha256", "-verify", str(public), "-signature", str(directory / "signature")],
                input=f"{header}.{claims}".encode(), capture_output=True, check=False,
            )
        self.assertEqual(verified.returncode, 0)
        self.assertFalse(directory.exists())
        self.assertEqual(json.loads(decode(header)), {"alg": "RS256", "typ": "JWT", "kid": "kid-1"})
        self.assertEqual(
            json.loads(decode(claims)),
            {"iss": EMAIL, "scope": play.SCOPE, "aud": play.TOKEN_URL, "iat": 1000, "exp": 4600},
        )


def http_error(code: int, body: dict) -> urllib.error.HTTPError:
    return urllib.error.HTTPError("https://invalid", code, "error", {}, io.BytesIO(json.dumps(body).encode()))


class ClientTests(unittest.TestCase):
    def setUp(self) -> None:
        patcher = mock.patch.object(play, "sign_jwt", return_value="assertion")
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client = play.PlayClient(play.Credentials(EMAIL, "PEM", None), "key", sleep_fn=lambda _: None)
        self.token = io.BytesIO(b'{"access_token": "ya29.abc", "expires_in": 3600}')

    def test_exchanges_the_assertion_once_and_sends_the_token(self) -> None:
        responses = [self.token, io.BytesIO(b'{"id": "e"}'), io.BytesIO(b""), io.BytesIO(b"{}")]
        with mock.patch("urllib.request.urlopen", side_effect=responses) as urlopen:
            self.assertEqual(self.client.request("POST", "/edits", payload={}), {"id": "e"})
            self.assertIsNone(self.client.request("DELETE", "/edits/e"))
            self.client.request("POST", "/edits/e/listings/en-US/icon?uploadType=media", media=b"png")
        token, insert, delete, upload = [call.args[0] for call in urlopen.call_args_list]
        self.assertEqual(token.full_url, play.TOKEN_URL)
        self.assertEqual(
            dict(urllib.parse.parse_qsl(token.data.decode())),
            {"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": "assertion"},
        )
        base = "https://androidpublisher.googleapis.com"
        app = "/androidpublisher/v3/applications/com.kakumine.notefable"
        self.assertEqual(insert.full_url, f"{base}{app}/edits")
        self.assertEqual(insert.headers["Authorization"], "Bearer ya29.abc")
        self.assertEqual(delete.get_method(), "DELETE")
        self.assertEqual(upload.full_url, f"{base}/upload{app}/edits/e/listings/en-US/icon?uploadType=media")
        self.assertEqual((upload.data, upload.headers["Content-type"]), (b"png", "image/png"))

    def test_resends_reads_and_rate_limits_but_not_other_writes(self) -> None:
        with mock.patch("urllib.request.urlopen", side_effect=[self.token, http_error(503, {}), io.BytesIO(b"{}")]):
            self.assertEqual(self.client.request("GET", "/edits/e/listings"), {})
        with mock.patch("urllib.request.urlopen", side_effect=[http_error(429, {}), io.BytesIO(b"{}")]):
            self.assertEqual(self.client.request("POST", "/edits/e:commit"), {})
        for error in (http_error(503, {}), TimeoutError("slow")):
            with mock.patch("urllib.request.urlopen", side_effect=error) as urlopen:
                with self.assertRaises(PlayError):
                    self.client.request("POST", "/edits/e:commit")
            self.assertEqual(urlopen.call_count, 1)

    def test_errors_carry_no_account_identifiers(self) -> None:
        body = {"error": "invalid_grant", "error_description": f"account {EMAIL} not found"}
        with mock.patch("urllib.request.urlopen", side_effect=http_error(400, body)):
            with self.assertRaises(PlayError) as ctx:
                self.client.request("GET", "/edits/e/details")
        self.assertEqual(str(ctx.exception), "Getting an access token: HTTP 400 invalid_grant")
        message = (
            f"{EMAIL} lacks access; API disabled in project 123456789012, see ?project=123456789012 "
            "token ya29.secret-token"
        )
        body = {"error": {"status": "PERMISSION_DENIED", "message": message, "errors": [{"reason": "forbidden"}]}}
        with mock.patch("urllib.request.urlopen", side_effect=[self.token, http_error(403, body)]):
            with self.assertRaises(PlayError) as ctx:
                self.client.request("GET", "/edits/e/details")
        text = str(ctx.exception)
        self.assertIn("HTTP 403 PERMISSION_DENIED", text)
        self.assertIn("(forbidden)", text)
        for secret in (EMAIL, "123456789012", "ya29."):
            self.assertNotIn(secret, text)


# --- Guard and sync ----------------------------------------------------------------------------


class GuardTests(unittest.TestCase):
    def test_refuses_everything_outside_the_listing(self) -> None:
        inner = mock.Mock()
        guard = play.GuardedClient(inner, allow_writes=True)
        for method, path in (
            ("PUT", "/edits/e/tracks/alpha"),
            ("GET", "/edits/e/tracks"),
            ("PUT", "/edits/e/testers/alpha"),
            ("POST", "/edits/e/bundles"),
            ("PATCH", "/edits/e/details"),
            ("DELETE", "/edits/e/listings"),
            ("DELETE", "/edits/e/listings/fr-FR"),
            ("DELETE", "/edits/e/listings/en-US"),
            ("DELETE", "/edits/e/listings/ja-JP/icon"),
            ("DELETE", "/edits/e/listings/en-US/tenInchScreenshots"),
            ("PATCH", "/edits/e/listings/es-US"),
            ("POST", "/edits/e:commit"),
            ("POST", "/inappproducts"),
            ("POST", "/subscriptions"),
            ("POST", "/dataSafety"),
        ):
            with self.subTest(method=method, path=path), self.assertRaises(PlayError):
                guard.request(method, path)
        inner.request.assert_not_called()

    def test_a_dry_run_only_opens_reads_and_deletes(self) -> None:
        inner = mock.Mock()
        guard = play.GuardedClient(inner, allow_writes=False)
        for method, path in (
            ("PATCH", "/edits/e/listings/en-US"),
            ("DELETE", "/edits/e/listings/en-US/icon"),
            ("POST", "/edits/e:validate"),
            ("POST", f"/edits/e:commit?{play.REVIEW_BEHAVIOR}"),
        ):
            with self.subTest(path=path), self.assertRaises(PlayError):
                guard.request(method, path)
        inner.request.assert_not_called()


COMMIT = f"/edits/e1:commit?{play.REVIEW_BEHAVIOR}"


class SyncTests(Base):
    def changed(self) -> FakePlay:
        fake = self.in_place()
        fake.listings["ja-JP"] = {**fake.listings["ja-JP"], "shortDescription": "old", "video": "https://v"}
        fake.listings["en-US"] = {**fake.listings["en-US"], "fullDescription": "First en-US\n\n::error::old line"}
        del fake.listings["th"]
        fake.listings["es-US"] = {"language": "es-US", "title": "Other"}
        fake.add_images("es-US", "phoneScreenshots", b"own")
        fake.add_images("ko-KR", "icon", b"own")
        fake.add_images("en-US", "tenInchScreenshots", b"tablet")
        fake.images.pop(("en-US", "phoneScreenshots"))
        fake.add_images("en-US", "phoneScreenshots", b"old shot")
        return fake

    def test_a_dry_run_prints_the_differences_and_deletes_the_edit(self) -> None:
        fake = self.changed()
        self.sync(fake)
        self.assertEqual(fake.writes(), [("POST", "/edits"), ("DELETE", "/edits/e1")])
        text = self.text()
        for expected in (
            "[ja-JP]\n  short description: CHANGE\n    current: old\n    new:     Short ja-JP",
            "[th] not on Play yet, will be added",
            "[fr-FR] unchanged",
            "    | -::error::old line",
            "icon: unchanged (1 in place)",
            "phoneScreenshots: replace 1 current with 2 new",
            "listings for es-US, not in the document; left unchanged",
            "::warning::es-US has its own images on Play (1 phoneScreenshots)",
            "::warning::ko-KR has its own images on Play (1 icon)",
            "2 field changes, 1 languages to add, 1 image types to replace",
            "Dry run: nothing was changed",
        ):
            self.assertIn(expected, text)
        self.assertNotIn("someone@example.com", text)
        self.assertFalse([line for line in self.lines if line.lstrip().startswith("::error")])

    def test_apply_writes_only_the_differences_and_commits(self) -> None:
        fake = self.changed()
        self.sync(fake, apply=True)
        images = "/edits/e1/listings/en-US/phoneScreenshots"
        upload = f"{images}?uploadType=media&aiGeneratedState={play.AI_GENERATED_STATE}"
        self.assertEqual(
            fake.writes(),
            [
                ("POST", "/edits"),
                ("PATCH", "/edits/e1/listings/en-US"),
                ("PATCH", "/edits/e1/listings/ja-JP"),
                ("PUT", "/edits/e1/listings/th"),
                ("DELETE", images),
                ("POST", upload),
                ("POST", upload),
                ("POST", "/edits/e1:validate"),
                ("POST", COMMIT),
            ],
        )
        self.assertEqual(
            fake.payloads[("PATCH", "/edits/e1/listings/ja-JP")],
            {"language": "ja-JP", "shortDescription": "Short ja-JP"},
        )
        self.assertEqual(fake.listings["ja-JP"]["video"], "https://v")
        self.assertEqual(fake.listings["es-US"], {"language": "es-US", "title": "Other"})
        self.assertEqual(
            [i["sha256"] for i in fake.images[("en-US", "phoneScreenshots")]],
            [sha(ASSETS["screenshots/01-a.png"]), sha(ASSETS["screenshots/02-b.png"])],
        )
        self.assertIn(("en-US", "tenInchScreenshots"), fake.images)
        self.assertIn(("ko-KR", "icon"), fake.images)
        self.assertIn("goes live once approved", self.text())

    def test_hold_asks_google_not_to_send_the_changes_for_review(self) -> None:
        fake = self.changed()
        self.sync(fake, apply=True, hold=True)
        self.assertEqual(fake.writes()[-1], ("POST", f"{COMMIT}&changesNotSentForReview=true"))
        self.assertIn("not sent for review", self.text())
        self.assertIn("::warning::Hold doesn't last by itself", self.text())
        self.assertIn("the next Android release", self.text())

    def test_nothing_to_change_means_no_commit(self) -> None:
        # A commit would also send the changes waiting in Play Console for review.
        for encode in (str, str.upper, lambda d: base64.b64encode(bytes.fromhex(d)).decode()):
            self.lines.clear()
            fake = FakePlay()
            fake.encode = encode
            for image_type, files in self.images().items():
                fake.add_images("en-US", image_type, *(f.path.read_bytes() for f in files))
            self.sync(fake, apply=True)
            self.assertEqual(fake.writes(), [("POST", "/edits"), ("DELETE", "/edits/e1")])
            self.assertIn("nothing was committed", self.text())

    def test_reordered_screenshots_are_replaced(self) -> None:
        fake = self.in_place()
        fake.images[("en-US", "phoneScreenshots")].reverse()
        self.sync(fake)
        self.assertIn("phoneScreenshots: replace 2 current with 2 new", self.text())

    def test_a_missing_default_listing_gets_text_before_images(self) -> None:
        fake = FakePlay(listings={}, default="ja-JP")
        self.sync(fake, apply=True)
        writes = fake.writes()
        self.assertLess(
            writes.index(("PUT", "/edits/e1/listings/en-US")),
            writes.index(("DELETE", "/edits/e1/listings/en-US/icon")),
        )
        self.assertIn("The default language on Play is ja-JP", self.text())

    def test_a_failure_discards_the_whole_edit(self) -> None:
        for failing in (("PATCH", "/edits/e1/listings/ja-JP"), ("POST", "/edits/e1:validate")):
            fake = self.changed()
            fake.fail[failing] = PlayError("HTTP 400 bad", status=400)
            with self.assertRaises(PlayError):
                self.sync(fake, apply=True)
            self.assertEqual(fake.writes()[-1], ("DELETE", "/edits/e1"))
            self.assertNotIn(("POST", COMMIT), fake.writes())

    def test_a_failed_read_still_deletes_the_edit(self) -> None:
        fake = FakePlay()
        fake.fail[("GET", "/edits/e1/listings")] = PlayError("HTTP 403", status=403)
        with self.assertRaises(PlayError):
            self.sync(fake)
        self.assertEqual(fake.writes()[-1], ("DELETE", "/edits/e1"))

    def test_another_screenshot_order_on_play_is_not_committed(self) -> None:
        fake = self.changed()
        fake.reverse_list = True
        with self.assertRaisesRegex(PlayError, "order differs"):
            self.sync(fake, apply=True)
        self.assertNotIn(("POST", COMMIT), fake.writes())

    def test_a_processed_image_hash_is_reported(self) -> None:
        fake = self.changed()
        fake.encode = lambda digest: "0" * 64
        self.sync(fake, apply=True)
        self.assertIn("Play reports another sha256", self.text())

    def test_a_refused_commit_is_explained_and_not_forced(self) -> None:
        cases = (
            (False, "HTTP 400 You already have changes in review. (CHANGES_ALREADY_IN_REVIEW)", "after that review"),
            (False, "HTTP 400 Please set the query parameter changesNotSentForReview to true.", "Run again with hold"),
            (True, "HTTP 400 The parameter changesNotSentForReview must not be set.", "doesn't accept hold"),
        )
        for hold, message, hint in cases:
            fake = self.changed()
            fake.fail[("POST", COMMIT)] = PlayError(message, status=400)
            with self.subTest(hint), self.assertRaises(PlayError) as ctx:
                self.sync(fake, apply=True, hold=hold)
            self.assertIn(hint, str(ctx.exception))
            self.assertIn("Nothing was committed", str(ctx.exception))
            commits = [path for _, path in fake.writes() if ":commit" in path]
            self.assertEqual(len(commits), 1)  # never retried with other parameters
            self.assertEqual(fake.writes()[-1], ("DELETE", "/edits/e1"))

    def test_an_unknown_commit_result_is_reported_as_unknown(self) -> None:
        fake = self.changed()
        fake.fail[("POST", COMMIT)] = PlayError("network error: timed out")
        with self.assertRaisesRegex(PlayError, "may or may not have gone through"):
            self.sync(fake, apply=True)
        self.assertEqual(fake.writes()[-1], ("POST", COMMIT))

    def test_main_prints_one_line_errors_without_the_credential(self) -> None:
        value = json.dumps({"client_email": EMAIL, "private_key": "PEM-SECRET"})
        errors = io.StringIO()
        with mock.patch.dict(os.environ, {play.SECRET_ENV: value}), mock.patch.object(
            play, "sync", side_effect=PlayError(f"HTTP 403 {EMAIL}\ndenied", status=403)
        ), contextlib.redirect_stderr(errors):
            self.assertEqual(play.main(["--repo-root", str(REPO_ROOT)]), 1)
        text = errors.getvalue()
        self.assertIn("::error::HTTP 403 [email]\n::error::denied", text)
        self.assertIn("Manage store presence", text)
        self.assertNotIn(EMAIL, text)
        self.assertNotIn("PEM-SECRET", text)


# --- Repository setup --------------------------------------------------------------------------


def workflow(name: str) -> str:
    return (REPO_ROOT / ".github/workflows" / name).read_text(encoding="utf-8")


class RepositorySetupTests(unittest.TestCase):
    def test_the_workflow_is_manual_main_only_and_hands_the_secret_to_one_step(self) -> None:
        text = workflow("play-store-listing.yml")
        triggers = text[text.index("\non:\n") : text.index("\npermissions:\n")]
        self.assertEqual(re.findall(r"(?m)^  (\w+):", triggers), ["workflow_dispatch"])
        self.assertIn("if: github.ref == 'refs/heads/main'", text)
        self.assertIn("environment: play-publish", text)
        self.assertIn("permissions:\n  contents: read\n", text)
        self.assertEqual(text.count("secrets."), 1)
        self.assertEqual(len(re.findall(r"default: false", text)), 2)

    def test_listing_syncs_and_releases_never_run_at_the_same_time(self) -> None:
        # Opening an edit invalidates the same account's earlier one.
        block = r"concurrency:\n      group: (\S+)\n      cancel-in-progress: false\n      queue: max"
        listing = re.search(block, workflow("play-store-listing.yml")).group(1)
        self.assertEqual(listing, re.search(block, workflow("android-release.yml")).group(1))

    def test_listing_changes_run_the_pr_check(self) -> None:
        text = workflow("store-listing-pr.yml")
        patterns = re.findall(r'(?m)^      - "([^"]+)"$', text)
        for changed in (
            play.PLAY_STORE_DOC,
            f"{play.ASSET_DIR}/icon-512.png",
            f"{play.ASSET_DIR}/screenshots/01-chat1.png",
            "scripts/release/play-store-listing.py",
            "scripts/release/test_play_store_listing.py",
            ".github/workflows/play-store-listing.yml",
            # What the tests here compare against:
            ".github/workflows/android-release.yml",
            "scripts/release/ios-store-listing.py",
        ):
            regexes = [re.escape(p).replace(r"\*\*", ".*").replace(r"\*", "[^/]*") for p in patterns]
            self.assertTrue(any(re.fullmatch(r, changed) for r in regexes), changed)
        self.assertIn("play-store-listing.py --check", text)
        self.assertIn("test_play_store_listing.py", text)


if __name__ == "__main__":
    unittest.main()
