#!/usr/bin/env python3
"""Unit tests for scripts/release/ios-store-listing.py. No network: App Store Connect is faked."""

from __future__ import annotations

import contextlib
import http.client
import importlib.util
import io
import itertools
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import urllib.parse
import zlib
from pathlib import Path
from typing import Any
from unittest import mock

_HERE = Path(__file__).resolve().parent
REPO_ROOT = _HERE.parents[1]
_SPEC = importlib.util.spec_from_file_location("ios_store_listing", _HERE / "ios-store-listing.py")
assert _SPEC and _SPEC.loader
listing_mod = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = listing_mod  # dataclasses look their module up here
_SPEC.loader.exec_module(listing_mod)

ListingError = listing_mod.ListingError
AscError = listing_mod.AscError
MEDIUM = "IPHONE_DYNAMIC_ISLAND_MEDIUM_PROFILE"
LARGE = "IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE"
IPAD = "IPAD_13_PROFILE"


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


def jpeg(width: int, height: int) -> bytes:
    app0 = b"\xff\xe0" + struct.pack(">H", 16) + b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    sof0 = b"\xff\xc0" + struct.pack(">HBHHB", 11, 8, height, width, 1) + b"\x01\x11\x00"
    return b"\xff\xd8" + app0 + sof0 + b"\xff\xd9"


def write_screenshots(root: Path, files: dict[str, bytes]) -> None:
    for name, data in files.items():
        path = root / listing_mod.SCREENSHOT_DIR / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)


def reference_data() -> dict:
    specs = {
        "s63": (1206, 2622),
        "s61": (1179, 2556),
        "s69": (1320, 2868),
        "ipad13": (2064, 2752),
        "ipad129": (2048, 2732),
    }
    groups = [
        (MEDIUM, "IPHONE_APP_STORE", "IPHONE_DYNAMIC_ISLAND_MEDIUM_DISPLAY", ["s63", "s61"]),
        (LARGE, "IPHONE_APP_STORE", "IPHONE_DYNAMIC_ISLAND_LARGE_DISPLAY", ["s69"]),
        (IPAD, "IPAD_APP_STORE", "IPAD_13_DISPLAY", ["ipad13", "ipad129"]),
        ("IPAD_129_PROFILE", "IPAD_APP_STORE", "IPAD_129_DISPLAY", ["ipad129"]),
        ("IMESSAGE_X_PROFILE", "IMESSAGE_APP_STORE", "IPHONE_DYNAMIC_ISLAND_MEDIUM_DISPLAY", ["s63"]),
    ]
    return {
        "placementProfileGroups": [
            {"placementProfileGroupId": g, "platform": platform, "displayClassId": display}
            for g, platform, display, _ in groups
        ],
        "imageSpecs": [
            {"specId": s, "dimensions": {"minWidth": w, "maxWidth": w, "minHeight": h, "maxHeight": h}}
            for s, (w, h) in specs.items()
        ],
        "placementTypes": [
            {
                "placementTypeId": "APP_SCREENSHOT",
                "specMappings": [{"placementGroupId": g, "specs": ids} for g, _, _, ids in groups],
            }
        ],
        "features": [
            {
                "featureId": "APP_STORE_VERSIONS",
                "placementPolicies": [
                    {
                        "placementType": "APP_SCREENSHOT",
                        "groupLimits": [{"groupIds": [g for g, *_ in groups], "maxCount": 10}],
                    }
                ],
            }
        ],
    }


def sample_listing() -> Any:
    entry = listing_mod.LocaleListing(
        name="NoteFable",
        subtitle="Notes",
        description="First line\n\n• Second line",
        keywords="study,notes",
        promotional_text="Try it",
    )
    return listing_mod.Listing(
        support_url="https://notefable.com",
        marketing_url="https://notefable.com",
        privacy_policy_url="https://notefable.com/privacy",
        primary_category="EDUCATION",
        secondary_category="PRODUCTIVITY",
        locales={"en-US": entry, "ja": entry, "es-MX": entry},
    )


