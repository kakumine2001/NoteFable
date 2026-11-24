#!/usr/bin/env python3
"""Unit tests for scripts/release/ios-testflight-distribute.py."""

from __future__ import annotations

import base64
import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from typing import Any

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
