#!/usr/bin/env python3
"""Extract TestFlight 'What to Test' notes from a merged PR description.

Reads the PR body from --pr-body-file (or stdin) and looks for a dedicated
TestFlight Markdown section (e.g. `## TestFlight` or `## What to Test`). If no
custom user-facing notes are present (or the section is a placeholder like
`none` / `N/A`), falls back to a generic beta-testing message.

Strips HTML comments outside fenced code blocks before heading detection so
commented-out template sections are never published, and strips characters
rejected by App Store Connect `whatsNew` (such as `<`, `>`, and non-BMP emoji).
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


def _strip_html_comments_outside_fences(text: str) -> str:
    """Remove HTML comments while preserving fenced code blocks intact."""
    lines = text.split("\n")
    segments: list[tuple[bool, list[str]]] = []
    in_fence = False
    fence_char = ""
    fence_len = 0

    for line in lines:
        fence_match = _FENCE_RE.match(line)
        is_fence_line = False
        if fence_match:
            marker = fence_match.group(1)
            if not in_fence:
                in_fence = True
                fence_char = marker[0]
                fence_len = len(marker)
                is_fence_line = True
            elif marker[0] == fence_char and len(marker) >= fence_len:
                in_fence = False
                fence_char = ""
                fence_len = 0
                is_fence_line = True

        in_code = in_fence or is_fence_line
        if segments and segments[-1][0] == in_code:
            segments[-1][1].append(line)
        else:
            segments.append((in_code, [line]))

    out_parts: list[str] = []
    for is_code, seg_lines in segments:
        chunk = "\n".join(seg_lines)
        if not is_code:
            chunk = _HTML_COMMENT_RE.sub("", chunk)
        out_parts.append(chunk)
    return "\n".join(out_parts)


def _sanitize_asc_text(text: str) -> str:
    """Remove characters rejected by App Store Connect TestFlight `whatsNew`."""
    cleaned_chars: list[str] = []
    for ch in text:
        code = ord(ch)
        # App Store Connect rejects 4-byte UTF-8 (non-BMP emoji) and angle brackets.
        if code > 0xFFFF or ch in ("<", ">", "\u200d", "\ufe0e", "\ufe0f"):
            continue
        cleaned_chars.append(ch)
    cleaned = "".join(cleaned_chars)
    cleaned_lines = [re.sub(r"[ \t]{2,}", " ", ln).rstrip() for ln in cleaned.split("\n")]
    cleaned = "\n".join(cleaned_lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned


def extract_whats_new(pr_body: str | None) -> str:
    """Return user-facing TestFlight notes from a PR body, or the default."""
    if not pr_body:
        return DEFAULT_WHATS_NEW

    normalized = pr_body.replace("\r\n", "\n").replace("\r", "\n")
    without_comments = _strip_html_comments_outside_fences(normalized)
    lines = without_comments.split("\n")

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

    sanitized = _sanitize_asc_text("\n".join(captured_lines))
    if _is_placeholder(sanitized):
        return DEFAULT_WHATS_NEW

    return _truncate(sanitized)


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
