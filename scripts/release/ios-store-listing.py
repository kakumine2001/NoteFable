#!/usr/bin/env python3
"""Write the repository's App Store listing and submission information to App Store Connect.

Sources of truth:
  docs/app-store/listing.md    subtitle, promotional text, keywords, URLs, categories and the two
                               iOS-only passages of every language
  docs/play-store/listing.md   app name and full description; the App Store description is the Play
                               one with the sync bullet and the price paragraph replaced
  mobile/ios/app-store/screenshots/{iphone,ipad}/
                               en-US screenshots, in file-name order (optional)
  docs/app-store/review-info.md
                               age rating answers, App Review notes, copyright, subscription texts and
                               TestFlight beta app description (handled by ios-store-review.py)

Modes:
  --check    parse and validate the documents and screenshot files; no network, no credentials
  (default)  dry run: only reads App Store Connect and prints current vs new values
  --apply    make the changes

Writes name, subtitle, privacy policy URL, description, keywords, promotional text, support and
marketing URL, primary and secondary category, en-US screenshots (App Asset Library), the age rating
answers, the App Review notes, the copyright, the display names and descriptions of the existing
subscription group and monthly product (creating a draft metadata version when there is none, or
when changed texts meet only versions whose review is over) and the TestFlight beta app
description (only while none is set). Every run ends with a read-only audit of what a submission
still misses. It never submits anything for review, never touches pricing, availability, the content
rights declaration, app privacy or builds, never creates a product, subscription group, App Store
version or app info, never writes a contact or credential, and deletes nothing except the screenshot
placements of the placement groups it replaces (the images stay in the asset library).

Python standard library only. JWT signing, API requests and credential handling come from
ios-testflight-distribute.py (which signs with the openssl CLI).
"""

from __future__ import annotations

import argparse
import hashlib
import http.client
import importlib.util
import re
import secrets
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

_REVIEW_SPEC = importlib.util.spec_from_file_location(
    "ios_store_review", Path(__file__).resolve().with_name("ios-store-review.py")
)
review_mod = importlib.util.module_from_spec(_REVIEW_SPEC)
sys.modules[_REVIEW_SPEC.name] = review_mod  # dataclasses look their module up here
_REVIEW_SPEC.loader.exec_module(review_mod)
dist = review_mod.dist
AscError = review_mod.AscError
ListingError = review_mod.ListingError
WriteRefused = review_mod.WriteRefused
_read_text = review_mod.read_text
_sections = review_mod.sections
_get_all = review_mod.get_all
_attributes = review_mod.attributes
_normalized = review_mod.normalized

BUNDLE_ID = "com.kakumine.notefable"
APP_STORE_DOC = "docs/app-store/listing.md"
PLAY_STORE_DOC = "docs/play-store/listing.md"
SCREENSHOT_DIR = "mobile/ios/app-store/screenshots"

# (App Store Connect locales, section in APP_STORE_DOC, code in the PLAY_STORE_DOC headings)
LANGUAGES = (
    (("en-US",), "English (U.S.)", "en-US"),
    (("zh-Hans",), "Chinese (Simplified)", "zh-CN"),
    (("zh-Hant",), "Chinese (Traditional)", "zh-TW"),
    (("ja",), "Japanese", "ja-JP"),
    (("ko",), "Korean", "ko-KR"),
    (("es-MX", "es-ES"), "Spanish (Mexico) / Spanish (Spain)", "es-419, es-ES"),
    (("fr-FR",), "French", "fr-FR"),
    (("de-DE",), "German", "de-DE"),
    (("pt-BR",), "Portuguese (Brazil)", "pt-BR"),
    (("it",), "Italian", "it-IT"),
    (("id",), "Indonesian", "id"),
    (("vi",), "Vietnamese", "vi"),
    (("th",), "Thai", "th"),
    (("hi",), "Hindi", "hi-IN"),
    (("ar-SA",), "Arabic", "ar"),
    (("tr",), "Turkish", "tr-TR"),
    (("ru",), "Russian", "ru-RU"),
)
RULES_SECTION = "各语言共用的规则"
PRIMARY_LOCALE = "en-US"  # screenshots go here; the other languages show the primary ones

NAME_MIN, NAME_MAX = 2, 30
SUBTITLE_MAX = 30
PROMOTIONAL_TEXT_MAX = 170
KEYWORDS_MAX_BYTES = 100
DESCRIPTION_MAX = 4000

CATEGORY_IDS = frozenset(
    "BOOKS BUSINESS DEVELOPER_TOOLS EDUCATION ENTERTAINMENT FINANCE FOOD_AND_DRINK GAMES "
    "GRAPHICS_AND_DESIGN HEALTH_AND_FITNESS LIFESTYLE MAGAZINES_AND_NEWSPAPERS MEDICAL MUSIC "
    "NAVIGATION NEWS PHOTO_AND_VIDEO PRODUCTIVITY REFERENCE SHOPPING SOCIAL_NETWORKING SPORTS "
    "STICKERS TRAVEL UTILITIES WEATHER".split()
)

# The states in which Apple allows editing the whole listing, screenshots included. A version or
# app info that is waiting for review, in review or released is left alone.
EDITABLE_VERSION_STATES = frozenset(
    {"PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY"}
)
EDITABLE_APP_INFO_STATES = frozenset({"PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED"})

# Screenshot folder -> (placement platform, display classes it may fill). Placement group ids and
# accepted pixel sizes come from appAssetLibraryRefData at run time.
SCREENSHOT_FOLDERS = {
    "iphone": (
        "IPHONE_APP_STORE",
        ("IPHONE_DYNAMIC_ISLAND_MEDIUM_DISPLAY", "IPHONE_DYNAMIC_ISLAND_LARGE_DISPLAY", "IPHONE_DUO"),
    ),
    "ipad": ("IPAD_APP_STORE", ("IPAD_13_DISPLAY",)),
}
REQUIRED_DISPLAY_CLASSES = {
    "IPHONE_DYNAMIC_ISLAND_MEDIUM_DISPLAY": "iPhone medium Dynamic Island (such as 1206x2622)",
    "IPAD_13_DISPLAY": "13-inch iPad (such as 2064x2752)",
}
IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg")
MAX_SCREENSHOTS_PER_GROUP = 10

