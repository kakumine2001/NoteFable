#!/usr/bin/env python3
"""The submission information part of ios-store-listing.py (which is the script to run).

  - reads docs/app-store/review-info.md
  - plans and writes the age rating answers, the App Review notes, the copyright, the display names
    and descriptions of the existing subscription group and monthly product, and the TestFlight beta
    app description (that one only while none is set)
  - audits, read-only, what App Store Connect still misses for a submission

The repository and its Actions logs are public: personal data held by App Store Connect (review
contact, demo account, feedback email) is only ever reported as set or not set, and the current
values of free-text records that may hold it (review notes, copyright, beta description) are never
printed.

Also home to the few helpers both files share, so that there is one AscError and one ListingError.
"""

from __future__ import annotations

import http.client
import importlib.util
import re
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

_DIST_SPEC = importlib.util.spec_from_file_location(
    "ios_testflight_distribute",
    Path(__file__).resolve().with_name("ios-testflight-distribute.py"),
)
dist = importlib.util.module_from_spec(_DIST_SPEC)
_DIST_SPEC.loader.exec_module(dist)
AscError = dist.AscError

REVIEW_DOC = "docs/app-store/review-info.md"
PROJECT_FILE = "mobile/ios/project.yml"
SUBSCRIPTION_PRODUCT_ID = "com.kakumine.notefable.pro.monthly"
BETA_LOCALE = "en-US"
# Subscription metadata v2 lives outside the client's /v1 base, so its paths are full URLs.
ASC_V2 = dist.ASC_API_BASE.rsplit("/", 1)[0] + "/v2"

AGE_RATING_BOOLEANS = (
    "advertising",
    "ageAssurance",
    "datingAndRelationships",
    "gambling",
    "healthOrWellnessTopics",
    "lootBox",
    "messagingAndChat",
    "parentalControls",
    "sharedLocation",
    "socialMedia",
    "socialMediaAgeRestricted",
    "unrestrictedWebAccess",
    "userGeneratedContent",
)
AGE_RATING_FREQUENCIES = (
    "alcoholTobaccoOrDrugUseOrReferences",
    "contests",
    "gamblingSimulated",
    "gunsOrOtherWeapons",
    "horrorOrFearThemes",
    "matureOrSuggestiveThemes",
    "medicalOrTreatmentInformation",
    "profanityOrCrudeHumor",
    "sexualContentGraphicAndNudity",
    "sexualContentOrNudity",
    "violenceCartoonOrFantasy",
    "violenceRealistic",
    "violenceRealisticProlongedGraphicOrSadistic",
)
AGE_RATING_ATTRIBUTES = AGE_RATING_BOOLEANS + AGE_RATING_FREQUENCIES
FREQUENCIES = ("NONE", "INFREQUENT", "FREQUENT")
# Deprecated values an earlier answer may still hold; they mean the same.
_OLD_FREQUENCIES = {"INFREQUENT_OR_MILD": "INFREQUENT", "FREQUENT_OR_INTENSE": "FREQUENT"}

REVIEW_NOTES_MAX_BYTES = 4000
BETA_DESCRIPTION_MAX = 4000
DISPLAY_NAME_MIN, DISPLAY_NAME_MAX = 2, 30
# Apple publishes no limit for subscription descriptions (45 is its in-app purchase limit); 55 is
# the counter of the App Store Connect form. Sources in docs/app-store/review-info.md.
SUBSCRIPTION_DESCRIPTION_MAX = 55
EDITABLE_SUBSCRIPTION_VERSION = "PREPARE_FOR_SUBMISSION"
REPLACED_SUBSCRIPTION_VERSION = "REPLACED_WITH_NEW_VERSION"
# Review is over for these, so changed texts go into a new draft. In any other state Apple still
# holds the version, and nothing is written.
FINISHED_SUBSCRIPTION_VERSIONS = frozenset(
    {"APPROVED", "REJECTED", "DEVELOPER_REJECTED", REPLACED_SUBSCRIPTION_VERSION}
)

# The subscription states that need nothing more before or during review. Anything else, removed from
# sale included, is reported as missing.
SUBMITTABLE_SUBSCRIPTION_STATES = frozenset(
    {"READY_TO_SUBMIT", "WAITING_FOR_REVIEW", "IN_REVIEW", "PENDING_BINARY_APPROVAL", "APPROVED"}
)

