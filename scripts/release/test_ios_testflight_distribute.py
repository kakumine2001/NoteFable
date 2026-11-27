#!/usr/bin/env python3
"""Unit tests for scripts/release/ios-testflight-distribute.py."""

from __future__ import annotations

import base64
import contextlib
import http.client
import importlib.util
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
import urllib.error
from collections import Counter
from typing import Any
from unittest import mock

_SCRIPT_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "ios-testflight-distribute.py"
)
_SPEC = importlib.util.spec_from_file_location("ios_testflight_distribute", _SCRIPT_PATH)
assert _SPEC and _SPEC.loader
dist_mod = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(dist_mod)


class FakeAscClient:
    """In-memory mock of AscClient.request for testing orchestration logic."""

    def __init__(self, handler) -> None:
        self.handler = handler
        self.calls: list[tuple[str, str, Any, bool]] = []

    def request(
        self,
        method: str,
        path_or_url: str,
        payload: dict[str, Any] | None = None,
        allow_404: bool = False,
        safe_to_resend: bool = False,
    ) -> Any:
        self.calls.append((method, path_or_url, payload, allow_404))
        return self.handler(method, path_or_url, payload, allow_404)


class DerToRawEcdsaTests(unittest.TestCase):
    def test_converts_short_and_33_byte_integers(self) -> None:
        # r has a leading 0x00 (33 bytes); s is 31 bytes (needs left-padding)
        r_body = b"\x00" + bytes(range(0x80, 0xA0))
        s_body = bytes(range(1, 32))
        seq = b"\x02" + bytes([len(r_body)]) + r_body + b"\x02" + bytes([len(s_body)]) + s_body
        der = b"\x30" + bytes([len(seq)]) + seq

        raw = dist_mod.der_to_raw_ecdsa(der, part_len=32)
        self.assertEqual(len(raw), 64)
        self.assertEqual(raw[:32], r_body[1:])
        self.assertEqual(raw[32:], b"\x00" + s_body)

    def test_rejects_malformed_der(self) -> None:
        with self.assertRaises(ValueError):
            dist_mod.der_to_raw_ecdsa(b"\x31\x06\x02\x01\x01\x02\x01\x01")

    @unittest.skipUnless(shutil.which("openssl"), "openssl binary not available")
    def test_sign_jwt_es256_produces_valid_structure(self) -> None:
        tmpdir = tempfile.mkdtemp(prefix="asc-jwt-test.")
        try:
            key_file = os.path.join(tmpdir, "test.p8")
            subprocess.run(
                [
                    "openssl",
                    "ecparam",
                    "-name",
                    "prime256v1",
                    "-genkey",
                    "-noout",
                    "-out",
                    key_file,
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            token, exp = dist_mod.sign_jwt_es256(
                key_id="KEY1234567",
                issuer_id="11111111-2222-3333-4444-555555555555",
                key_file=key_file,
                now=1700000000,
                lifetime=900,
            )
            self.assertEqual(exp, 1700000900)
            parts = token.split(".")
            self.assertEqual(len(parts), 3)

            def _b64url_decode(part: str) -> bytes:
                pad = "=" * (-len(part) % 4)
                return base64.urlsafe_b64decode(part + pad)

            header = json.loads(_b64url_decode(parts[0]).decode("utf-8"))
            payload = json.loads(_b64url_decode(parts[1]).decode("utf-8"))
            sig = _b64url_decode(parts[2])

            self.assertEqual(header, {"alg": "ES256", "kid": "KEY1234567", "typ": "JWT"})
            self.assertEqual(
                payload,
                {
                    "aud": "appstoreconnect-v1",
                    "exp": 1700000900,
                    "iat": 1700000000,
                    "iss": "11111111-2222-3333-4444-555555555555",
                },
            )
            self.assertEqual(len(sig), 64)
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)


class CredentialTests(unittest.TestCase):
    def test_reads_all_three_variables_or_fails(self) -> None:
        env = {
            "APPSTORE_API_KEY_ID": " KEY1 ",
            "APPSTORE_API_ISSUER_ID": "issuer",
            "APPSTORE_API_KEY_P8_B64": "aGVs\nbG8=\n",
        }
        with mock.patch.dict(os.environ, env):
            self.assertEqual(dist_mod.read_api_credentials(), ("KEY1", "issuer", "aGVsbG8="))
        with mock.patch.dict(os.environ, {**env, "APPSTORE_API_ISSUER_ID": ""}):
            with self.assertRaises(dist_mod.AscError):
                dist_mod.read_api_credentials()

    def test_key_file_is_removed_after_use(self) -> None:
        with dist_mod.temporary_key_file("KEY1", base64.b64encode(b"pem").decode()) as key_file:
            with open(key_file, "rb") as fh:
                self.assertEqual(fh.read(), b"pem")
        self.assertFalse(os.path.exists(os.path.dirname(key_file)))


def offline_client():
    client = dist_mod.AscClient("KEY1", "issuer", "unused.p8", sleep_fn=lambda _: None)
    client._get_token = lambda: "token"  # no openssl needed
    return client


def http_error(status: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError("https://api.invalid/x", status, "Error", None, io.BytesIO(b""))


def json_response(body: Any) -> mock.MagicMock:
    response = mock.MagicMock()
    response.__enter__.return_value.status = 200
    response.__enter__.return_value.read.return_value = json.dumps(body).encode()
    return response


class ServerErrorTests(unittest.TestCase):
    def sent(self, method: str, status: int, **kwargs: Any) -> int:
        """How often a request that always gets this status is sent."""
        with mock.patch("urllib.request.urlopen", side_effect=http_error(status)) as urlopen:
            with self.assertRaises(dist_mod.AscError) as ctx:
                offline_client().request(method, "/appAssetLibraryPlacements", **kwargs)
        self.assertEqual(ctx.exception.status, status)
        return urlopen.call_count

    def test_a_write_is_not_sent_again_after_a_server_error(self) -> None:
        for status in (500, 502, 503, 504):
            for method in ("POST", "PATCH", "DELETE"):
                with self.subTest(method=method, status=status):
                    self.assertEqual(self.sent(method, status), 1)
            with self.subTest(method="GET", status=status):
                self.assertEqual(self.sent("GET", status), 3)

    def test_a_rate_limit_or_a_harmless_write_is_sent_again(self) -> None:
        for method in ("GET", "POST", "PATCH", "DELETE"):
            with self.subTest(method=method):
                self.assertEqual(self.sent(method, 429), 3)
        self.assertEqual(self.sent("POST", 503, safe_to_resend=True), 3)
        self.assertEqual(self.sent("POST", 409, safe_to_resend=True), 1)


class FlakyTestFlight:
    """urlopen stand-in for distribution: every write answers 503 the first time it is sent."""

    def __init__(self, applies_before_failing: bool, whats_new: str | None) -> None:
        self.applies_before_failing = applies_before_failing
        self.whats_new = whats_new  # None: the build has no en-US localization yet
        self.in_group = False
        self.review_state: str | None = None
        self.sent: Counter = Counter()

    def __call__(self, request: Any, timeout: float) -> Any:
        method, path = request.get_method(), request.full_url[len(dist_mod.ASC_API_BASE) :]
        if method == "GET":
            return json_response(self.read(path))
        self.sent[method, path] += 1
        first = self.sent[method, path] == 1
        if self.applies_before_failing or not first:
            body = self.write(method, path, json.loads(request.data))
        if first:
            raise http_error(503)
        return json_response(body)

    def read(self, path: str) -> Any:
        if path.startswith("/apps?"):
            return {"data": [{"id": "app-1", "attributes": {"bundleId": "com.kakumine.notefable"}}]}
        if path.startswith("/apps/app-1/betaGroups"):
            return {"data": [{"id": "grp", "attributes": {"name": "External", "isInternalGroup": False}}]}
        if path.startswith("/builds?"):
            return {"data": [{"id": "bld", "attributes": {"processingState": "VALID"}}]}
        if path.startswith("/builds/bld/betaBuildLocalizations"):
            found = {"id": "loc", "attributes": {"locale": "en-US"}}
            return {"data": [] if self.whats_new is None else [found]}
        if path == "/builds/bld/betaAppReviewSubmission":
            state = self.review_state
            return {"data": {"id": "sub", "attributes": {"betaReviewState": state}} if state else None}
        raise AssertionError(f"Unexpected read: {path}")

    def write(self, method: str, path: str, payload: Any) -> Any:
        if (method, path) == ("POST", "/betaBuildLocalizations"):
            if self.whats_new is not None:
                raise http_error(409)  # one localization per build and language
            self.whats_new = payload["data"]["attributes"]["whatsNew"]
        elif (method, path) == ("PATCH", "/betaBuildLocalizations/loc"):
            self.whats_new = payload["data"]["attributes"]["whatsNew"]
        elif (method, path) == ("POST", "/betaGroups/grp/relationships/builds"):
            self.in_group = True
        elif (method, path) == ("POST", "/betaAppReviewSubmissions"):
            if self.review_state:
                raise http_error(409)
            self.review_state = "WAITING_FOR_REVIEW"
            return {"data": {"id": "sub", "attributes": {"betaReviewState": self.review_state}}}
        else:
            raise AssertionError(f"Unexpected write: {method} {path}")
        return {}


class FlakyDistributionTests(unittest.TestCase):
    def test_distribution_gets_through_a_server_error_on_every_write(self) -> None:
        for applies_before_failing in (True, False):
            for whats_new in (None, "Old notes."):
                with self.subTest(applies_before_failing=applies_before_failing, whats_new=whats_new):
                    server = FlakyTestFlight(applies_before_failing, whats_new)
                    with mock.patch("urllib.request.urlopen", side_effect=server):
                        with contextlib.redirect_stdout(io.StringIO()):
                            result = dist_mod.distribute_external(
                                client=offline_client(),
                                bundle_id="com.kakumine.notefable",
                                marketing_version="0.1.0",
                                build_number="4",
                                group_name="External",
                                locale="en-US",
                                whats_new="New notes.",
                                sleep_fn=lambda _: None,
                                time_fn=lambda: 0.0,
                            )
                    self.assertEqual(result["review_state"], "WAITING_FOR_REVIEW")
                    self.assertEqual((server.whats_new, server.in_group), ("New notes.", True))
                    if applies_before_failing:  # a create that went through is not sent again
                        self.assertLessEqual(server.sent["POST", "/betaBuildLocalizations"], 1)


class NetworkErrorTests(unittest.TestCase):
    def test_timeouts_and_drops_become_asc_errors_and_only_reads_are_sent_again(self) -> None:
        errors = (
            TimeoutError("timed out"),
            http.client.RemoteDisconnected("closed"),
            http.client.IncompleteRead(b""),
        )
        for error in errors:
            for method, sent in (("GET", 3), ("POST", 1), ("PATCH", 1), ("DELETE", 1)):
                with self.subTest(error=type(error).__name__, method=method):
                    with mock.patch("urllib.request.urlopen", side_effect=error) as urlopen:
                        with self.assertRaises(dist_mod.AscError):
                            offline_client().request(method, "/apps")
                    self.assertEqual(urlopen.call_count, sent)

    def test_a_read_succeeds_after_a_dropped_response(self) -> None:
        side_effect = [TimeoutError("timed out"), json_response({"data": []})]
        with mock.patch("urllib.request.urlopen", side_effect=side_effect):
            self.assertEqual(offline_client().request("GET", "/apps"), {"data": []})

    def test_an_unreadable_error_body_keeps_the_status(self) -> None:
        body = mock.Mock()
        body.read.side_effect = ConnectionResetError("reset")
        error = urllib.error.HTTPError("https://api.invalid/x", 409, "Conflict", None, body)
        with mock.patch("urllib.request.urlopen", side_effect=error):
            with self.assertRaises(dist_mod.AscError) as ctx:
                offline_client().request("POST", "/apps")
        self.assertEqual(ctx.exception.status, 409)


class DistributeExternalFlowTests(unittest.TestCase):
    def test_full_flow_polls_creates_whats_new_adds_to_group_and_submits(self) -> None:
        poll_count = 0

        def handler(method: str, path: str, payload: Any, allow_404: bool) -> Any:
            nonlocal poll_count
            if method == "GET" and path.startswith("/apps?"):
                return {
                    "data": [
                        {
                            "id": "app-1",
                            "attributes": {"bundleId": "com.kakumine.notefable"},
                        }
                    ]
                }
            if method == "GET" and path == "/apps/app-1/betaGroups?limit=200":
                return {
                    "data": [
                        {
                            "id": "grp-int",
                            "attributes": {"name": "External", "isInternalGroup": True},
                        },
                        {
                            "id": "grp-ext",
                            "attributes": {"name": "External", "isInternalGroup": False},
                        },
                    ]
                }
            if method == "GET" and path.startswith("/builds?"):
                poll_count += 1
                state = "PROCESSING" if poll_count == 1 else "VALID"
                return {"data": [{"id": "bld-4", "attributes": {"processingState": state}}]}
            if method == "GET" and path == "/builds/bld-4/betaBuildLocalizations?limit=50":
                return {"data": []}
            if method == "POST" and path == "/betaBuildLocalizations":
                return {"data": {"id": "loc-1"}}
            if method == "POST" and path == "/betaGroups/grp-ext/relationships/builds":
                return None
            if method == "GET" and path == "/builds/bld-4/betaAppReviewSubmission":
                return None
            if method == "POST" and path == "/betaAppReviewSubmissions":
                return {"data": {"id": "sub-1", "attributes": {"betaReviewState": "WAITING_FOR_REVIEW"}}}
            raise AssertionError(f"Unexpected call: {method} {path}")

        client = FakeAscClient(handler)
        now = [1000.0]

        def fake_sleep(sec: float) -> None:
            now[0] += sec

        result = dist_mod.distribute_external(
            client=client,
            bundle_id="com.kakumine.notefable",
            marketing_version="0.1.0",
            build_number="4",
            group_name="External",
            locale="en-US",
            whats_new="Added new chat feature.",
            poll_interval=5,
            poll_timeout=60,
            sleep_fn=fake_sleep,
            time_fn=lambda: now[0],
        )

        self.assertEqual(
            result,
            {
                "app_id": "app-1",
                "group_id": "grp-ext",
                "build_id": "bld-4",
                "review_state": "WAITING_FOR_REVIEW",
            },
        )
        self.assertEqual(poll_count, 2)
        post_locs = [c for c in client.calls if c[0] == "POST" and c[1] == "/betaBuildLocalizations"]
        self.assertEqual(len(post_locs), 1)
        self.assertEqual(post_locs[0][2]["data"]["attributes"]["whatsNew"], "Added new chat feature.")

    def test_updates_existing_localization_and_skips_if_already_approved(self) -> None:
        def handler(method: str, path: str, payload: Any, allow_404: bool) -> Any:
            if method == "GET" and path.startswith("/apps?"):
                return {"data": [{"id": "app-1", "attributes": {"bundleId": "com.kakumine.notefable"}}]}
            if method == "GET" and path == "/apps/app-1/betaGroups?limit=200":
                return {"data": [{"id": "grp-ext", "attributes": {"name": "External", "isInternalGroup": False}}]}
            if method == "GET" and path.startswith("/builds?"):
                return {"data": [{"id": "bld-5", "attributes": {"processingState": "VALID"}}]}
            if method == "GET" and path == "/builds/bld-5/betaBuildLocalizations?limit=50":
                return {"data": [{"id": "loc-en", "attributes": {"locale": "en-US"}}]}
            if method == "PATCH" and path == "/betaBuildLocalizations/loc-en":
                return {"data": {"id": "loc-en"}}
            if method == "POST" and path == "/betaGroups/grp-ext/relationships/builds":
                return None
            if method == "GET" and path == "/builds/bld-5/betaAppReviewSubmission":
                return {"data": {"id": "sub-5", "attributes": {"betaReviewState": "APPROVED"}}}
            raise AssertionError(f"Unexpected call: {method} {path}")

        client = FakeAscClient(handler)
        result = dist_mod.distribute_external(
            client=client,
            bundle_id="com.kakumine.notefable",
            marketing_version="0.1.0",
            build_number="5",
            group_name="External",
            locale="en-US",
            whats_new="Bug fixes.",
            sleep_fn=lambda _: None,
            time_fn=lambda: 0.0,
        )
        self.assertEqual(result["review_state"], "APPROVED")
        patch_calls = [c for c in client.calls if c[0] == "PATCH"]
        self.assertEqual(len(patch_calls), 1)
        post_reviews = [c for c in client.calls if c[0] == "POST" and c[1] == "/betaAppReviewSubmissions"]
        self.assertEqual(len(post_reviews), 0)

    def test_fails_when_build_processing_fails(self) -> None:
        def handler(method: str, path: str, payload: Any, allow_404: bool) -> Any:
            if method == "GET" and path.startswith("/apps?"):
                return {"data": [{"id": "app-1", "attributes": {"bundleId": "com.kakumine.notefable"}}]}
            if method == "GET" and path == "/apps/app-1/betaGroups?limit=200":
                return {"data": [{"id": "grp-ext", "attributes": {"name": "External", "isInternalGroup": False}}]}
            if method == "GET" and path.startswith("/builds?"):
                return {"data": [{"id": "bld-6", "attributes": {"processingState": "INVALID"}}]}
            raise AssertionError(f"Unexpected call: {method} {path}")

        client = FakeAscClient(handler)
        with self.assertRaises(dist_mod.AscError):
            dist_mod.distribute_external(
                client=client,
                bundle_id="com.kakumine.notefable",
                marketing_version="0.1.0",
                build_number="6",
                group_name="External",
                locale="en-US",
                whats_new="Bug fixes.",
                sleep_fn=lambda _: None,
                time_fn=lambda: 0.0,
            )

    def test_409_with_sibling_build_in_review_gives_actionable_error(self) -> None:
        def handler(method: str, path: str, payload: Any, allow_404: bool) -> Any:
            if method == "GET" and path.startswith("/apps?"):
                return {"data": [{"id": "app-1", "attributes": {"bundleId": "com.kakumine.notefable"}}]}
            if method == "GET" and path == "/apps/app-1/betaGroups?limit=200":
                return {"data": [{"id": "grp-ext", "attributes": {"name": "External", "isInternalGroup": False}}]}
            if method == "GET" and path.startswith("/builds?") and "include=betaAppReviewSubmission" in path:
                return {
                    "data": [
                        {
                            "id": "bld-3",
                            "attributes": {"version": "3"},
                            "relationships": {
                                "betaAppReviewSubmission": {"data": {"type": "betaAppReviewSubmissions", "id": "sub-3"}}
                            },
                        },
                        {"id": "bld-4", "attributes": {"version": "4"}},
                    ],
                    "included": [
                        {
                            "type": "betaAppReviewSubmissions",
                            "id": "sub-3",
                            "attributes": {"betaReviewState": "WAITING_FOR_REVIEW"},
                        }
                    ],
                }
            if method == "GET" and path.startswith("/builds?"):
                return {"data": [{"id": "bld-4", "attributes": {"processingState": "VALID"}}]}
            if method == "GET" and path == "/builds/bld-4/betaBuildLocalizations?limit=50":
                return {"data": []}
            if method == "POST" and path == "/betaBuildLocalizations":
                return {"data": {"id": "loc-4"}}
            if method == "POST" and path == "/betaGroups/grp-ext/relationships/builds":
                return None
            if method == "GET" and path == "/builds/bld-4/betaAppReviewSubmission":
                return None
            if method == "POST" and path == "/betaAppReviewSubmissions":
                raise dist_mod.AscError("HTTP 409: STATE_ERROR", status=409)
            raise AssertionError(f"Unexpected call: {method} {path}")

        client = FakeAscClient(handler)
        with self.assertRaises(dist_mod.AscError) as ctx:
            dist_mod.distribute_external(
                client=client,
                bundle_id="com.kakumine.notefable",
                marketing_version="0.1.0",
                build_number="4",
                group_name="External",
                locale="en-US",
                whats_new="Bug fixes.",
                sleep_fn=lambda _: None,
                time_fn=lambda: 0.0,
            )
        self.assertIn("0.1.0 (3)", str(ctx.exception))
        self.assertIn("WAITING_FOR_REVIEW", str(ctx.exception))
        self.assertIn("distribute_external", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