# Every write the script may send. Anything else (review submissions, pricing, availability, new
# versions or products, builds, ...) is refused before it reaches App Store Connect.
ALLOWED_WRITES = (
    ("PATCH", r"/appInfos/[^/?]+"),  # categories only, see GuardedClient
    ("POST", r"/appInfoLocalizations"),
    ("PATCH", r"/appInfoLocalizations/[^/?]+"),
    ("POST", r"/appStoreVersionLocalizations"),
    ("PATCH", r"/appStoreVersionLocalizations/[^/?]+"),
    ("POST", r"/appAssetLibraryImages"),
    ("PATCH", r"/appAssetLibraryImages/[^/?]+"),
    ("POST", r"/appAssetLibraryPlacements"),
    ("DELETE", r"/appAssetLibraryPlacements/[^/?]+"),
    ("POST", r"/appAssetLibraryPlacementOrderingRequests"),
)

_V2 = re.escape(review_mod.ASC_V2)
# Writes limited to named fields: (method, path, attributes, relationships). The payload may hold
# nothing else, so for example no review contact, demo account name or password, or content rights
# can be sent.
SCOPED_WRITES = (
    ("PATCH", r"/ageRatingDeclarations/[^/?]+", set(review_mod.AGE_RATING_ATTRIBUTES), set()),
    ("POST", r"/appStoreReviewDetails", {"notes", "demoAccountRequired"}, {"appStoreVersion"}),
    ("PATCH", r"/appStoreReviewDetails/[^/?]+", {"notes", "demoAccountRequired"}, set()),
    ("PATCH", r"/appStoreVersions/[^/?]+", {"copyright"}, set()),
    ("POST", r"/subscriptionGroupVersions", set(), {"subscriptionGroup"}),
    ("POST", r"/subscriptionVersions", set(), {"subscription"}),
    ("POST", _V2 + r"/subscriptionGroupLocalizations", {"locale", "name"}, {"version"}),
    ("PATCH", _V2 + r"/subscriptionGroupLocalizations/[^/?]+", {"name"}, set()),
    ("POST", _V2 + r"/subscriptionLocalizations", {"locale", "name", "description"}, {"version"}),
    ("PATCH", _V2 + r"/subscriptionLocalizations/[^/?]+", {"name", "description"}, set()),
    ("POST", r"/betaAppLocalizations", {"locale", "description"}, {"app"}),
    ("PATCH", r"/betaAppLocalizations/[^/?]+", {"description"}, set()),
)


# --- Documents ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class LocaleListing:
    name: str
    subtitle: str
    description: str
    keywords: str
    promotional_text: str


@dataclass(frozen=True)
class Listing:
    support_url: str
    marketing_url: str
    privacy_policy_url: str
    primary_category: str
    secondary_category: str
    locales: dict[str, LocaleListing]

    def info_attributes(self, locale: str) -> dict[str, str]:
        entry = self.locales[locale]
        return {
            "name": entry.name,
            "subtitle": entry.subtitle,
            "privacyPolicyUrl": self.privacy_policy_url,
        }

    def version_attributes(self, locale: str) -> dict[str, str]:
        entry = self.locales[locale]
        return {
            "description": entry.description,
            "keywords": entry.keywords,
            "promotionalText": entry.promotional_text,
            "supportUrl": self.support_url,
            "marketingUrl": self.marketing_url,
        }


@dataclass(frozen=True)
class AppStoreEntry:
    """One language section of APP_STORE_DOC, in the order its entries are written."""

    subtitle: str
    promotional_text: str
    keywords: str
    sign_in_note: str
    price_note: str


BULLET = "• "
_PLAY_LABEL = re.compile(r"^\*\*[^*]+\*\*\s*[:：]\s*(.*?)\s*$")
_APP_STORE_ENTRY = re.compile(r"^- \*\*[^*]+\*\*\s*[:：]\s*(.*?)\s*$")


def parse_play_listing(text: str) -> dict[str, tuple[str, str]]:
    """Play language code -> (app name, full description)."""
    codes = [code for _, _, code in LANGUAGES]
    found: dict[str, tuple[str, str]] = {}
    for heading, lines in _sections(text, PLAY_STORE_DOC).items():
        match = re.search(r"\(([^()]+)\)$", heading)
        if not match:
            continue  # not a language section (the other store fields)
        code = match.group(1)
        if code not in codes:
            raise ListingError(f"{PLAY_STORE_DOC}: '## {heading}' is a language this script doesn't map.")
        if code in found:
            raise ListingError(f"{PLAY_STORE_DOC}: two sections for {code}.")
        # Labels are translated, so they are read by position: name, short and full description.
        labels = [(i, m.group(1)) for i, line in enumerate(lines) if (m := _PLAY_LABEL.match(line))]
        if len(labels) != 3 or not labels[0][1] or not labels[1][1] or labels[2][1]:
            raise ListingError(
                f"{PLAY_STORE_DOC}: '## {heading}' needs three labels: app name and short description "
                "with their value, then full description with the text below it."
            )
        description = "\n".join(lines[labels[2][0] + 1 :]).strip("\n")
        if not description:
            raise ListingError(f"{PLAY_STORE_DOC}: '## {heading}' has no full description.")
        found[code] = (labels[0][1], description)
    missing = [code for code in codes if code not in found]
    if missing:
        raise ListingError(f"{PLAY_STORE_DOC}: no section for {', '.join(missing)}.")
    return found


def _single(pattern: str, text: str, what: str) -> str:
    found = re.findall(pattern, text)
    if len(found) != 1:
        raise ListingError(f"{APP_STORE_DOC}: expected exactly one {what}, found {len(found)}.")
    return found[0]


def _rule(lines: list[str], label: str) -> str:
    return _single(rf"(?m)^- \*\*{label}\*\*\s*[:：](.*)$", "\n".join(lines), f"'- **{label}**' rule")