CONTACT_FIELDS = ("contactFirstName", "contactLastName", "contactPhone", "contactEmail")
DEMO_FIELDS = ("demoAccountName", "demoAccountPassword")
# What may stand between the digit groups of a phone number (not a line break).
_PHONE_GAP = r"[ \t\u00a0\u3000().\-\u2010-\u2015\u2212\uff08\uff09\uff0d]"
_PERSONAL_DATA = (
    re.compile(r"[\w.+-]+@[\w-]+\.\w+"),
    re.compile(r"\+\d[\d\s().-]{7,}"),
    # Domestic formats (090-1234-5678, (555) 123-4567) and bare runs: 9 digits or more, so that a
    # date such as 2026-11-27 passes.
    re.compile(rf"\d(?:{_PHONE_GAP}{{0,3}}\d){{8,}}"),
)


# --- Shared helpers ----------------------------------------------------------------------------


class ListingError(ValueError):
    """The documents or screenshots can't be turned into a listing."""


class WriteRefused(AscError):
    """The listing script's own guard refused a request: nothing was sent."""


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8-sig")
    except OSError as exc:
        raise ListingError(f"Can't read {path}: {exc}") from exc


def sections(text: str, source: str) -> dict[str, list[str]]:
    """Level-2 headings and their lines."""
    found: dict[str, list[str]] = {}
    current: list[str] | None = None
    for line in text.splitlines():
        match = re.match(r"^## +(.*\S)\s*$", line)
        if match:
            heading = match.group(1)
            if heading in found:
                raise ListingError(f"{source}: duplicate section '## {heading}'.")
            current = found[heading] = []
        elif current is not None:
            current.append(line.rstrip())
    return found


def get_all(client: Any, path: str) -> tuple[list[dict], list[dict]]:
    """All data and included resources of a paginated collection."""
    data: list[dict] = []
    included: list[dict] = []
    next_url: str | None = path
    while next_url:
        response = client.request("GET", next_url) or {}
        data.extend(response.get("data") or [])
        included.extend(response.get("included") or [])
        next_url = (response.get("links") or {}).get("next")
    return data, included


def attributes(resource: dict) -> dict:
    return resource.get("attributes") or {}


def normalized(value: str | None) -> str:
    return (value or "").replace("\r\n", "\n").strip()


def _get_one(client: Any, path: str) -> dict | None:
    """A to-one relationship: None when there is none (404 or an empty answer)."""
    data = (client.request("GET", path, allow_404=True) or {}).get("data")
    return data if isinstance(data, dict) else None


def _body(resource_type: str, values: dict | None = None, resource_id: str | None = None, **related) -> dict:
    data: dict[str, Any] = {"type": resource_type}
    if resource_id:
        data["id"] = resource_id
    if values:
        data["attributes"] = values
    if related:
        data["relationships"] = {
            name: {"data": {"type": kind, "id": target}} for name, (kind, target) in related.items()
        }
    return {"data": data}


def _without_details(action):
    """Run a request on a record that holds personal data: Apple's error text may repeat a value.

    Only the status, the error codes and the field pointers are kept. A request that App Store
    Connect never answered keeps its kind of cause, which repeats nothing of the record.
    """
    try:
        return action()
    except AscError as exc:
        if isinstance(exc, WriteRefused):
            raise WriteRefused("refused by the write guard") from None
        if exc.status is None and isinstance(exc.__cause__, (OSError, http.client.HTTPException)):
            raise AscError("network error") from None
        errors = exc.body.get("errors") if isinstance(exc.body, dict) else None
        kept = []
        for error in errors or []:
            if not isinstance(error, dict):
                continue
            source = error.get("source")
            pointer = str(source.get("pointer") or "") if isinstance(source, dict) else ""
            if not re.fullmatch(r"(/[A-Za-z]+)+", pointer):
                pointer = ""
            kept.append({"code": str(error.get("code") or ""), "source": {"pointer": pointer}})
        details = ", ".join(" at ".join(p for p in (e["code"], e["source"]["pointer"]) if p) for e in kept)
        status = f"HTTP {exc.status}" if exc.status else "request failed"
        message = f"{status}{f' {details}' if details else ''} (details hidden: the record holds personal data)"
        raise AscError(message, status=exc.status, body={"errors": kept}) from None


def _asks_for_a_contact(exc: AscError) -> bool:
    """Every error of a sanitized refusal points at an App Review contact field."""
    errors = exc.body.get("errors") if isinstance(exc.body, dict) else None
    return bool(errors) and all(e["source"]["pointer"].startswith("/data/attributes/contact") for e in errors)


# --- The document ------------------------------------------------------------------------------


@dataclass(frozen=True)
class SubscriptionText:
    group_name: str
    name: str
    description: str


@dataclass(frozen=True)
class ReviewInfo:
    age_rating: dict[str, Any]
    review_notes: str
    copyright: str
    beta_description: str
    subscription: dict[str, SubscriptionText]  # App Store locale -> texts