class FakeAppStoreConnect:
    """The endpoints the listing script uses, kept in memory."""

    def __init__(
        self,
        version_state: str = "PREPARE_FOR_SUBMISSION",
        info_state: str = "PREPARE_FOR_SUBMISSION",
        adds_info_localization: bool = False,
    ) -> None:
        self.version_state = version_state
        self.info_state = info_state
        self.adds_info_localization = adds_info_localization
        self.reject_images = False
        self.fail: dict[tuple[str, str], AscError] = {}  # (method, path prefix) -> error
        self.calls: list[tuple[str, str, Any]] = []
        self.categories: dict[str, str | None] = {"primaryCategory": None, "secondaryCategory": None}
        self.info: dict[str, dict] = {}
        self.version: dict[str, dict] = {}
        self.images: dict[str, dict] = {}
        self.placements: dict[str, dict] = {}
        self.uploads: dict[str, bytes] = {}
        self._ids = itertools.count(1)

    def new_id(self, prefix: str) -> str:
        return f"{prefix}-{next(self._ids)}"

    def writes(self) -> list[tuple[str, str]]:
        return [(method, path) for method, path, _ in self.calls if method != "GET"]

    def upload(self, operation: dict, chunk: bytes) -> None:
        self.uploads[operation["url"]] = chunk

    def add_screenshot(self, localization_id: str, group: str, file_name: str) -> str:
        image_id = self.new_id("old-image")
        self.images[image_id] = {"fileName": file_name, "fileSize": 10, "state": "PREPARE_FOR_SUBMISSION"}
        placement_id = self.new_id("old-placement")
        self.placements[placement_id] = {"localization": localization_id, "group": group, "image": image_id}
        return placement_id

    def group_files(self, localization_id: str, group: str) -> list[str]:
        return [
            self.images[p["image"]]["fileName"]
            for p in self.placements.values()
            if p["localization"] == localization_id and p["group"] == group
        ]

    def localization_id(self, locale: str) -> str:
        return next(i for i, a in self.version.items() if a["locale"] == locale)

    def request(self, method: str, path_or_url: str, payload: Any = None, allow_404: bool = False) -> Any:
        self.calls.append((method, path_or_url, payload))
        for (fail_method, prefix), error in self.fail.items():
            locale = ((payload or {}).get("data") or {}) if isinstance(payload, dict) else {}
            target = f"{path_or_url} {(locale.get('attributes') or {}).get('locale', '')}"
            if method == fail_method and target.startswith(prefix):
                raise error
        url = urllib.parse.urlsplit(path_or_url)
        query = dict(urllib.parse.parse_qsl(url.query))
        parts = url.path.strip("/").split("/")
        data = (payload or {}).get("data") if payload else None
        handler = getattr(self, f"_{method.lower()}_{parts[0]}")
        return handler(parts[1:], query, data)

    @staticmethod
    def _resource(resource_id: str, attributes: dict) -> dict:
        return {"id": resource_id, "attributes": dict(attributes)}

    def _get_apps(self, parts, query, data):
        if not parts:
            return {"data": [self._resource("app-1", {"bundleId": "com.kakumine.notefable"})]}
        if parts == ["app-1"]:
            return {"data": self._resource("app-1", {"primaryLocale": "en-US"})}
        if parts[1] == "appStoreVersions":
            assert query["filter[platform]"] == "IOS"
            return {"data": [self._resource("ver-1", {"versionString": "1.0", "appVersionState": self.version_state})]}
        if parts[1] == "appInfos":
            relationships = {
                name: {"data": {"type": "appCategories", "id": value} if value else None}
                for name, value in self.categories.items()
            }
            return {"data": [{**self._resource("info-1", {"state": self.info_state}), "relationships": relationships}]}
        if parts[1] == "assetLibrary":
            return {"data": {"type": "appAssetLibraries", "id": "library-1"}}
        raise AssertionError(parts)

    def _get_appStoreVersions(self, parts, query, data):
        return {"data": [self._resource(i, a) for i, a in self.version.items()]}

    def _get_appInfos(self, parts, query, data):
        return {"data": [self._resource(i, a) for i, a in self.info.items()]}

    def _get_appAssetLibraryRefData(self, parts, query, data):
        assert query == {"filter[placementTypes]": "APP_SCREENSHOT"}
        return {"data": [self._resource("1", reference_data())]}

    def _get_appStoreVersionLocalizations(self, parts, query, data):
        localization_id, relationship = parts
        assert relationship == "placements"
        group = query.get("filter[placementGroup]")  # None: every group
        found = [
            (i, p)
            for i, p in self.placements.items()
            if p["localization"] == localization_id and group in (None, p["group"])
        ]
        return {
            "data": [
                {
                    "id": i,
                    "attributes": {"placementType": "APP_SCREENSHOT", "placementGroup": p["group"]},
                    "relationships": {"image": {"data": {"type": "appAssetLibraryImages", "id": p["image"]}}},
                }
                for i, p in found
            ],
            "included": [
                {"type": "appAssetLibraryImages", **self._resource(p["image"], self.images[p["image"]])}
                for _, p in found
            ],
        }

    def _get_appAssetLibraryImages(self, parts, query, data):
        return {"data": self._resource(parts[0], self.images[parts[0]])}

    def _post_appStoreVersionLocalizations(self, parts, query, data):
        new_id = self.new_id("vloc")
        self.version[new_id] = dict(data["attributes"])
        assert data["relationships"]["appStoreVersion"]["data"] == {"type": "appStoreVersions", "id": "ver-1"}
        locale = data["attributes"]["locale"]
        if self.adds_info_localization and not any(a["locale"] == locale for a in self.info.values()):
            self.info[self.new_id("iloc")] = {"locale": locale, "name": "Added by App Store Connect"}
        return {"data": self._resource(new_id, self.version[new_id])}

    def _post_appInfoLocalizations(self, parts, query, data):
        assert data["relationships"]["appInfo"]["data"] == {"type": "appInfos", "id": "info-1"}
        assert not any(a["locale"] == data["attributes"]["locale"] for a in self.info.values())
        new_id = self.new_id("iloc")
        self.info[new_id] = dict(data["attributes"])
        return {"data": self._resource(new_id, self.info[new_id])}

    def _patch_appStoreVersionLocalizations(self, parts, query, data):
        self.version[parts[0]].update(data["attributes"])

    def _patch_appInfoLocalizations(self, parts, query, data):
        self.info[parts[0]].update(data["attributes"])

    def _patch_appInfos(self, parts, query, data):
        for name, value in data["relationships"].items():
            self.categories[name] = value["data"]["id"]

    def _post_appAssetLibraryImages(self, parts, query, data):
        assert data["attributes"]["category"] == "APP_SCREENSHOTS_AND_PREVIEWS"
        assert data["relationships"]["assetLibrary"]["data"]["id"] == "library-1"
        name = data["attributes"]["referenceName"]
        assert len(name) <= 64
        # Unfinished and unplaced images keep their names too.
        if any(image.get("referenceName") == name for image in self.images.values()):
            raise AscError(
                f"HTTP 409: ENTITY_ERROR.ATTRIBUTE.INVALID.DUPLICATE: Reference name '{name}' is already in use",
                status=409,
            )
        image_id = self.new_id("image")
        size = data["attributes"]["fileSize"]
        self.images[image_id] = {**data["attributes"], "state": "AWAITING_UPLOAD"}
        half = size // 2
        operations = [
            {"method": "PUT", "url": f"https://upload.invalid/{image_id}/{n}", "offset": offset, "length": length}
            for n, (offset, length) in enumerate(((0, half), (half, size - half)))
        ]
        return {"data": self._resource(image_id, {**self.images[image_id], "uploadOperations": operations})}

    def _patch_appAssetLibraryImages(self, parts, query, data):
        image = self.images[parts[0]]
        assert data["attributes"] == {"uploaded": True}
        content = self.uploads[f"https://upload.invalid/{parts[0]}/0"] + self.uploads[f"https://upload.invalid/{parts[0]}/1"]
        assert len(content) == image["fileSize"]
        if self.reject_images:
            image.update(state="FAILED", stateDetails=[{"code": "X", "description": "wrong colour space"}])
            return
        width, height = listing_mod.image_size(content, ".png")
        spec = next(
            s["specId"]
            for s in reference_data()["imageSpecs"]
            if (s["dimensions"]["minWidth"], s["dimensions"]["minHeight"]) == (width, height)
        )
        image.update(state="PREPARE_FOR_SUBMISSION", specId=spec)

    def _post_appAssetLibraryPlacements(self, parts, query, data):
        assert data["attributes"]["placementType"] == "APP_SCREENSHOT"
        placement_id = self.new_id("placement")
        self.placements[placement_id] = {
            "localization": data["relationships"]["appStoreVersionLocalization"]["data"]["id"],
            "group": data["attributes"]["placementGroup"],
            "image": data["relationships"]["image"]["data"]["id"],
        }
        return {"data": {"id": placement_id}}

    def _delete_appAssetLibraryPlacements(self, parts, query, data):
        del self.placements[parts[0]]

    def _post_appAssetLibraryPlacementOrderingRequests(self, parts, query, data):
        ordered = [p["id"] for p in data["relationships"]["orderedPlacements"]["data"]]
        rest = {i: p for i, p in self.placements.items() if i not in ordered}
        self.placements = {**rest, **{i: self.placements[i] for i in ordered}}
        return {"data": {"id": "order-1"}}