def parse_app_store_listing(text: str) -> tuple[dict[str, str], dict[str, AppStoreEntry]]:
    """(URLs and categories from the shared rules, section heading -> entry)."""
    sections = _sections(text, APP_STORE_DOC)
    rules = sections.pop(RULES_SECTION, None)
    if rules is None:
        raise ListingError(f"{APP_STORE_DOC}: no '## {RULES_SECTION}' section.")
    urls = _rule(rules, "网址")
    shared = {
        key: _single(rf"{label}\s*(https://[A-Za-z0-9._~/?#=&%-]+)", urls, f"URL after {label}")
        for key, label in (("support", "技术支持"), ("marketing", "营销"), ("privacy", "隐私政策"))
    }
    categories = _rule(rules, "类别")
    for key, label in (("primary_category", "主要"), ("secondary_category", "次要")):
        name = _single(
            rf"{label}[^（()）]*[（(]\s*([A-Za-z][A-Za-z &]*?)\s*[）)]", categories, f"category after {label}"
        )
        category = name.upper().replace("&", "AND").replace(" ", "_")
        if category not in CATEGORY_IDS:
            raise ListingError(f"{APP_STORE_DOC}: '{name}' is not an App Store category.")
        shared[key] = category

    headings = [heading for _, heading, _ in LANGUAGES]
    unknown = [heading for heading in sections if heading not in headings]
    missing = [heading for heading in headings if heading not in sections]
    problems = []
    if unknown:
        problems.append(f"{APP_STORE_DOC}: unknown section(s): {', '.join(unknown)}.")
    if missing:
        problems.append(f"{APP_STORE_DOC}: no section for {', '.join(missing)}.")
    if problems:
        raise ListingError("\n".join(problems))

    entries: dict[str, AppStoreEntry] = {}
    for heading in headings:
        values = []
        for line in sections[heading]:
            if not line:
                continue
            match = _APP_STORE_ENTRY.match(line)
            if not match or not match.group(1):
                raise ListingError(f"{APP_STORE_DOC}: unexpected line in '## {heading}': {line}")
            values.append(match.group(1))
        if len(values) != 5:
            raise ListingError(
                f"{APP_STORE_DOC}: '## {heading}' needs 5 entries (subtitle, promotional text, keywords, "
                f"iOS sign-in note, iOS price note), found {len(values)}."
            )
        entry = AppStoreEntry(*values)
        # The entries are read by position, so make sure the replacement passages are what they claim.
        note = entry.sign_in_note
        if "Apple" not in note or "notefable.com" not in note or "NoteFable Pro" in note:
            raise ListingError(f"{APP_STORE_DOC}: entry 4 of '## {heading}' is not the iOS sign-in note.")
        if "NoteFable Pro" not in entry.price_note or "https://notefable.com/terms" not in entry.price_note:
            raise ListingError(
                f"{APP_STORE_DOC}: entry 5 of '## {heading}' is not the iOS price note "
                "(it names NoteFable Pro and links the terms of use)."
            )
        entries[heading] = entry
    return shared, entries


def build_description(
    play_description: str, sign_in_note: str, price_note: str, privacy_url: str, language: str
) -> str:
    """The Play full description with its sync bullet and price paragraph replaced for iOS."""
    lines = play_description.split("\n")
    sync = [i for i, line in enumerate(lines) if line.startswith(BULLET) and "notefable.com" in line]
    if len(sync) != 1:
        raise ListingError(
            f"{language}: the Play description needs exactly one '• ' bullet naming notefable.com "
            f"(the sync bullet), found {len(sync)}."
        )
    i = sync[0]
    # The sync bullet opens its section: a blank line, the section title, then the bullet.
    if i < 2 or "Google" not in lines[i] or not lines[i - 1] or lines[i - 1].startswith(BULLET) or lines[i - 2]:
        raise ListingError(f"{language}: the bullet naming notefable.com is not the sync section's first bullet.")
    lines[i] = BULLET + sign_in_note

    paragraphs = "\n".join(lines).split("\n\n")
    priced = [k for k, paragraph in enumerate(paragraphs) if "NoteFable Pro" in paragraph]
    if priced != [len(paragraphs) - 2] or "\n" in paragraphs[-2] or privacy_url not in paragraphs[-1]:
        raise ListingError(
            f"{language}: the Play description needs one NoteFable Pro paragraph (the price), "
            "right before the privacy policy line."
        )
    paragraphs[-2] = price_note
    return "\n\n".join(paragraphs)


def limit_problems(entry: LocaleListing) -> list[str]:
    problems = []
    if not NAME_MIN <= len(entry.name) <= NAME_MAX:
        problems.append(f"name is {len(entry.name)} characters (allowed {NAME_MIN}-{NAME_MAX})")
    for label, value, limit in (
        ("subtitle", entry.subtitle, SUBTITLE_MAX),
        ("promotional text", entry.promotional_text, PROMOTIONAL_TEXT_MAX),
        ("description", entry.description, DESCRIPTION_MAX),
    ):
        if len(value) > limit:
            problems.append(f"{label} is {len(value)} characters (limit {limit})")
    size = len(entry.keywords.encode("utf-8"))
    if size > KEYWORDS_MAX_BYTES:
        problems.append(f"keywords are {size} UTF-8 bytes (limit {KEYWORDS_MAX_BYTES})")
    words = entry.keywords.split(",")
    if len(words) < 2 or any(not w or w != w.strip() for w in words) or re.search("[，、،]", entry.keywords):
        problems.append("keywords must be separated by ',' with no spaces around it")
    return problems


def load_listing(repo_root: Path) -> Listing:
    shared, entries = parse_app_store_listing(_read_text(repo_root / APP_STORE_DOC))
    play = parse_play_listing(_read_text(repo_root / PLAY_STORE_DOC))
    locales: dict[str, LocaleListing] = {}
    problems: list[str] = []
    for asc_locales, heading, play_code in LANGUAGES:
        entry = entries[heading]
        name, play_description = play[play_code]
        localized = LocaleListing(
            name=name,
            subtitle=entry.subtitle,
            description=build_description(
                play_description, entry.sign_in_note, entry.price_note, shared["privacy"], heading
            ),
            keywords=entry.keywords,
            promotional_text=entry.promotional_text,
        )
        problems += [f"{heading}: {problem}" for problem in limit_problems(localized)]
        locales.update({locale: localized for locale in asc_locales})
    if problems:
        raise ListingError("\n".join(problems))
    return Listing(
        support_url=shared["support"],
        marketing_url=shared["marketing"],
        privacy_policy_url=shared["privacy"],
        primary_category=shared["primary_category"],
        secondary_category=shared["secondary_category"],
        locales=locales,
    )


# --- Screenshot files --------------------------------------------------------------------------


@dataclass(frozen=True)
class Screenshot:
    folder: str
    path: Path
    width: int
    height: int
    size: int
    sha256: str

    @property
    def label(self) -> str:
        return f"{self.folder}/{self.path.name} {self.width}x{self.height}"

    @property
    def content_key(self) -> str:
        """Starts the reference name of every upload of this file, so a later run recognizes it."""
        return f"{self.path.name[:30]} sha256:{self.sha256[:16]}"

    def new_reference_name(self) -> str:
        """Reference names are unique in the asset library, which keeps old and unfinished uploads."""
        return f"{self.content_key} {secrets.token_hex(4)}"

    def is_uploaded_as(self, reference_name: str | None) -> bool:
        return (reference_name or "").startswith(f"{self.content_key} ")