def _table(lines: list[str], header: tuple[str, ...], what: str) -> list[list[str]]:
    rows = [[cell.strip() for cell in line.strip().strip("|").split("|")] for line in lines if line.startswith("|")]
    if len(rows) < 3 or tuple(rows[0]) != header:
        raise ListingError(f"{REVIEW_DOC}: '## {what}' needs a table with the columns {', '.join(header)}.")
    for row in rows[2:]:
        if len(row) != len(header) or not all(row):
            raise ListingError(f"{REVIEW_DOC}: bad row in '## {what}': {' | '.join(row)}")
    return rows[2:]


def _block(found: dict[str, list[str]], heading: str) -> str:
    text = "\n".join(found.get(heading) or [])
    blocks = re.findall(r"(?ms)^```text\n(.*?)\n```$", text)
    if len(blocks) != 1 or not blocks[0].strip():
        raise ListingError(f"{REVIEW_DOC}: '## {heading}' needs exactly one ```text block.")
    return blocks[0].strip()


def parse_review_info(text: str, languages: tuple) -> ReviewInfo:
    """languages: the listing script's (App Store locales, section heading, Play code) rows."""
    found = sections(text, REVIEW_DOC)
    problems: list[str] = []

    age: dict[str, Any] = {}
    for name, value, _reason in _table(found.get("年龄分级") or [], ("字段", "值", "依据"), "年龄分级"):
        name = name.strip("`")
        if name in age:
            problems.append(f"age rating: {name} appears twice")
        if name in AGE_RATING_BOOLEANS and value in ("true", "false"):
            age[name] = value == "true"
        elif name in AGE_RATING_FREQUENCIES and value in FREQUENCIES:
            age[name] = value
        else:
            problems.append(f"age rating: {name} = {value} is not a known attribute and value")
    missing = [name for name in AGE_RATING_ATTRIBUTES if name not in age]
    if missing:
        problems.append(f"age rating: no answer for {', '.join(missing)}")

    notes = _block(found, "审核备注")
    copyright_text = _block(found, "版权")
    beta = _block(found, "TestFlight 测试版说明")
    size = len(notes.encode("utf-8"))
    if size > REVIEW_NOTES_MAX_BYTES:
        problems.append(f"review notes are {size} UTF-8 bytes (limit {REVIEW_NOTES_MAX_BYTES})")
    if len(beta) > BETA_DESCRIPTION_MAX:
        problems.append(f"beta app description is {len(beta)} characters (limit {BETA_DESCRIPTION_MAX})")
    if not re.fullmatch(r"\d{4} \S[^\n]*", copyright_text):
        problems.append("copyright must be one line: the year, then the owner's name")
    for label, value in (("review notes", notes), ("beta app description", beta)):
        if any(pattern.search(value) for pattern in _PERSONAL_DATA):
            problems.append(f"{label} look like they hold an email address or phone number")

    rows = _table(found.get("订阅") or [], ("语言", "订阅组显示名", "订阅显示名", "订阅描述"), "订阅")
    by_heading = {row[0]: SubscriptionText(*row[1:]) for row in rows}
    headings = [heading for _, heading, _ in languages]
    if sorted(row[0] for row in rows) != sorted(headings):
        problems.append(f"subscription table needs exactly one row for each of: {', '.join(headings)}")
    for heading, texts in by_heading.items():
        for label, value in (("group display name", texts.group_name), ("display name", texts.name)):
            if not DISPLAY_NAME_MIN <= len(value) <= DISPLAY_NAME_MAX:
                problems.append(f"{heading}: subscription {label} is {len(value)} characters (allowed {DISPLAY_NAME_MIN}-{DISPLAY_NAME_MAX})")
        if len(texts.description) > SUBSCRIPTION_DESCRIPTION_MAX:
            problems.append(f"{heading}: subscription description is {len(texts.description)} characters (limit {SUBSCRIPTION_DESCRIPTION_MAX})")
    if problems:
        raise ListingError("\n".join(f"{REVIEW_DOC}: {problem}" for problem in problems))
    return ReviewInfo(
        age_rating=age,
        review_notes=notes,
        copyright=copyright_text,
        beta_description=beta,
        subscription={locale: by_heading[heading] for locales, heading, _ in languages for locale in locales},
    )


def load_review_info(repo_root: Path, languages: tuple) -> ReviewInfo:
    return parse_review_info(read_text(repo_root / REVIEW_DOC), languages)


def read_marketing_version(repo_root: Path) -> str | None:
    try:
        text = read_text(repo_root / PROJECT_FILE)
    except ListingError:
        return None
    found = re.findall(r"""(?m)^\s*MARKETING_VERSION\s*:\s*["']?([0-9][0-9.]*)["']?\s*(?:#.*)?$""", text)
    return found[0] if len(found) == 1 else None


# --- Reading subscriptions ---------------------------------------------------------------------