# --- Documents ---------------------------------------------------------------------------------


def play_doc() -> str:
    lines = ["# Play listing", ""]
    for _, _, code in listing_mod.LANGUAGES:
        lines += [
            f"## Language {code} ({code})",
            "",
            f"**App name**: NoteFable {code[:2]}",
            "",
            "**Short description**: Notes and chat.",
            "",
            "**Full description**:",
            "",
            f"Intro {code}",
            "",
            "ASK",
            "• Ask anything.",
            "",
            "EVERYWHERE",
            f"• Sign in with Google to sync with notefable.com ({code}).",
            "• Dark mode.",
            "",
            f"Free. NoteFable Pro costs money ({code}). No ads.",
            "",
            "Privacy policy: https://notefable.com/privacy",
            "",
        ]
    return "\n".join(lines + ["## 其他字段", "", "| field | value |", ""])


def app_store_doc() -> str:
    lines = [
        "# App Store listing",
        "",
        "## 各语言共用的规则",
        "",
        "- **名称**：与 Play 的应用名相同。",
        "- **网址**：技术支持 https://notefable.com、营销 https://notefable.com、隐私政策 https://notefable.com/privacy。",
        "- **类别**：主要 教育（Education），次要 效率（Productivity）。",
        "",
    ]
    for _, heading, code in listing_mod.LANGUAGES:
        lines += [
            f"## {heading}",
            "",
            f"- **Subtitle**: Notes {code[:2]}",
            "- **Promotional text**: Ask AI anything.",
            "- **Keywords**: study,notebook",
            f"- **iOS 登录说明**: Sign in with Apple, or with Google to sync with notefable.com ({code}).",
            f"- **iOS 价格说明**: NoteFable Pro renews monthly ({code}). Terms of Use: https://notefable.com/terms",
            "",
        ]
    return "\n".join(lines)


class DocumentTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="store-listing-docs."))
        self.addCleanup(shutil.rmtree, self.root, True)

    def load(self, play: str | None = None, app_store: str | None = None):
        for relative, text in (
            (listing_mod.PLAY_STORE_DOC, play or play_doc()),
            (listing_mod.APP_STORE_DOC, app_store or app_store_doc()),
        ):
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8", newline="\r\n")
        return listing_mod.load_listing(self.root)

    def assert_rejected(self, message: str, play: str | None = None, app_store: str | None = None) -> None:
        with self.assertRaises(ListingError) as ctx:
            self.load(play, app_store)
        self.assertIn(message, str(ctx.exception))

    def test_composes_every_locale_and_shares_spanish(self) -> None:
        listing = self.load()
        self.assertEqual(len(listing.locales), 18)
        self.assertEqual(listing.locales["es-MX"], listing.locales["es-ES"])
        self.assertEqual(listing.primary_category, "EDUCATION")
        self.assertEqual(listing.secondary_category, "PRODUCTIVITY")
        self.assertEqual(listing.privacy_policy_url, "https://notefable.com/privacy")
        self.assertEqual(
            listing.locales["ja"].description,
            "Intro ja-JP\n\nASK\n• Ask anything.\n\nEVERYWHERE\n"
            "• Sign in with Apple, or with Google to sync with notefable.com (ja-JP).\n"
            "• Dark mode.\n\n"
            "NoteFable Pro renews monthly (ja-JP). Terms of Use: https://notefable.com/terms\n\n"
            "Privacy policy: https://notefable.com/privacy",
        )

    def test_rejects_missing_or_unknown_sections(self) -> None:
        self.assert_rejected("no section for de-DE", play=play_doc().replace("## Language de-DE (de-DE)", "## Old"))
        self.assert_rejected("no section for German", app_store=app_store_doc().replace("## German\n", "## German2\n"))
        self.assert_rejected("unknown section(s): Polish", app_store=app_store_doc() + "\n## Polish\n")
        self.assert_rejected("doesn't map", play=play_doc() + "\n## Polski (pl-PL)\n")
        self.assert_rejected(
            "needs 5 entries",
            app_store=app_store_doc().replace("- **Keywords**: study,notebook\n", "", 1),
        )

    def test_rejects_ambiguous_replacements(self) -> None:
        bullet = "• Sign in with Google to sync with notefable.com (en-US)."
        self.assert_rejected(
            "found 2", play=play_doc().replace("• Ask anything.", "• Ask at notefable.com.", 1)
        )
        self.assert_rejected(
            "found 0", play=play_doc().replace("notefable.com (en-US)", "the web (en-US)")
        )
        self.assert_rejected(
            "not the sync section's first bullet",
            play=play_doc().replace(f"{bullet}\n• Dark mode.", f"• Dark mode.\n{bullet}"),
        )
        self.assert_rejected(
            "NoteFable Pro paragraph", play=play_doc().replace("Free. NoteFable Pro costs", "Free. Pro costs", 1)
        )
        self.assert_rejected(
            "NoteFable Pro paragraph",
            play=play_doc().replace("• Ask anything.", "• NoteFable Pro answers more.", 1),
        )
        swapped = app_store_doc().replace("Sign in with Apple, or", "NoteFable Pro, or", 1)
        self.assert_rejected("not the iOS sign-in note", app_store=swapped)

    def test_enforces_every_limit(self) -> None:
        cases = {
            "name is 31 characters": {"play": play_doc().replace("NoteFable en", "N" * 31, 1)},
            "subtitle is 31 characters": {"app_store": app_store_doc().replace("Notes en", "s" * 31, 1)},
            "promotional text is 171": {"app_store": app_store_doc().replace("Ask AI anything.", "p" * 171, 1)},
            # 34 CJK characters are only 34 characters but 102 bytes.
            "keywords are 104 UTF-8 bytes": {
                "app_store": app_store_doc().replace("study,notebook", "字" * 34 + ",a", 1)
            },
            "separated by ','": {"app_store": app_store_doc().replace("study,notebook", "study, notebook", 1)},
            "description is": {"play": play_doc().replace("Intro en-US", "x" * 4000, 1)},
        }
        for message, documents in cases.items():
            with self.subTest(message):
                self.assert_rejected(message, **documents)

    def test_requires_the_shared_rules(self) -> None:
        self.assert_rejected(
            "URL after 营销", app_store=app_store_doc().replace("营销 https://notefable.com、", "")
        )
        self.assert_rejected(
            "not an App Store category", app_store=app_store_doc().replace("（Education）", "（Learning）")
        )


class RepositoryDocumentTests(unittest.TestCase):
    def test_repository_documents_make_a_valid_listing(self) -> None:
        listing = listing_mod.load_listing(REPO_ROOT)
        self.assertEqual(
            sorted(listing.locales), sorted(loc for locales, _, _ in listing_mod.LANGUAGES for loc in locales)
        )
        play_text = (REPO_ROOT / listing_mod.PLAY_STORE_DOC).read_text(encoding="utf-8")
        play = listing_mod.parse_play_listing(play_text)
        for locales, heading, code in listing_mod.LANGUAGES:
            with self.subTest(heading):
                name, original = play[code]
                entry = listing.locales[locales[0]]
                self.assertEqual(entry.name, name)
                before, after = original.split("\n"), entry.description.split("\n")
                self.assertEqual(len(before), len(after))
                changed = [new for old, new in zip(before, after) if old != new]
                self.assertEqual(len(changed), 2)
                self.assertTrue(changed[0].startswith("• ") and "Apple" in changed[0])
                self.assertIn("https://notefable.com/terms", changed[1])
                self.assertIn(listing.privacy_policy_url, after[-1])

    def test_check_mode_needs_no_credentials_or_network(self) -> None:
        with mock.patch("urllib.request.urlopen", side_effect=AssertionError("no network")):
            with contextlib.redirect_stdout(io.StringIO()) as out:
                self.assertEqual(listing_mod.main(["--check"]), 0)
        self.assertIn("18 App Store locales", out.getvalue())

    def test_dry_run_without_credentials_fails_before_any_request(self) -> None:
        environment = {k: v for k, v in os.environ.items() if not k.startswith("APPSTORE_API_")}
        with mock.patch.dict(os.environ, environment, clear=True):
            with mock.patch("urllib.request.urlopen", side_effect=AssertionError("no network")):
                with contextlib.redirect_stderr(io.StringIO()) as err:
                    self.assertEqual(listing_mod.main([]), 1)
        self.assertIn("APPSTORE_API_KEY_ID", err.getvalue())


# --- Screenshot files --------------------------------------------------------------------------


class ScreenshotFileTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="store-listing-shots."))
        self.addCleanup(shutil.rmtree, self.root, True)

    def test_missing_folder_means_no_screenshots(self) -> None:
        self.assertIsNone(listing_mod.load_screenshots(self.root))

    def test_reads_png_and_jpeg_in_file_name_order(self) -> None:
        write_screenshots(
            self.root,
            {
                "iphone/02-b.png": png(1206, 2622),
                "iphone/01-a.jpg": jpeg(1320, 2868),
                "iphone/.DS_Store": b"junk",
                "ipad/01-c.png": png(2064, 2752),
                "README.md": b"notes",
            },
        )
        shots = listing_mod.load_screenshots(self.root)
        self.assertEqual(
            [s.label for s in shots],
            ["iphone/01-a.jpg 1320x2868", "iphone/02-b.png 1206x2622", "ipad/01-c.png 2064x2752"],
        )

    def test_rejects_transparency_and_misplaced_files(self) -> None:
        write_screenshots(
            self.root,
            {
                "iphone/rgba.png": png(1206, 2622, color_type=6),
                "iphone/trns.png": png(1206, 2622, trns=True),
                "iphone/photo.heic": b"x",
                "ipad/broken.jpg": b"not a jpeg",
                "stray.png": png(1206, 2622),
                "iPhone14/a.png": png(1206, 2622),
            },
        )
        with self.assertRaises(ListingError) as ctx:
            listing_mod.load_screenshots(self.root)
        message = str(ctx.exception)
        for expected in ("rgba.png: has transparency", "trns.png: has transparency", "photo.heic: only PNG"):
            self.assertIn(expected, message)
        for expected in ("broken.jpg: not a JPEG", "stray.png: move it", "iPhone14/: only iphone/"):
            self.assertIn(expected, message)

    def test_groups_by_apples_reference_data(self) -> None:
        write_screenshots(
            self.root,
            {
                "iphone/1.png": png(1320, 2868),
                "iphone/2.png": png(1179, 2556),
                "iphone/3.png": png(1206, 2622),
                "ipad/1.png": png(2048, 2732),
            },
        )
        groups = listing_mod.group_screenshots(reference_data(), listing_mod.load_screenshots(self.root))
        self.assertEqual(
            [(g.group_id, [s.path.name for s in g.shots]) for g in groups],
            [(MEDIUM, ["2.png", "3.png"]), (LARGE, ["1.png"]), (IPAD, ["1.png"])],
        )

    def test_rejects_unaccepted_sizes_and_too_many(self) -> None:
        write_screenshots(self.root, {"ipad/phone.png": png(1206, 2622)})
        with self.assertRaises(ListingError) as ctx:
            listing_mod.group_screenshots(reference_data(), listing_mod.load_screenshots(self.root))
        self.assertIn("is not an accepted size", str(ctx.exception))
        self.assertIn("2064x2752", str(ctx.exception))

        shutil.rmtree(self.root / listing_mod.SCREENSHOT_DIR)
        files = {f"iphone/{n:02}.png": png(1206, 2622, str(n)) for n in range(6)}
        files |= {f"iphone/{n:02}.png": png(1179, 2556, str(n)) for n in range(6, 11)}
        write_screenshots(self.root, files)
        with self.assertRaises(ListingError) as ctx:
            listing_mod.group_screenshots(reference_data(), listing_mod.load_screenshots(self.root))
        self.assertIn("11 screenshots", str(ctx.exception))

    def test_leaves_out_groups_that_app_store_versions_do_not_use(self) -> None:
        write_screenshots(self.root, {"iphone/1.png": png(1206, 2622)})
        shots = listing_mod.load_screenshots(self.root)
        reference = reference_data()
        # The same platform, display class and size, listed for another feature only.
        other = "CUSTOM_PAGE_PROFILE"
        reference["placementProfileGroups"].append(
            {
                "placementProfileGroupId": other,
                "platform": "IPHONE_APP_STORE",
                "displayClassId": "IPHONE_DYNAMIC_ISLAND_MEDIUM_DISPLAY",
            }
        )
        reference["placementTypes"][0]["specMappings"].append({"placementGroupId": other, "specs": ["s63"]})
        policy = {"placementType": "APP_SCREENSHOT", "groupLimits": [{"groupIds": [other], "maxCount": 10}]}
        reference["features"].append({"featureId": "APP_CUSTOM_PRODUCT_PAGES", "placementPolicies": [policy]})
        self.assertEqual([g.group_id for g in listing_mod.group_screenshots(reference, shots)], [MEDIUM])

        # A size that only such a group takes is refused.
        reference["features"][0]["placementPolicies"][0]["groupLimits"][0]["groupIds"].remove(MEDIUM)
        with self.assertRaises(ListingError) as ctx:
            listing_mod.group_screenshots(reference, shots)
        self.assertIn("is not an accepted size", str(ctx.exception))


# --- Syncing -----------------------------------------------------------------------------------


class SyncTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="store-listing-sync."))
        self.addCleanup(shutil.rmtree, self.root, True)
        self.output: list[str] = []

    def shots(self, files: dict[str, bytes] | None = None):
        write_screenshots(
            self.root,
            files
            or {
                "iphone/01-chat.png": png(1206, 2622, "1"),
                "iphone/02-notes.png": png(1206, 2622, "2"),
                "ipad/01-chat.png": png(2064, 2752, "3"),
            },
        )
        return listing_mod.load_screenshots(self.root)

    def sync(self, fake: FakeAppStoreConnect, shots=None, apply: bool = False) -> bool:
        self.output.clear()
        return listing_mod.sync(
            fake,
            sample_listing(),
            shots,
            apply,
            out=self.output.append,
            uploader=fake.upload,
            sleep_fn=lambda _: None,
            time_fn=lambda: 0.0,
        )

    def text(self) -> str:
        return "\n".join(self.output)

    def test_dry_run_only_reads_and_shows_current_and_new(self) -> None:
        fake = FakeAppStoreConnect()
        fake.version["v-en"] = {"locale": "en-US", "description": "Old text", "keywords": "study,notes"}
        fake.info["i-en"] = {"locale": "en-US", "name": "NoteFable", "subtitle": "Old subtitle"}
        fake.add_screenshot("v-en", MEDIUM, "old.png")
        self.assertTrue(self.sync(fake, self.shots()))
        self.assertEqual(fake.writes(), [])
        text = self.text()
        for expected in (
            "primaryCategory: CHANGE",
            "name: unchanged: NoteFable",
            "subtitle: CHANGE\n    current: Old subtitle\n    new: Notes",
            "description: CHANGE\n    current: Old text\n    new:\n      | First line\n      | \n      | • Second line",
            "keywords: unchanged: study,notes",
            "(appStoreVersionLocalizations: not on App Store Connect yet, will be created)",
            f"{MEDIUM}: replace 1 current with 2 new\n    current 1: old.png (10 bytes)",
            f"{IPAD}: replace 0 current with 1 new",
            "Dry run: nothing was changed.",
        ):
            self.assertIn(expected, text)

    def test_dry_run_without_screenshots_says_so_and_skips_the_asset_library(self) -> None:
        fake = FakeAppStoreConnect()
        self.assertTrue(self.sync(fake, None))
        self.assertIn("screenshots are skipped", self.text())
        self.assertFalse(any("assetLibrary" in path or "RefData" in path for _, path, _ in fake.calls))

    def test_apply_writes_everything_and_a_second_run_changes_nothing(self) -> None:
        fake = FakeAppStoreConnect()
        shots = self.shots()
        self.assertTrue(self.sync(fake, shots, apply=True), self.text())
        listing = sample_listing()
        for store, attributes in ((fake.version, listing.version_attributes), (fake.info, listing.info_attributes)):
            self.assertEqual(
                {a["locale"]: a for a in store.values()},
                {loc: {"locale": loc, **attributes(loc)} for loc in listing.locales},
            )
        self.assertEqual(fake.categories, {"primaryCategory": "EDUCATION", "secondaryCategory": "PRODUCTIVITY"})
        en = fake.localization_id("en-US")
        self.assertEqual(fake.group_files(en, MEDIUM), ["01-chat.png", "02-notes.png"])
        self.assertEqual(fake.group_files(en, IPAD), ["01-chat.png"])
        self.assertEqual(
            sorted(len(image) for image in fake.uploads.values() if image), sorted(
                n for s in shots for n in (s.size // 2, s.size - s.size // 2)
            )
        )
        # Only the medium group has two screenshots, so only it needs an ordering request.
        self.assertEqual(
            [p for m, p in fake.writes() if p == "/appAssetLibraryPlacementOrderingRequests"],
            ["/appAssetLibraryPlacementOrderingRequests"],
        )
        self.assertFalse(any(m == "DELETE" for m, _ in fake.writes()))

        fake.calls.clear()
        self.assertTrue(self.sync(fake, shots, apply=True), self.text())
        self.assertEqual(fake.writes(), [])
        self.assertIn(
            "Summary: 0 field changes, 0 localizations to create, 0 category changes, "
            "0 screenshot groups to replace.",
            self.text(),
        )

    def test_apply_patches_only_the_fields_that_differ(self) -> None:
        listing = sample_listing()
        fake = FakeAppStoreConnect()
        fake.categories = {"primaryCategory": "EDUCATION", "secondaryCategory": "UTILITIES"}
        for n, locale in enumerate(listing.locales):
            fake.version[f"v{n}"] = {"locale": locale, **listing.version_attributes(locale)}
            fake.info[f"i{n}"] = {"locale": locale, **listing.info_attributes(locale)}
        fake.version["v0"]["keywords"] = "old,words"
        fake.info["i1"]["subtitle"] = None
        self.assertTrue(self.sync(fake, apply=True), self.text())
        patches = {path: payload["data"] for method, path, payload in fake.calls if method == "PATCH"}
        self.assertEqual(
            sorted(patches), ["/appInfoLocalizations/i1", "/appInfos/info-1", "/appStoreVersionLocalizations/v0"]
        )
        self.assertEqual(patches["/appStoreVersionLocalizations/v0"]["attributes"], {"keywords": "study,notes"})
        self.assertEqual(patches["/appInfoLocalizations/i1"]["attributes"], {"subtitle": "Notes"})
        self.assertEqual(list(patches["/appInfos/info-1"]["relationships"]), ["secondaryCategory"])
        self.assertFalse(any(method == "POST" for method, _ in fake.writes()))

    def test_replacing_deletes_only_the_groups_with_new_files(self) -> None:
        fake = FakeAppStoreConnect()
        fake.version["v-en"] = {"locale": "en-US"}
        old = [fake.add_screenshot("v-en", MEDIUM, f"old{n}.png") for n in range(2)]
        large = fake.add_screenshot("v-en", LARGE, "large.png")
        other_locale = fake.add_screenshot("v-ja", MEDIUM, "ja.png")
        shots = self.shots({"iphone/new.png": png(1206, 2622)})
        self.assertTrue(self.sync(fake, shots, apply=True), self.text())
        self.assertEqual(
            sorted(path for method, path in fake.writes() if method == "DELETE"),
            sorted(f"/appAssetLibraryPlacements/{placement}" for placement in old),
        )
        self.assertIn(large, fake.placements)
        self.assertIn(other_locale, fake.placements)
        self.assertEqual(fake.group_files("v-en", MEDIUM), ["new.png"])
        # Every new image was processed before the first old screenshot was removed.
        methods = [(method, path.split("/")[1]) for method, path, _ in fake.calls]
        self.assertLess(
            methods.index(("PATCH", "appAssetLibraryImages")), methods.index(("DELETE", "appAssetLibraryPlacements"))
        )

    def test_warns_about_groups_that_show_screenshots_without_local_files(self) -> None:
        fake = FakeAppStoreConnect()
        fake.version["v-en"] = {"locale": "en-US"}
        large = [fake.add_screenshot("v-en", LARGE, f"large{n}.png") for n in range(2)]
        fake.add_screenshot("v-en", MEDIUM, "old.png")
        fake.add_screenshot("v-ja", IPAD, "ja.png")  # only the en-US screenshots are this script's
        shots = self.shots({"iphone/new.png": png(1206, 2622)})

        def left_over() -> list[str]:
            return [line.split()[0] for line in self.output if "left unchanged" in line and "screenshot(s)" in line]

        self.assertTrue(self.sync(fake, shots))
        self.assertEqual(left_over(), [f"::warning::{LARGE}:"])
        self.assertIn(f"{LARGE}: 2 en-US screenshot(s)", self.text())
        # Without any local file nothing is replaced, so every group is left over.
        self.assertTrue(self.sync(fake, None))
        self.assertEqual(left_over(), [f"::warning::{LARGE}:", f"::warning::{MEDIUM}:"])

        self.assertTrue(self.sync(fake, shots, apply=True), self.text())
        self.assertTrue(set(large) <= set(fake.placements))

    def test_says_when_screenshots_are_skipped_without_an_english_version_page(self) -> None:
        fake = FakeAppStoreConnect()
        fake.fail[("POST", "/appStoreVersionLocalizations en-US")] = AscError("HTTP 500", status=500)
        self.assertFalse(self.sync(fake, self.shots(), apply=True))
        self.assertIn("::error::screenshots: not uploaded, there is no en-US version localization", self.output)
        self.assertFalse(any("appAssetLibrary" in path for _, path in fake.writes()))

    def test_a_changed_set_uploads_its_unchanged_files_under_new_names(self) -> None:
        fake = FakeAppStoreConnect()
        long_name = "iphone/01-a-file-name-longer-than-the-reference-name-keeps.png"
        self.assertTrue(self.sync(fake, self.shots({long_name: png(1206, 2622, "1")}), apply=True), self.text())
        shots = self.shots({"iphone/02-added.png": png(1206, 2622, "2")})
        self.assertTrue(self.sync(fake, shots, apply=True), self.text())
        self.assertEqual(fake.group_files(fake.localization_id("en-US"), MEDIUM), [s.path.name for s in shots])
        self.assertEqual(len(fake.images), 3)  # the first upload stays in the library

        fake.calls.clear()
        self.assertTrue(self.sync(fake, shots, apply=True), self.text())
        self.assertEqual(fake.writes(), [])

    def test_running_again_finishes_a_replacement_that_stopped_half_way(self) -> None:
        def broken_upload(operation: dict, chunk: bytes) -> None:
            raise AscError("Screenshot upload failed: timed out")

        def break_upload(fake: FakeAppStoreConnect) -> None:
            fake.upload = broken_upload

        def reject_image(fake: FakeAppStoreConnect) -> None:
            fake.reject_images = True

        def break_placement(fake: FakeAppStoreConnect) -> None:
            fake.fail[("POST", "/appAssetLibraryPlacements")] = AscError("Network error: timed out")

        for break_it in (break_upload, reject_image, break_placement):
            with self.subTest(break_it.__name__):
                fake = FakeAppStoreConnect()
                fake.version["v-en"] = {"locale": "en-US"}
                fake.add_screenshot("v-en", MEDIUM, "old.png")
                shots = self.shots({"iphone/new.png": png(1206, 2622)})
                break_it(fake)
                self.assertFalse(self.sync(fake, shots, apply=True))
                # The images are untouched until every new one is processed.
                left = [] if break_it is break_placement else ["old.png"]
                self.assertEqual(fake.group_files("v-en", MEDIUM), left)

                vars(fake).pop("upload", None)
                fake.reject_images = False
                fake.fail.clear()
                self.assertTrue(self.sync(fake, shots, apply=True), self.text())
                self.assertEqual(fake.group_files("v-en", MEDIUM), ["new.png"])

    def test_a_rejected_image_leaves_the_current_screenshots(self) -> None:
        fake = FakeAppStoreConnect()
        fake.version["v-en"] = {"locale": "en-US"}
        old = fake.add_screenshot("v-en", MEDIUM, "old.png")
        fake.reject_images = True
        self.assertFalse(self.sync(fake, self.shots({"iphone/new.png": png(1206, 2622)}), apply=True))
        self.assertIn("wrong colour space", self.text())
        self.assertIn(old, fake.placements)
        self.assertFalse(any(method == "DELETE" for method, _ in fake.writes()))

    def test_stops_without_an_editable_version_or_app_info(self) -> None:
        for fake, what in (
            (FakeAppStoreConnect(version_state="READY_FOR_DISTRIBUTION"), "iOS version"),
            (FakeAppStoreConnect(version_state="WAITING_FOR_REVIEW"), "iOS version"),
            (FakeAppStoreConnect(info_state="READY_FOR_DISTRIBUTION"), "app info"),
        ):
            with self.subTest(what=what, version=fake.version_state):
                with self.assertRaises(AscError) as ctx:
                    self.sync(fake, apply=True)
                self.assertIn(f"exactly one editable {what}", str(ctx.exception))
                self.assertEqual(fake.writes(), [])

    def test_localizations_added_by_app_store_connect_are_updated(self) -> None:
        fake = FakeAppStoreConnect(adds_info_localization=True)
        self.assertTrue(self.sync(fake, apply=True), self.text())
        self.assertFalse(any(path == "/appInfoLocalizations" for method, path in fake.writes() if method == "POST"))
        self.assertEqual({a["name"] for a in fake.info.values()}, {"NoteFable"})

    def test_one_refused_locale_does_not_stop_the_others(self) -> None:
        fake = FakeAppStoreConnect()
        fake.fail[("POST", "/appInfoLocalizations ja")] = AscError("HTTP 409: name already used", status=409)
        self.assertFalse(self.sync(fake, apply=True))
        self.assertIn("ja name and subtitle: HTTP 409: name already used", self.text())
        self.assertEqual(sorted(a["locale"] for a in fake.info.values()), ["en-US", "es-MX"])

    def test_a_key_without_permission_aborts_at_once(self) -> None:
        fake = FakeAppStoreConnect()
        fake.fail[("PATCH", "/appInfos/")] = AscError("HTTP 403: FORBIDDEN", status=403)
        with self.assertRaises(AscError):
            self.sync(fake, apply=True)
        self.assertEqual(fake.writes(), [("PATCH", "/appInfos/info-1")])


class GuardTests(unittest.TestCase):
    def test_refuses_everything_outside_the_listing(self) -> None:
        sent: list[str] = []
        inner = mock.Mock()
        inner.request.side_effect = lambda method, path, **_: sent.append(f"{method} {path}")
        guard = listing_mod.GuardedClient(inner, allow_writes=True)
        for method, path in (
            ("POST", "/reviewSubmissions"),
            ("POST", "/appStoreVersions"),
            ("PATCH", "/appStoreVersions/1"),
            ("POST", "/appPriceSchedules"),
            ("PATCH", "/ageRatingDeclarations/1"),
            ("DELETE", "/appStoreVersionLocalizations/1"),
            ("DELETE", "/appInfoLocalizations/1"),
            ("DELETE", "/appAssetLibraryImages/1"),
            ("PATCH", "/builds/1"),
            ("PATCH", "/appInfos/1/relationships/ageRatingDeclaration"),
        ):
            with self.subTest(method=method, path=path), self.assertRaises(AscError):
                guard.request(method, path)
        with self.assertRaises(AscError):
            guard.request(
                "PATCH", "/appInfos/1", payload={"data": {"relationships": {"ageRatingDeclaration": {}}}}
            )
        self.assertEqual(sent, [])
        guard.request("PATCH", "/appInfos/1", payload={"data": {"relationships": {"primaryCategory": {}}}})
        guard.request("DELETE", "/appAssetLibraryPlacements/1")
        self.assertEqual(sent, ["PATCH /appInfos/1", "DELETE /appAssetLibraryPlacements/1"])

    def test_a_dry_run_may_only_read(self) -> None:
        inner = mock.Mock()
        guard = listing_mod.GuardedClient(inner, allow_writes=False)
        guard.request("GET", "/apps")
        for method, path in (("POST", "/appInfoLocalizations"), ("DELETE", "/appAssetLibraryPlacements/1")):
            with self.assertRaises(AscError):
                guard.request(method, path)
        self.assertEqual(inner.request.call_count, 1)

    def test_refuses_to_replace_placements_outside_the_group(self) -> None:
        client = mock.Mock()
        client.request.return_value = {
            "data": [{"id": "p", "attributes": {"placementType": "APP_SCREENSHOT", "placementGroup": LARGE}}]
        }
        with self.assertRaises(AscError):
            listing_mod.current_screenshots(client, "loc", MEDIUM)


def workflow_runs_for(workflow: str, changed: str) -> bool:
    """GitHub's `paths` filter for one changed file: the last pattern that matches it decides."""
    text = (REPO_ROOT / ".github/workflows" / workflow).read_text(encoding="utf-8")
    block = re.search(r"(?m)^    paths:\n((?:      .*\n)+)", text).group(1)
    runs = False
    for negated, pattern in re.findall(r'(?m)^      - "(!?)([^"]+)"$', block):
        if re.fullmatch(re.escape(pattern).replace(r"\*\*", ".*").replace(r"\*", "[^/]*"), changed):
            runs = not negated
    return runs


class RepositorySetupTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("git") and (REPO_ROOT / ".git").exists(), "not a git checkout")
    def test_git_ignores_the_bytecode_cache_these_scripts_leave(self) -> None:
        # Without the user's own ignore file, so that only the repository's rules count.
        command = ["git", "-C", str(REPO_ROOT), "-c", "core.excludesFile=", "check-ignore", "--no-index", "-q"]
        self.assertEqual(subprocess.run([*command, "scripts/release/__pycache__/x.pyc"]).returncode, 0)

    def test_a_screenshot_change_runs_the_listing_check_and_not_the_ios_builds(self) -> None:
        shot = f"{listing_mod.SCREENSHOT_DIR}/iphone/01-chat.png"
        self.assertTrue(workflow_runs_for("store-listing-pr.yml", shot))
        self.assertFalse(workflow_runs_for("ios-pr.yml", shot))
        # The rest of mobile/ios still builds, whatever sits next to the screenshots included.
        for other in ("mobile/ios/project.yml", "mobile/ios/app-store/frame.html"):
            self.assertTrue(workflow_runs_for("ios-pr.yml", other), other)