def image_size(data: bytes, suffix: str) -> tuple[int, int]:
    """Pixel size of a PNG or JPEG; refuses transparency, which App Store screenshots can't have."""
    if suffix == ".png":
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
        if transparent:
            raise ListingError("has transparency; App Store screenshots must be opaque")
        return width, height
    if data[:2] != b"\xff\xd8":
        raise ListingError("not a JPEG file")
    offset = 2
    while offset + 4 <= len(data) and data[offset] == 0xFF:
        marker = data[offset + 1]
        if marker == 0xFF:  # fill byte
            offset += 1
        elif marker == 0x01 or 0xD0 <= marker <= 0xD9:  # markers without a length
            offset += 2
        elif 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC) and offset + 9 <= len(data):
            height, width = struct.unpack(">HH", data[offset + 5 : offset + 9])
            return width, height
        else:
            offset += 2 + int.from_bytes(data[offset + 2 : offset + 4], "big")
    raise ListingError("can't read the JPEG size")


def load_screenshots(repo_root: Path) -> list[Screenshot] | None:
    """Screenshots in upload order, or None when the folder doesn't exist."""
    root = repo_root / SCREENSHOT_DIR
    if not root.is_dir():
        return None
    problems: list[str] = []
    shots: list[Screenshot] = []
    for entry in sorted(root.iterdir(), key=lambda p: p.name):
        if entry.name.startswith("."):
            continue
        if entry.is_dir() and entry.name not in SCREENSHOT_FOLDERS:
            problems.append(f"{SCREENSHOT_DIR}/{entry.name}/: only iphone/ and ipad/ are used")
        elif entry.is_file() and entry.suffix.lower() in IMAGE_SUFFIXES:
            problems.append(f"{SCREENSHOT_DIR}/{entry.name}: move it into iphone/ or ipad/")
    for folder in SCREENSHOT_FOLDERS:
        directory = root / folder
        if not directory.is_dir():
            continue
        for path in sorted(directory.iterdir(), key=lambda p: p.name):
            if path.name.startswith("."):
                continue
            where = f"{SCREENSHOT_DIR}/{folder}/{path.name}"
            if not path.is_file() or path.suffix.lower() not in IMAGE_SUFFIXES:
                problems.append(f"{where}: only PNG and JPEG files belong here")
                continue
            data = path.read_bytes()
            try:
                width, height = image_size(data, path.suffix.lower())
            except ListingError as exc:
                problems.append(f"{where}: {exc}")
                continue
            digest = hashlib.sha256(data).hexdigest()
            shots.append(Screenshot(folder, path, width, height, len(data), digest))
    for (folder, width, height), count in Counter((s.folder, s.width, s.height) for s in shots).items():
        if count > MAX_SCREENSHOTS_PER_GROUP:
            problems.append(f"{SCREENSHOT_DIR}/{folder}/: {count} screenshots of {width}x{height} (limit 10)")
    if problems:
        raise ListingError("\n".join(problems))
    return shots


# --- App Store Connect: reading ----------------------------------------------------------------


class GuardedClient:
    """AscClient wrapper: every read, only the listed writes, and none in a dry run."""

    def __init__(self, client: Any, allow_writes: bool) -> None:
        self._client = client
        self.allow_writes = allow_writes

    def request(
        self,
        method: str,
        path_or_url: str,
        payload: dict[str, Any] | None = None,
        allow_404: bool = False,
    ) -> Any:
        if method != "GET":
            allowed = any(method == m and re.fullmatch(p, path_or_url) for m, p in ALLOWED_WRITES)
            for scoped_method, pattern, fields, related in SCOPED_WRITES:
                if method == scoped_method and re.fullmatch(pattern, path_or_url):
                    data = (payload or {}).get("data") or {}
                    sent = set(data.get("attributes") or {})
                    allowed = (
                        set(payload or {}) == {"data"}
                        and set(data) <= {"type", "id", "attributes", "relationships"}
                        and sent <= fields
                        and bool(sent) == bool(fields)
                        and set(data.get("relationships") or {}) <= related
                    )
            if not self.allow_writes or not allowed:
                raise WriteRefused(f"Refusing to send {method} {path_or_url}.")
            if path_or_url.startswith("/appInfos/"):
                data = (payload or {}).get("data") or {}
                other = set(data.get("relationships") or {}) - {"primaryCategory", "secondaryCategory"}
                if data.get("attributes") or other:
                    raise WriteRefused("Refusing to change anything on the app info except its categories.")
        return self._client.request(method, path_or_url, payload=payload, allow_404=allow_404)


def _related_id(resource: dict, name: str) -> str | None:
    data = ((resource.get("relationships") or {}).get(name) or {}).get("data")
    return data.get("id") if isinstance(data, dict) else None


def _the_editable_one(resources: list[dict], states: frozenset, state_key: str, what: str) -> dict:
    matches = [r for r in resources if _attributes(r).get(state_key) in states]
    if len(matches) != 1:
        seen = ", ".join(
            f"{_attributes(r).get('versionString') or r.get('id')} {_attributes(r).get(state_key)}"
            for r in resources
        )
        raise AscError(
            f"Expected exactly one editable {what} in App Store Connect, found {len(matches)} "
            f"(all: {seen or 'none'}). Editable states: {', '.join(sorted(states))}. "
            "Nothing was changed; this script never creates one."
        )
    return matches[0]


def _localizations(client: Any, path: str) -> dict[str, dict]:
    items, _ = _get_all(client, f"{path}?limit=50")
    return {_attributes(item).get("locale"): item for item in items}


@dataclass
class ScreenshotGroup:
    """The new screenshots of one placement group and what the group shows now."""

    group_id: str
    display_class: str
    spec_ids: frozenset
    limit: int
    shots: list[Screenshot] = field(default_factory=list)
    current: list[dict] = field(default_factory=list)

    @property
    def unchanged(self) -> bool:
        return len(self.current) == len(self.shots) and all(
            shot.is_uploaded_as(placement["referenceName"]) and not placement["failed"]
            for placement, shot in zip(self.current, self.shots)
        )


def read_asset_reference(client: Any) -> dict:
    # Filtered: developers report that the unfiltered request answers 401.
    query = urllib.parse.urlencode({"filter[placementTypes]": "APP_SCREENSHOT"})
    data = (client.request("GET", f"/appAssetLibraryRefData?{query}") or {}).get("data")
    entry = data[0] if isinstance(data, list) and data else data
    if not isinstance(entry, dict):
        raise AscError("App Store Connect returned no asset library reference data.")
    return _attributes(entry)


def _fits(spec: dict, shot: Screenshot) -> bool:
    size = spec.get("dimensions") or {}
    return (
        size.get("minWidth", 0) <= shot.width <= size.get("maxWidth", 0)
        and size.get("minHeight", 0) <= shot.height <= size.get("maxHeight", 0)
    )