def find_subscription(client: Any, app_id: str) -> tuple[dict | None, dict | None]:
    """The existing (subscription group, monthly subscription), or (None, None)."""
    groups, _ = get_all(client, f"/apps/{app_id}/subscriptionGroups?limit=50")
    for group in groups:
        products, _ = get_all(client, f"/subscriptionGroups/{group['id']}/subscriptions?limit=50")
        for product in products:
            if attributes(product).get("productId") == SUBSCRIPTION_PRODUCT_ID:
                return group, product
    return None, None


# resource type -> (what it is, version resource type, localization type, attributes written)
_SUBSCRIPTION_KINDS = {
    "subscriptionGroups": (
        "subscription group",
        "subscriptionGroupVersions",
        "subscriptionGroupLocalizations",
        ("name",),
    ),
    "subscriptions": (
        "subscription",
        "subscriptionVersions",
        "subscriptionLocalizations",
        ("name", "description"),
    ),
}


def _versions(client: Any, kind: str, parent_id: str) -> list[dict]:
    return get_all(client, f"/{kind}/{parent_id}/versions?limit=50")[0]


def _version_localizations(client: Any, kind: str, version_id: str) -> dict[str, dict]:
    version_type = _SUBSCRIPTION_KINDS[kind][1]
    items, _ = get_all(client, f"/{version_type}/{version_id}/localizations?limit=50")
    return {attributes(item).get("locale"): item for item in items}


def _current_version(versions: list[dict]) -> dict | None:
    """The draft, else the newest version that has not been replaced."""
    live = [v for v in versions if attributes(v).get("state") != REPLACED_SUBSCRIPTION_VERSION]
    for version in live:
        if attributes(version).get("state") == EDITABLE_SUBSCRIPTION_VERSION:
            return version
    return max(live, key=lambda v: attributes(v).get("version") or 0, default=None)


# --- Planning ----------------------------------------------------------------------------------


@dataclass
class TextChange:
    locale: str
    desired: dict[str, str]
    resource_id: str | None = None
    current: dict[str, Any] = field(default_factory=dict)

    @property
    def changes(self) -> dict[str, str]:
        return {k: v for k, v in self.desired.items() if normalized(self.current.get(k)) != normalized(v)}


@dataclass
class SubscriptionPlan:
    kind: str  # subscriptionGroups or subscriptions
    parent_id: str
    version_id: str | None  # the draft; None with blocked None: one is created
    texts: list[TextChange]
    blocked: str | None = None
    replaces: str | None = None  # state of the compared version when it is not a draft

    @property
    def pending(self) -> list[TextChange]:
        return [] if self.blocked else [t for t in self.texts if t.resource_id is None or t.changes]


@dataclass
class ReviewPlan:
    version_id: str
    app_id: str
    age_id: str | None = None
    age_changes: dict[str, tuple[Any, Any]] = field(default_factory=dict)
    notes: tuple[str | None, str] | None = None  # (current, new); None: not readable
    detail_id: str | None = None
    copyright: tuple[str | None, str] | None = None
    subscriptions: list[SubscriptionPlan] = field(default_factory=list)
    beta: tuple[str | None, str] | None = None
    beta_id: str | None = None
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)  # sections that could not be read

    @property
    def notes_changed(self) -> bool:
        return self.notes is not None and normalized(self.notes[0]) != normalized(self.notes[1])

    @property
    def copyright_changed(self) -> bool:
        return self.copyright is not None and normalized(self.copyright[0]) != normalized(self.copyright[1])

    @property
    def beta_changed(self) -> bool:
        # Only filled in: a description someone already wrote is never replaced.
        return self.beta is not None and not normalized(self.beta[0])


def _plan_age_rating(client: Any, info: ReviewInfo, plan: ReviewPlan, app_info_id: str) -> None:
    declaration = _get_one(client, f"/appInfos/{app_info_id}/ageRatingDeclaration")
    if not declaration:
        plan.warnings.append("The app info has no age rating declaration; the age rating is skipped.")
        return
    plan.age_id = declaration["id"]
    current = attributes(declaration)
    plan.age_changes = {
        name: (current.get(name), value)
        for name, value in info.age_rating.items()
        if _OLD_FREQUENCIES.get(current.get(name), current.get(name)) != value
    }


def _plan_notes(client: Any, info: ReviewInfo, plan: ReviewPlan) -> None:
    path = f"/appStoreVersions/{plan.version_id}/appStoreReviewDetail"
    detail = _without_details(lambda: _get_one(client, path))
    plan.detail_id = detail["id"] if detail else None
    plan.notes = (attributes(detail or {}).get("notes"), info.review_notes)


