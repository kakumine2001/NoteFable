#!/usr/bin/env python3
"""Extract TestFlight 'What to Test' notes from a merged PR description.

Reads the PR body from --pr-body-file (or stdin) and looks for a dedicated
Markdown section (e.g. `## TestFlight` or `## What to Test`). If no custom
user-facing notes are present (or the section is a placeholder like `none` /
`N/A`), falls back to a generic beta-testing message.
"""

from __future__ import annotations

import argparse
import re
import sys

DEFAULT_WHATS_NEW = (
    "Bug fixes and improvements in this beta build. "
    "Please report any issues via TestFlight feedback."
)

MAX_WHATS_NEW_LENGTH = 4000

ACCEPTED_HEADINGS = {
    "testflight",
    "testflight notes",
    "what to test",
    "release notes",
    "测试内容",
    "测试说明",
}

PLACEHOLDER_VALUES = {
    "",
    "none",
    "n/a",
    "na",
    "default",
    "-",
    "—",
    "–",
    "tbd",
    "todo",
    "无",
    "暂无",
    "同上",
}

_ATX_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
_FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})")
_HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)


def _normalize_heading(raw_title: str) -> str:
    cleaned = raw_title.strip().rstrip(":：").strip()
    return re.sub(r"\s+", " ", cleaned).lower()


def _is_placeholder(text: str) -> bool:
    normalized = re.sub(r"[\s.。!！]+", "", text).lower()
    return normalized in PLACEHOLDER_VALUES


def _truncate(text: str, limit: int = MAX_WHATS_NEW_LENGTH) -> str:
    if len(text) <= limit:
        return text
    return text[: limit - 3].rstrip() + "..."


def extract_whats_new(pr_body: str | None) -> str:
    """Return user-facing TestFlight notes from a PR body, or the default."""
    if not pr_body:
        return DEFAULT_WHATS_NEW

    normalized = pr_body.replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.split("\n")

    in_fence = False
    fence_char = ""
    fence_len = 0

    capturing = False
    capture_level = 0
    captured_lines: list[str] = []

    for line in lines:
        fence_match = _FENCE_RE.match(line)
        if fence_match:
            marker = fence_match.group(1)
            if not in_fence:
                in_fence = True
                fence_char = marker[0]
                fence_len = len(marker)
            elif marker[0] == fence_char and len(marker) >= fence_len:
                in_fence = False
                fence_char = ""
                fence_len = 0
            if capturing:
                captured_lines.append(line)
            continue

        if not in_fence:
            heading_match = _ATX_HEADING_RE.match(line)
            if heading_match:
                level = len(heading_match.group(1))
                title = _normalize_heading(heading_match.group(2))
                if capturing:
                    if level <= capture_level:
                        break
                    captured_lines.append(line)
                    continue
                if level <= 4 and title in ACCEPTED_HEADINGS:
                    capturing = True
                    capture_level = level
                    continue

        if capturing:
            captured_lines.append(line)

    if not capturing:
        return DEFAULT_WHATS_NEW

    raw_section = "\n".join(captured_lines)
    raw_section = _HTML_COMMENT_RE.sub("", raw_section)
    raw_section = re.sub(r"\n{3,}", "\n\n", raw_section).strip()

    if _is_placeholder(raw_section):
        return DEFAULT_WHATS_NEW

    return _truncate(raw_section)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Extract TestFlight 'What to Test' notes from a PR body."
    )
    parser.add_argument(
        "--pr-body-file",
        help="Path to a UTF-8 file containing the PR body. Reads stdin if omitted.",
    )
    args = parser.parse_args(argv)

    if args.pr_body_file:
        with open(args.pr_body_file, "r", encoding="utf-8") as fh:
            pr_body = fh.read()
    else:
        pr_body = sys.stdin.read()

    sys.stdout.write(extract_whats_new(pr_body) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