def _app_store_version_groups(reference: dict) -> dict[str, int]:
    """Placement group id -> screenshot limit, for the groups App Store versions take."""
    found: dict[str, int | None] = {}
    for feature in reference.get("features") or []:
        if feature.get("featureId") != "APP_STORE_VERSIONS":
            continue
        for policy in feature.get("placementPolicies") or []:
            if policy.get("placementType") != "APP_SCREENSHOT":
                continue
            for limit in policy.get("groupLimits") or []:
                for group_id in limit.get("groupIds") or []:
                    found[group_id] = found.get(group_id) or limit.get("maxCount")
    return {group_id: count or MAX_SCREENSHOTS_PER_GROUP for group_id, count in found.items()}


def group_screenshots(reference: dict, shots: list[Screenshot]) -> list[ScreenshotGroup]:
    """Put each screenshot into the placement group Apple's reference data gives for its size."""
    limits = _app_store_version_groups(reference)
    # Other features (custom product pages and so on) have groups of their own: leave those out.
    profiles = [
        p for p in reference.get("placementProfileGroups") or [] if p.get("placementProfileGroupId") in limits
    ]
    specs = {spec.get("specId"): spec for spec in reference.get("imageSpecs") or []}
    accepted: dict[str, set] = {}
    for placement_type in reference.get("placementTypes") or []:
        if placement_type.get("placementTypeId") == "APP_SCREENSHOT":
            for mapping in placement_type.get("specMappings") or []:
                accepted.setdefault(mapping.get("placementGroupId"), set()).update(mapping.get("specs") or [])

    groups: dict[str, ScreenshotGroup] = {}
    problems: list[str] = []
    for shot in shots:
        platform, classes = SCREENSHOT_FOLDERS[shot.folder]
        candidates = [
            p for p in profiles if p.get("platform") == platform and p.get("displayClassId") in classes
        ]
        matches = [
            p
            for p in candidates
            if any(_fits(specs.get(s) or {}, shot) for s in accepted.get(p.get("placementProfileGroupId"), ()))
        ]
        if len(matches) != 1:
            sizes = sorted(
                {
                    f"{size.get('minWidth')}x{size.get('minHeight')}"
                    for p in candidates
                    for s in accepted.get(p.get("placementProfileGroupId"), ())
                    if (size := (specs.get(s) or {}).get("dimensions"))
                }
            )
            problem = "matches several placement groups" if matches else "is not an accepted size"
            problems.append(f"{shot.label} {problem} ({shot.folder}/ takes: {', '.join(sizes) or 'nothing'})")
            continue
        group_id = matches[0]["placementProfileGroupId"]
        if group_id not in groups:
            groups[group_id] = ScreenshotGroup(
                group_id=group_id,
                display_class=matches[0]["displayClassId"],
                spec_ids=frozenset(accepted[group_id]),
                limit=limits[group_id],
            )
        groups[group_id].shots.append(shot)
    problems += [
        f"{g.group_id}: {len(g.shots)} screenshots, the App Store allows {g.limit}"
        for g in groups.values()
        if len(g.shots) > g.limit
    ]
    if problems:
        raise ListingError("\n".join(problems))
    order = [c for _, classes in SCREENSHOT_FOLDERS.values() for c in classes]
    return sorted(groups.values(), key=lambda g: order.index(g.display_class))


def current_screenshots(client: Any, localization_id: str, group_id: str) -> list[dict]:
    """The group's screenshot placements on one version localization, in display order."""
    query = urllib.parse.urlencode(
        {
            "filter[placementType]": "APP_SCREENSHOT",
            "filter[placementGroup]": group_id,
            "sort": "placementGroupPosition",
            "include": "image",
            "limit": 50,
        }
    )
    data, included = _get_all(client, f"/appStoreVersionLocalizations/{localization_id}/placements?{query}")
    images = {i["id"]: _attributes(i) for i in included if i.get("type") == "appAssetLibraryImages"}
    placements = []
    for placement in data:
        attributes = _attributes(placement)
        # These are what a replacement deletes: refuse anything else the API might return.
        if attributes.get("placementGroup") != group_id or attributes.get("placementType") != "APP_SCREENSHOT":
            raise AscError(f"App Store Connect listed a placement outside {group_id}; not replacing screenshots.")
        image = images.get(_related_id(placement, "image") or "", {})
        placements.append(
            {
                "id": placement["id"],
                "fileName": image.get("fileName"),
                "fileSize": image.get("fileSize"),
                "referenceName": image.get("referenceName"),
                "failed": "FAILED" in (attributes.get("state"), image.get("state")),
            }
        )
    return placements


def screenshot_counts(client: Any, localization_id: str) -> Counter:
    """How many screenshots each placement group shows on one version localization."""
    query = urllib.parse.urlencode({"filter[placementType]": "APP_SCREENSHOT", "limit": 50})
    data, _ = _get_all(client, f"/appStoreVersionLocalizations/{localization_id}/placements?{query}")
    return Counter(str(_attributes(placement).get("placementGroup")) for placement in data)


@dataclass
class LocalizationPlan:
    resource_type: str  # appInfoLocalizations or appStoreVersionLocalizations
    locale: str
    desired: dict[str, str]
    resource_id: str | None = None  # None: App Store Connect has no such localization yet
    current: dict[str, Any] = field(default_factory=dict)

    def read_from(self, existing: dict[str, dict]) -> None:
        item = existing.get(self.locale)
        if item:
            self.resource_id, self.current = item["id"], _attributes(item)

    @property
    def changes(self) -> dict[str, str]:
        return {k: v for k, v in self.desired.items() if _normalized(self.current.get(k)) != _normalized(v)}


@dataclass
class Plan:
    header: list[str]
    warnings: list[str]
    version_id: str
    app_info_id: str
    categories: dict[str, tuple[str | None, str]]  # relationship -> (current, new)
    info: dict[str, LocalizationPlan]
    version: dict[str, LocalizationPlan]
    screenshots: list[ScreenshotGroup] | None = None
    library_id: str | None = None
    app_id: str = ""
    copyright: str | None = None