def _plan_subscription(client: Any, kind: str, parent_id: str, desired: dict, plan: ReviewPlan) -> None:
    label = _SUBSCRIPTION_KINDS[kind][0]
    versions = _versions(client, kind, parent_id)
    current = _current_version(versions)
    state = attributes(current or {}).get("state")
    draft = current["id"] if current and state == EDITABLE_SUBSCRIPTION_VERSION else None
    texts = [TextChange(locale, values) for locale, values in desired.items()]
    result = SubscriptionPlan(kind, parent_id, draft, texts)
    if current:
        existing = _version_localizations(client, kind, current["id"])
        for text in texts:
            item = existing.get(text.locale)
            text.resource_id = item["id"] if item else None
            text.current = attributes(item) if item else {}
    if current and not draft:
        result.replaces = str(state)
        states = {str(attributes(v).get("state")) for v in versions}
        if result.pending and not states <= FINISHED_SUBSCRIPTION_VERSIONS:
            result.blocked = f"no editable {label} version (states: {', '.join(sorted(states))})"
            plan.warnings.append(f"{result.blocked}; its texts differ from the document and are left unchanged.")
    plan.subscriptions.append(result)


def _plan_subscriptions(client: Any, info: ReviewInfo, plan: ReviewPlan) -> None:
    group, product = find_subscription(client, plan.app_id)
    if not group or not product:
        plan.warnings.append(
            f"No subscription {SUBSCRIPTION_PRODUCT_ID} on App Store Connect; its texts are skipped "
            "(this script never creates products)."
        )
        return
    group_texts = {locale: {"name": t.group_name} for locale, t in info.subscription.items()}
    product_texts = {
        locale: {"name": t.name, "description": t.description} for locale, t in info.subscription.items()
    }
    # Read and written independently: the log must say which of the two is left out.
    for kind, resource, desired in (
        ("subscriptionGroups", group, group_texts),
        ("subscriptions", product, product_texts),
    ):
        label = f"{_SUBSCRIPTION_KINDS[kind][0]} texts"
        _read_section(plan, label, lambda: _plan_subscription(client, kind, resource["id"], desired, plan))


def _read_section(plan: ReviewPlan, label: str, action) -> None:
    """Plan one section; one that can't be read is reported and not written."""
    try:
        action()
    except AscError as exc:
        if exc.status == 401:
            raise
        plan.errors.append(f"{label}: could not be read, not written: {exc}")


def _beta_localizations(client: Any, app_id: str) -> dict[str, dict]:
    items = _without_details(lambda: get_all(client, f"/apps/{app_id}/betaAppLocalizations?limit=50")[0])
    return {attributes(item).get("locale"): item for item in items}


def _plan_beta(client: Any, info: ReviewInfo, plan: ReviewPlan) -> None:
    item = _beta_localizations(client, plan.app_id).get(BETA_LOCALE)
    plan.beta_id = item["id"] if item else None
    plan.beta = (attributes(item or {}).get("description"), info.beta_description)


def plan_review(
    client: Any, info: ReviewInfo, app_id: str, version_id: str, app_info_id: str, current_copyright: str | None
) -> ReviewPlan:
    plan = ReviewPlan(version_id=version_id, app_id=app_id, copyright=(current_copyright, info.copyright))
    for label, action in (
        ("age rating", lambda: _plan_age_rating(client, info, plan, app_info_id)),
        ("review notes", lambda: _plan_notes(client, info, plan)),
        ("subscription group and subscription texts", lambda: _plan_subscriptions(client, info, plan)),
        ("beta app description", lambda: _plan_beta(client, info, plan)),
    ):
        _read_section(plan, label, action)
    return plan


# --- Report ------------------------------------------------------------------------------------


def _private_change(out, name: str, changed: bool, current: str | None, new: str) -> None:
    """A record that may hold personal data: say how it differs, show only the repository's value."""
    if not changed:
        out(f"  {name}: unchanged ({len(new)} characters)")
        return
    was = f"set, {len(current)} characters, not shown" if normalized(current) else "empty"
    out(f"  {name}: CHANGE (current: {was})")
    for line in new.split("\n"):
        out(f"      | {line}")