class UploadTests(unittest.TestCase):
    def test_sends_the_part_without_the_api_token(self) -> None:
        operation = {
            "method": "PUT",
            "url": "https://upload.invalid/part",
            "requestHeaders": [{"name": "Content-Type", "value": "image/png"}],
        }
        with mock.patch("urllib.request.urlopen") as urlopen:
            listing_mod.upload_part(operation, b"bytes")
        request = urlopen.call_args.args[0]
        self.assertEqual((request.get_method(), request.full_url, request.data), ("PUT", operation["url"], b"bytes"))
        self.assertEqual(request.headers, {"Content-type": "image/png"})

    def test_retries_dropped_connections_and_refuses_http(self) -> None:
        for error in (ConnectionResetError("reset"), http.client.BadStatusLine("garbage")):
            with mock.patch("urllib.request.urlopen", side_effect=error) as urlopen:
                with self.assertRaises(AscError):
                    listing_mod.upload_part({"url": "https://upload.invalid/x"}, b"", sleep_fn=lambda _: None)
            self.assertEqual(urlopen.call_count, 3)
        with self.assertRaises(AscError):
            listing_mod.upload_part({"url": "http://upload.invalid/x"}, b"")

    def test_waiting_for_processing_times_out(self) -> None:
        client = mock.Mock()
        client.request.return_value = {"data": {"id": "i", "attributes": {"state": "UPLOAD_COMPLETE"}}}
        clock = itertools.count(0, 400)
        with self.assertRaises(AscError) as ctx:
            listing_mod.wait_for_image(client, "i", "shot", sleep_fn=lambda _: None, time_fn=lambda: next(clock))
        self.assertIn("Timed out", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