def build_plan(client: Any, listing: Listing, shots: list[Screenshot] | None, bundle_id: str) -> Plan:
    app_id = dist.find_app_id(client, bundle_id)
    app = (client.request("GET", f"/apps/{app_id}") or {}).get("data") or {}

    query = urllib.parse.urlencode({"filter[platform]": "IOS", "limit": 50})
    versions, _ = _get_all(client, f"/apps/{app_id}/appStoreVersions?{query}")
    version = _the_editable_one(versions, EDITABLE_VERSION_STATES, "appVersionState", "iOS version")
    query = urllib.parse.urlencode({"include": "primaryCategory,secondaryCategory", "limit": 50})
    app_infos, _ = _get_all(client, f"/apps/{app_id}/appInfos?{query}")
    app_info = _the_editable_one(app_infos, EDITABLE_APP_INFO_STATES, "state", "app info")

    info_existing = _localizations(client, f"/appInfos/{app_info['id']}/appInfoLocalizations")
    version_existing = _localizations(client, f"/appStoreVersions/{version['id']}/appStoreVersionLocalizations")
    info = {loc: LocalizationPlan("appInfoLocalizations", loc, listing.info_attributes(loc)) for loc in listing.locales}
    version_plans = {
        loc: LocalizationPlan("appStoreVersionLocalizations", loc, listing.version_attributes(loc))
        for loc in listing.locales
    }
    for locale in listing.locales:
        info[locale].read_from(info_existing)
        version_plans[locale].read_from(version_existing)

    warnings = []
    primary = _attributes(app).get("primaryLocale")
    if primary and primary != PRIMARY_LOCALE:
        warnings.append(f"The app's primary language is {primary}; screenshots go to {PRIMARY_LOCALE} only.")
    extra = sorted(str(loc) for loc in (set(info_existing) | set(version_existing)) - set(listing.locales))
    if extra:
        warnings.append(f"App Store Connect also has {', '.join(extra)}, not in the documents; left unchanged.")

    plan = Plan(
        header=[
            f"App {bundle_id} (id {app_id}), primary language {primary}",
            f"Editable version {_attributes(version).get('versionString')} "
            f"({_attributes(version).get('appVersionState')}), app info {_attributes(app_info).get('state')}",
        ],
        warnings=warnings,
        version_id=version["id"],
        app_info_id=app_info["id"],
        categories={
            "primaryCategory": (_related_id(app_info, "primaryCategory"), listing.primary_category),
            "secondaryCategory": (_related_id(app_info, "secondaryCategory"), listing.secondary_category),
        },
        info=info,
        version=version_plans,
        app_id=app_id,
        copyright=_attributes(version).get("copyright"),
    )
    localization_id = version_plans[PRIMARY_LOCALE].resource_id
    if shots:
        library = (client.request("GET", f"/apps/{app_id}/assetLibrary") or {}).get("data") or {}
        plan.library_id = library.get("id")
        if not plan.library_id:
            raise AscError("App Store Connect returned no asset library for the app.")
        plan.screenshots = group_screenshots(read_asset_reference(client), shots)
        for group in plan.screenshots:
            if localization_id:
                group.current = current_screenshots(client, localization_id, group.group_id)
        present = {group.display_class for group in plan.screenshots}
        plan.warnings += [
            f"No {label} screenshots in {SCREENSHOT_DIR}; App Store submission needs them."
            for display_class, label in REQUIRED_DISPLAY_CLASSES.items()
            if display_class not in present
        ]
    if localization_id:
        # Groups without local files are never touched, so say what stays on the product page.
        local = {group.group_id for group in plan.screenshots or []}
        plan.warnings += [
            f"{group_id}: {count} {PRIMARY_LOCALE} screenshot(s) on App Store Connect and none for it in "
            f"{SCREENSHOT_DIR}; left unchanged."
            for group_id, count in sorted(screenshot_counts(client, localization_id).items())
            if group_id not in local
        ]
    return plan


# --- Report ------------------------------------------------------------------------------------


def _print_value(out, name: str, current: str | None, new: str) -> None:
    if _normalized(current) == _normalized(new):
        shown = f"unchanged ({len(new)} characters)" if "\n" in new else f"unchanged: {new}"
        out(f"  {name}: {shown}")
        return
    out(f"  {name}: CHANGE")
    for label, value in (("current", current), ("new", new)):
        text = _normalized(value)
        if "\n" in text:
            out(f"    {label}:")
            for line in text.split("\n"):
                out(f"      | {line}")  # the bar also keeps a line from reading as a ::command::
        else:
            out(f"    {label}: {text or '(empty)'}")


def print_plan(plan: Plan, out=print) -> None:
    for line in plan.header:
        out(line)
    for warning in plan.warnings:
        out(f"::warning::{warning}")
    out("")
    out("Categories")
    for name, (current, new) in plan.categories.items():
        _print_value(out, name, current, new)
    for locale in plan.info:
        out("")
        out(f"[{locale}]")
        for resource in (plan.info[locale], plan.version[locale]):
            if resource.resource_id is None:
                out(f"  ({resource.resource_type}: not on App Store Connect yet, will be created)")
            for name, new in resource.desired.items():
                _print_value(out, name, resource.current.get(name), new)

    out("")
    out(f"Screenshots ({PRIMARY_LOCALE})")
    if plan.screenshots is None:
        out(f"  none in {SCREENSHOT_DIR}: screenshots are skipped")
    for group in plan.screenshots or []:
        if group.unchanged:
            out(f"  {group.group_id}: unchanged ({len(group.shots)} in place)")
            continue
        out(f"  {group.group_id}: replace {len(group.current)} current with {len(group.shots)} new")
        for number, placement in enumerate(group.current, 1):
            name, size = placement["fileName"] or "(unknown file)", placement["fileSize"] or "?"
            out(f"    current {number}: {name} ({size} bytes)")
        for number, shot in enumerate(group.shots, 1):
            out(f"    new {number}: {shot.label} ({shot.size} bytes)")

    resources = [*plan.info.values(), *plan.version.values()]
    out("")
    out(
        "Summary: "
        f"{sum(len(r.changes) for r in resources if r.resource_id)} field changes, "
        f"{sum(r.resource_id is None for r in resources)} localizations to create, "
        f"{sum(current != new for current, new in plan.categories.values())} category changes, "
        f"{sum(not g.unchanged for g in plan.screenshots or [])} screenshot groups to replace."
    )


def print_check(listing: Listing, shots: list[Screenshot] | None, out=print) -> None:
    out(f"Listing documents OK: {len(listing.locales)} App Store locales.")
    out(f"Categories: {listing.primary_category}, {listing.secondary_category}")
    out(
        f"URLs: support {listing.support_url}, marketing {listing.marketing_url}, "
        f"privacy {listing.privacy_policy_url}"
    )
    out("locale    name subtitle promo keyword-bytes description")
    for locale, entry in listing.locales.items():
        out(
            f"{locale:<8} {len(entry.name):>5} {len(entry.subtitle):>8} {len(entry.promotional_text):>5} "
            f"{len(entry.keywords.encode('utf-8')):>13} {len(entry.description):>11}"
        )
    if not shots:
        out(f"Screenshots: none in {SCREENSHOT_DIR}; they will be skipped.")
        return
    out("Screenshots (sizes are checked against Apple's list in the dry run):")
    for shot in shots:
        out(f"  {shot.label}")