def print_review(plan: ReviewPlan, out=print) -> None:
    out("")
    out("Submission information")
    for error in plan.errors:
        out(f"::error::{error}")
    for warning in plan.warnings:
        out(f"::warning::{warning}")
    if plan.age_id:
        out(f"  age rating: {len(plan.age_changes)} answer(s) to change")
        for name, (current, new) in plan.age_changes.items():
            shown = "(unanswered)" if current is None else str(current).lower() if isinstance(current, bool) else current
            out(f"    {name}: {shown} -> {str(new).lower() if isinstance(new, bool) else new}")
    if plan.notes:
        _private_change(out, "review notes", plan.notes_changed, *plan.notes)
        if plan.notes_changed and not plan.detail_id:
            out("    (no review details yet: Apple may refuse them until the contact is entered)")
    if plan.copyright:
        _private_change(out, "copyright", plan.copyright_changed, *plan.copyright)
    for subscription in plan.subscriptions:
        label = _SUBSCRIPTION_KINDS[subscription.kind][0]
        if subscription.blocked:
            out(f"  {label}: {subscription.blocked}")
            continue
        if not subscription.pending:
            out(f"  {label} texts: unchanged ({len(subscription.texts)} locales)")
            continue
        if subscription.version_id is None:
            why = f"its version is {subscription.replaces}" if subscription.replaces else "has no version yet"
            out(f"  {label}: {why}, a draft metadata version will be created (submit it for review yourself)")
        for text in subscription.pending:
            for name, new in text.changes.items():
                current = normalized(text.current.get(name))
                out(f"  {label} [{text.locale}] {name}: CHANGE {current or '(empty)'} -> {new}")
    if plan.beta:
        name = f"TestFlight beta app description ({BETA_LOCALE})"
        if plan.beta_changed:
            _private_change(out, name, True, *plan.beta)
        else:
            stored, wanted = plan.beta
            differs = "differs from the document" if normalized(stored) != normalized(wanted) else "matches the document"
            out(f"  {name}: already set, kept (not shown; {differs})")
    out(
        "Submission summary: "
        f"{len(plan.age_changes)} age rating answers, "
        f"{int(plan.notes_changed)} review notes, {int(plan.copyright_changed)} copyright, "
        f"{sum(len(s.pending) for s in plan.subscriptions)} subscription localizations, "
        f"{int(plan.beta_changed)} beta description to write."
    )


# --- Writing -----------------------------------------------------------------------------------


def _write_age_rating(client: Any, plan: ReviewPlan, out) -> None:
    values = {name: new for name, (_, new) in plan.age_changes.items()}
    client.request(
        "PATCH",
        f"/ageRatingDeclarations/{plan.age_id}",
        payload=_body("ageRatingDeclarations", values, plan.age_id),
    )
    out(f"Updated the age rating: {len(values)} answer(s).")


def _write_notes(client: Any, plan: ReviewPlan, out) -> None:
    values = {"notes": plan.notes[1]}
    if plan.detail_id:
        payload = _body("appStoreReviewDetails", values, plan.detail_id)
        path = f"/appStoreReviewDetails/{plan.detail_id}"
        _without_details(lambda: client.request("PATCH", path, payload=payload))
    else:
        payload = _body(
            "appStoreReviewDetails", values, appStoreVersion=("appStoreVersions", plan.version_id)
        )
        try:
            _without_details(lambda: client.request("POST", "/appStoreReviewDetails", payload=payload))
        except AscError as exc:
            if exc.status != 409:
                raise
            if not _asks_for_a_contact(exc):
                # Some other refusal: a failure, with the likeliest remedy.
                raise AscError(
                    f"{exc}. If App Store Connect has no App Review contact yet, enter it there and run again.",
                    status=exc.status,
                ) from None
            out(
                "::warning::App Store Connect refused review notes without a contact. Enter the App Review "
                f"contact in App Store Connect, then run again. {exc}"
            )
            return
    out("Wrote the App Review notes.")


def _write_copyright(client: Any, plan: ReviewPlan, out) -> None:
    payload = _body("appStoreVersions", {"copyright": plan.copyright[1]}, plan.version_id)
    path = f"/appStoreVersions/{plan.version_id}"
    _without_details(lambda: client.request("PATCH", path, payload=payload))
    out("Wrote the copyright.")


def _write_subscription(client: Any, plan: SubscriptionPlan, attempt, out) -> None:
    label, version_type, localization_type, _ = _SUBSCRIPTION_KINDS[plan.kind]
    version_id = plan.version_id
    if version_id is None:
        parent = "subscriptionGroup" if plan.kind == "subscriptionGroups" else "subscription"
        payload = _body(version_type, **{parent: (plan.kind, plan.parent_id)})
        version_id = client.request("POST", f"/{version_type}", payload=payload)["data"]["id"]
        out(f"Created a draft {label} version.")
        # Apple may have filled the new version with the localizations that already existed.
        existing = _version_localizations(client, plan.kind, version_id)
        for text in plan.texts:
            item = existing.get(text.locale)
            text.resource_id = item["id"] if item else None
            text.current = attributes(item) if item else {}

    def write(text: TextChange) -> None:
        if text.resource_id is None:
            payload = _body(
                localization_type, {"locale": text.locale, **text.desired}, version=(version_type, version_id)
            )
            client.request("POST", f"{ASC_V2}/{localization_type}", payload=payload)
        else:
            payload = _body(localization_type, text.changes, text.resource_id)
            client.request("PATCH", f"{ASC_V2}/{localization_type}/{text.resource_id}", payload=payload)
        out(f"Wrote the {label} texts for {text.locale}.")

    for text in plan.texts:
        if text.resource_id is None or text.changes:
            attempt(f"{text.locale} {label} texts", lambda: write(text))


def _write_beta(client: Any, plan: ReviewPlan, out) -> None:
    description = plan.beta[1]
    if plan.beta_id:
        payload = _body("betaAppLocalizations", {"description": description}, plan.beta_id)
        path = f"/betaAppLocalizations/{plan.beta_id}"
        _without_details(lambda: client.request("PATCH", path, payload=payload))
    else:
        payload = _body(
            "betaAppLocalizations",
            {"locale": BETA_LOCALE, "description": description},
            app=("apps", plan.app_id),
        )
        _without_details(lambda: client.request("POST", "/betaAppLocalizations", payload=payload))
    out("Wrote the TestFlight beta app description.")


def apply_review(client: Any, plan: ReviewPlan, attempt, out=print) -> None:
    """attempt(label, action) records a failure and carries on, as the listing writes do."""
    if plan.age_changes:
        attempt("age rating", lambda: _write_age_rating(client, plan, out))
    if plan.notes_changed:
        attempt("review notes", lambda: _write_notes(client, plan, out))
    if plan.copyright_changed:
        attempt("copyright", lambda: _write_copyright(client, plan, out))
    for subscription in plan.subscriptions:
        if subscription.pending:
            label = _SUBSCRIPTION_KINDS[subscription.kind][0]
            attempt(f"{label} version", lambda: _write_subscription(client, subscription, attempt, out))
    if plan.beta_changed:
        attempt("beta app description", lambda: _write_beta(client, plan, out))


# --- Audit (read-only) -------------------------------------------------------------------------


def _set(value: Any) -> str:
    return "set" if value not in (None, "") else "not set"