# --- App Store Connect: writing ----------------------------------------------------------------


def update_categories(client: Any, app_info_id: str, categories: dict[str, str]) -> None:
    relationships = {
        name: {"data": {"type": "appCategories", "id": category}} for name, category in categories.items()
    }
    client.request(
        "PATCH",
        f"/appInfos/{app_info_id}",
        payload={"data": {"type": "appInfos", "id": app_info_id, "relationships": relationships}},
    )


def write_localization(client: Any, plan: LocalizationPlan, parent: str, parent_id: str, out=print) -> None:
    """Create the localization, or patch only the attributes that differ."""
    if plan.resource_id is None:
        response = client.request(
            "POST",
            f"/{plan.resource_type}",
            payload={
                "data": {
                    "type": plan.resource_type,
                    "attributes": {"locale": plan.locale, **plan.desired},
                    "relationships": {parent: {"data": {"type": f"{parent}s", "id": parent_id}}},
                }
            },
        )
        plan.resource_id = response["data"]["id"]
        out(f"Created {plan.resource_type} {plan.locale}.")
        return
    changes = plan.changes
    if changes:
        client.request(
            "PATCH",
            f"/{plan.resource_type}/{plan.resource_id}",
            payload={"data": {"type": plan.resource_type, "id": plan.resource_id, "attributes": changes}},
        )
        out(f"Updated {plan.resource_type} {plan.locale}: {', '.join(changes)}.")


def upload_part(operation: dict, chunk: bytes, sleep_fn=time.sleep) -> None:
    """Send one part to its pre-signed upload URL (which takes no App Store Connect token)."""
    url = operation.get("url") or ""
    if not url.startswith("https://"):
        raise AscError("Refusing an upload URL that isn't HTTPS.")
    headers = {h["name"]: h["value"] for h in operation.get("requestHeaders") or []}
    for attempt in range(1, 4):
        request = urllib.request.Request(url, data=chunk, headers=headers, method=operation.get("method") or "PUT")
        try:
            with urllib.request.urlopen(request, timeout=300):
                return
        except urllib.error.HTTPError as exc:
            error, transient = f"HTTP {exc.code}", exc.code in dist.TRANSIENT_HTTP_STATUSES
        except (OSError, http.client.HTTPException) as exc:  # URLError, timeouts and dropped connections
            error, transient = str(exc), True
        if not transient or attempt == 3:
            raise AscError(f"Screenshot upload failed: {error}")
        sleep_fn(2**attempt)


def upload_image(client: Any, library_id: str, shot: Screenshot, uploader) -> str:
    """Reserve, upload and commit one screenshot in the asset library; return its id."""
    response = client.request(
        "POST",
        "/appAssetLibraryImages",
        payload={
            "data": {
                "type": "appAssetLibraryImages",
                "attributes": {
                    "category": "APP_SCREENSHOTS_AND_PREVIEWS",
                    "fileName": shot.path.name,
                    "fileSize": shot.size,
                    "referenceName": shot.new_reference_name(),
                },
                "relationships": {"assetLibrary": {"data": {"type": "appAssetLibraries", "id": library_id}}},
            }
        },
    )
    image = response["data"]
    operations = _attributes(image).get("uploadOperations") or []
    if not operations:
        raise AscError(f"App Store Connect gave no upload operations for {shot.label}.")
    content = shot.path.read_bytes()
    for operation in operations:
        offset = operation.get("offset") or 0
        uploader(operation, content[offset : offset + operation["length"]])
    client.request(
        "PATCH",
        f"/appAssetLibraryImages/{image['id']}",
        payload={"data": {"type": "appAssetLibraryImages", "id": image["id"], "attributes": {"uploaded": True}}},
    )
    return image["id"]


def wait_for_image(
    client: Any, image_id: str, label: str, sleep_fn=time.sleep, time_fn=time.time, timeout: int = 600
) -> dict:
    deadline = time_fn() + timeout
    while True:
        image = (client.request("GET", f"/appAssetLibraryImages/{image_id}") or {}).get("data") or {}
        attributes = _attributes(image)
        state = attributes.get("state")
        if state == "FAILED":
            details = "; ".join(
                d.get("description") or d.get("code") or "" for d in attributes.get("stateDetails") or []
            )
            raise AscError(f"App Store Connect rejected {label}: {details or 'no details'}")
        if state not in (None, "AWAITING_UPLOAD", "UPLOAD_COMPLETE"):
            return attributes
        if time_fn() >= deadline:
            raise AscError(f"Timed out waiting for {label} to be processed (state {state}).")
        sleep_fn(5)


def replace_screenshots(
    client: Any,
    group: ScreenshotGroup,
    library_id: str,
    localization_id: str,
    out=print,
    uploader=upload_part,
    sleep_fn=time.sleep,
    time_fn=time.time,
) -> None:
    # Upload and process every new image first: if that fails, the current screenshots stay.
    image_ids = [upload_image(client, library_id, shot, uploader) for shot in group.shots]
    for image_id, shot in zip(image_ids, group.shots):
        spec_id = wait_for_image(client, image_id, shot.label, sleep_fn, time_fn).get("specId")
        if spec_id and spec_id not in group.spec_ids:
            raise AscError(f"Apple matched {shot.label} to a size that {group.group_id} doesn't take.")
    for placement in group.current:
        client.request("DELETE", f"/appAssetLibraryPlacements/{placement['id']}")

    localization = {"data": {"type": "appStoreVersionLocalizations", "id": localization_id}}
    placement_ids = []
    for image_id in image_ids:
        response = client.request(
            "POST",
            "/appAssetLibraryPlacements",
            payload={
                "data": {
                    "type": "appAssetLibraryPlacements",
                    "attributes": {"placementType": "APP_SCREENSHOT", "placementGroup": group.group_id},
                    "relationships": {
                        "image": {"data": {"type": "appAssetLibraryImages", "id": image_id}},
                        "appStoreVersionLocalization": localization,
                    },
                }
            },
        )
        placement_ids.append(response["data"]["id"])
    if len(placement_ids) > 1:
        ordered = [{"type": "appAssetLibraryPlacements", "id": i} for i in placement_ids]
        client.request(
            "POST",
            "/appAssetLibraryPlacementOrderingRequests",
            payload={
                "data": {
                    "type": "appAssetLibraryPlacementOrderingRequests",
                    "attributes": {"placementGroup": group.group_id},
                    "relationships": {
                        "orderedPlacements": {"data": ordered},
                        "appStoreVersionLocalization": localization,
                    },
                }
            },
        )
    out(f"Replaced {group.group_id}: {len(group.current)} -> {len(placement_ids)} screenshots.")