def audit(
    client: Any,
    app_id: str,
    app_info_id: str | None,
    version_id: str | None,
    marketing_version: str | None,
    locales: list[str],
    out=print,
) -> None:
    """Print what a submission still misses. Only reads; personal data only as set / not set.

    app_info_id and version_id are None when there is no single one to check.
    """
    missing: list[str] = []
    unknown: list[str] = []

    def not_checked(text: str) -> None:
        out(f"  [unknown] {text}")
        unknown.append(text)

    def line(ok: bool, text: str) -> None:
        out(f"  [{'ok' if ok else 'MISSING'}] {text}")
        if not ok:
            missing.append(text)

    def check(label: str, action, needs: tuple = ()) -> None:
        if None in needs:
            not_checked(f"{label}: there is no single app info or iOS version to check")
            return
        try:
            action()
        except AscError as exc:
            # The status only: an error text could repeat a value of the record.
            not_checked(f"{label}: could not be read ({f'HTTP {exc.status}' if exc.status else 'request failed'})")

    version: dict = {}

    def read_version() -> None:
        version.update(attributes(_get_one(client, f"/appStoreVersions/{version_id}") or {}))

    def age_rating() -> None:
        declaration = _get_one(client, f"/appInfos/{app_info_id}/ageRatingDeclaration")
        current = attributes(declaration or {})
        unanswered = [name for name in AGE_RATING_ATTRIBUTES if current.get(name) is None]
        line(not unanswered, f"age rating: {'all answered' if not unanswered else 'unanswered: ' + ', '.join(unanswered)}")

    def review_details() -> None:
        detail = _get_one(client, f"/appStoreVersions/{version_id}/appStoreReviewDetail")
        values = attributes(detail or {})
        for name in CONTACT_FIELDS:
            line(bool(values.get(name)), f"App Review {name}: {_set(values.get(name))}")
        needs_demo = bool(values.get("demoAccountRequired"))
        demo = ", ".join(f"{name} {_set(values.get(name))}" for name in DEMO_FIELDS)
        line(
            not needs_demo,
            f"App Review demo account: {'marked as required (the app needs none)' if needs_demo else 'not required'}; {demo}",
        )
        line(bool(values.get("notes")), f"App Review notes: {_set(values.get('notes'))}")

    def content_rights() -> None:
        value = attributes(_get_one(client, f"/apps/{app_id}") or {}).get("contentRightsDeclaration")
        line(bool(value), f"content rights declaration: {value or 'not set (the owner answers it)'}")

    def version_fields() -> None:
        read_version()
        line(bool(version.get("copyright")), f"copyright: {_set(version.get('copyright'))}")
        number = version.get("versionString")
        if marketing_version is None:
            not_checked(f"version string {number}: MARKETING_VERSION could not be read from {PROJECT_FILE}")
        else:
            line(
                number == marketing_version,
                f"version string {number}, project MARKETING_VERSION {marketing_version}"
                + ("" if number == marketing_version else " (they must match to attach a build)"),
            )

    def build() -> None:
        found = _get_one(client, f"/appStoreVersions/{version_id}/build")
        number = attributes(found or {}).get("version")
        line(bool(found), f"build attached: {number or ('yes' if found else 'none')}")

    def price() -> None:
        schedule = _get_one(client, f"/apps/{app_id}/appPriceSchedule")
        prices = []
        if schedule:
            response = client.request("GET", f"/appPriceSchedules/{schedule['id']}/manualPrices?limit=1", allow_404=True)
            prices = (response or {}).get("data") or []
        line(bool(prices), f"app price: {'set' if prices else 'not set'}")

    def availability() -> None:
        found = _get_one(client, f"/apps/{app_id}/appAvailabilityV2")
        line(bool(found), f"app availability: {'set' if found else 'not set'}")

    def subscription() -> None:
        group, product = find_subscription(client, app_id)
        line(bool(group and product), f"subscription {SUBSCRIPTION_PRODUCT_ID}: {'present' if product else 'not found'}")
        if not group or not product:
            return
        state = attributes(product).get("state")
        line(state in SUBMITTABLE_SUBSCRIPTION_STATES, f"subscription state: {state}")
        for kind, resource in (("subscriptionGroups", group), ("subscriptions", product)):
            # Only the version that would be submitted counts, not what an older one had.
            current = _current_version(_versions(client, kind, resource["id"]))
            present = set(_version_localizations(client, kind, current["id"])) if current else set()
            lacking = [locale for locale in locales if locale not in present]
            label = _SUBSCRIPTION_KINDS[kind][0]
            line(
                not lacking,
                f"{label} localizations: {len(locales) - len(lacking)}/{len(locales)}"
                + (f" in the {attributes(current).get('state')} version" if current else "")
                + (f" (missing: {', '.join(lacking)})" if lacking else ""),
            )
        prices = client.request("GET", f"/subscriptions/{product['id']}/prices?limit=1", allow_404=True)
        has_price = bool((prices or {}).get("data"))
        line(has_price, f"subscription price: {'set' if has_price else 'not set'}")
        screenshot = _get_one(client, f"/subscriptions/{product['id']}/appStoreReviewScreenshot")
        line(bool(screenshot), f"subscription review screenshot: {_set(screenshot and screenshot.get('id'))}")
        check("subscription availability", lambda: subscription_availability(product["id"]))

    def subscription_availability(product_id: str) -> None:
        plans, _ = get_all(client, f"/subscriptions/{product_id}/planAvailabilities?limit=50")
        territories = False
        for plan in plans:
            path = f"/subscriptionPlanAvailabilities/{plan['id']}/availableTerritories?limit=1"
            territories = territories or bool((client.request("GET", path) or {}).get("data"))
        line(territories, f"subscription availability: {'set' if territories else 'not set'}")

    def beta() -> None:
        values = attributes(_get_one(client, f"/apps/{app_id}/betaAppReviewDetail") or {})
        for name in CONTACT_FIELDS:
            line(bool(values.get(name)), f"Beta App Review {name}: {_set(values.get(name))}")
        needs_demo = bool(values.get("demoAccountRequired"))
        demo = ", ".join(f"{name} {_set(values.get(name))}" for name in DEMO_FIELDS)
        line(
            not needs_demo,
            f"Beta App Review demo account: {'marked as required (the app needs none)' if needs_demo else 'not required'}; {demo}",
        )
        out(f"  [info] Beta App Review notes: {_set(values.get('notes'))}")
        localizations = _beta_localizations(client, app_id)
        item = attributes(localizations.get(BETA_LOCALE) or {})
        description = normalized(item.get("description"))
        line(bool(description), f"TestFlight beta app description ({BETA_LOCALE}): {_set(description)}")
        line(bool(item.get("feedbackEmail")), f"TestFlight feedback email ({BETA_LOCALE}): {_set(item.get('feedbackEmail'))}")

    out("")
    out("Submission audit (read-only)")
    for label, action, needs in (
        ("age rating", age_rating, (app_info_id,)),
        ("App Review details", review_details, (version_id,)),
        ("content rights", content_rights, ()),
        ("copyright and version string", version_fields, (version_id,)),
        ("build", build, (version_id,)),
        ("app price", price, ()),
        ("app availability", availability, ()),
        ("subscription", subscription, ()),
        ("TestFlight information", beta, ()),
    ):
        check(label, action, needs)
    out(f"Audit summary: {len(missing)} item(s) missing, {len(unknown)} check(s) unknown (not verified).")
    out(
        "Not visible to this script, check in App Store Connect: App Privacy answers, DSA trader status, "
        "agreements, banking and tax, and adding the first subscription to the version before submitting."
    )