def apply_plan(
    client: Any,
    plan: Plan,
    out=print,
    uploader=upload_part,
    sleep_fn=time.sleep,
    time_fn=time.time,
    review_plan=None,
) -> list[str]:
    """Make the planned changes; return what failed (one failure doesn't stop the others)."""
    failures: list[str] = []

    def attempt(label: str, action, fatal: tuple = (401, 403)) -> None:
        try:
            action()
        except AscError as exc:
            if exc.status in fatal:
                raise  # a key or role problem would fail every other request too
            failures.append(f"{label}: {exc}")
            out(f"::error::{label}: {exc}")

    categories = {name: new for name, (current, new) in plan.categories.items() if current != new}
    if categories:
        attempt("categories", lambda: update_categories(client, plan.app_info_id, categories))
    for locale, resource in plan.version.items():
        attempt(
            f"{locale} version text",
            lambda: write_localization(client, resource, "appStoreVersion", plan.version_id, out),
        )
    # Adding a version localization can add the app info localization too: read them again.
    existing = _localizations(client, f"/appInfos/{plan.app_info_id}/appInfoLocalizations")
    for locale, resource in plan.info.items():
        resource.read_from(existing)
        attempt(
            f"{locale} name and subtitle",
            lambda: write_localization(client, resource, "appInfo", plan.app_info_id, out),
        )

    if review_plan:
        for error in review_plan.errors:  # what could not be read was not written
            failures.append(error)
        # Apple also answers 403 for one record's role or state: here only a bad key (401) stops.
        review_mod.apply_review(client, review_plan, lambda label, action: attempt(label, action, (401,)), out)

    changed = [group for group in plan.screenshots or [] if not group.unchanged]
    localization_id = plan.version[PRIMARY_LOCALE].resource_id
    if changed and not localization_id:
        message = f"screenshots: not uploaded, there is no {PRIMARY_LOCALE} version localization"
        failures.append(message)
        out(f"::error::{message}")
        return failures
    for group in changed:
        attempt(
            group.group_id,
            lambda: replace_screenshots(
                client, group, plan.library_id, localization_id, out, uploader, sleep_fn, time_fn
            ),
        )
    return failures


def _audit_targets(client: Any, bundle_id: str) -> tuple[str, str | None, str | None]:
    """(app, app info, version) to audit when the plan could not be built; None: no single one."""
    app_id = dist.find_app_id(client, bundle_id)

    def pick(path: str, states: frozenset, state_key: str) -> str | None:
        resources, _ = _get_all(client, path)
        editable = [r for r in resources if _attributes(r).get(state_key) in states]
        chosen = editable if len(editable) == 1 else resources
        return chosen[0]["id"] if len(chosen) == 1 else None

    query = urllib.parse.urlencode({"filter[platform]": "IOS", "limit": 50})
    return (
        app_id,
        pick(f"/apps/{app_id}/appInfos?limit=50", EDITABLE_APP_INFO_STATES, "state"),
        pick(f"/apps/{app_id}/appStoreVersions?{query}", EDITABLE_VERSION_STATES, "appVersionState"),
    )


def sync(
    client: Any,
    listing: Listing,
    shots: list[Screenshot] | None,
    apply: bool,
    bundle_id: str = BUNDLE_ID,
    out=print,
    uploader=upload_part,
    sleep_fn=time.sleep,
    time_fn=time.time,
    review=None,
    marketing_version: str | None = None,
) -> bool:
    """Print the plan and, with apply, carry it out; then audit. Returns False if any change failed."""
    guarded = GuardedClient(client, allow_writes=apply)
    reader = GuardedClient(client, allow_writes=False)  # the audit can only read

    def audit(app_id: str, app_info_id: str | None, version_id: str | None) -> None:
        review_mod.audit(reader, app_id, app_info_id, version_id, marketing_version, list(listing.locales), out)

    plan = None
    failures: list[str] = []
    try:
        plan = build_plan(guarded, listing, shots, bundle_id)
        print_plan(plan, out)
        review_plan = None
        if review:
            review_plan = review_mod.plan_review(
                guarded, review, plan.app_id, plan.version_id, plan.app_info_id, plan.copyright
            )
            review_mod.print_review(review_plan, out)
        if apply:
            out("")
            out("Applying...")
            failures = apply_plan(guarded, plan, out, uploader, sleep_fn, time_fn, review_plan)
    except (AscError, ListingError):
        # A run that stops still reports what is missing, without hiding why it stopped.
        try:
            if plan:
                audit(plan.app_id, plan.app_info_id, plan.version_id)
            else:
                audit(*_audit_targets(reader, bundle_id))
        except AscError as exc:
            out(f"::warning::The submission audit could not run: HTTP {exc.status or '(no status)'}.")
        raise
    # After the writes, so that it shows what is still missing now.
    audit(plan.app_id, plan.app_info_id, plan.version_id)
    out("")
    if not apply:
        out("Dry run: nothing was changed. Run with apply to write these values.")
        return True
    if failures:
        out(f"{len(failures)} change(s) failed. Fix the cause and run again; finished changes are kept.")
        return False
    out("Done. Nothing was submitted for review.")
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write the repository's App Store listing to App Store Connect.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="validate the documents only (no network)")
    mode.add_argument("--apply", action="store_true", help="make the changes (default: dry run)")
    parser.add_argument("--bundle-id", default=BUNDLE_ID)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):  # Windows consoles default to a legacy code page
            stream.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

    try:
        listing = load_listing(args.repo_root)
        shots = load_screenshots(args.repo_root)
        review = review_mod.load_review_info(args.repo_root, LANGUAGES)
        if args.check:
            print_check(listing, shots)
            print(
                f"Submission information OK: {len(review.age_rating)} age rating answers, review notes "
                f"{len(review.review_notes.encode('utf-8'))} bytes, {len(review.subscription)} subscription locales."
            )
            return 0
        key_id, issuer_id, key_b64 = dist.read_api_credentials()
        with dist.temporary_key_file(key_id, key_b64) as key_file:
            client = dist.AscClient(key_id=key_id, issuer_id=issuer_id, key_file=key_file)
            done = sync(
                client,
                listing,
                shots,
                args.apply,
                args.bundle_id,
                review=review,
                marketing_version=review_mod.read_marketing_version(args.repo_root),
            )
            return 0 if done else 1
    except (ListingError, AscError) as exc:
        for line in str(exc).split("\n"):
            print(f"::error::{line}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
