#!/usr/bin/env python3
"""Unit tests for scripts/release/ios-testflight-notes.py."""

from __future__ import annotations

import importlib.util
import os
import unittest

_SCRIPT_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "ios-testflight-notes.py"
)
_SPEC = importlib.util.spec_from_file_location("ios_testflight_notes", _SCRIPT_PATH)
assert _SPEC and _SPEC.loader
notes_mod = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(notes_mod)


class ExtractWhatsNewTests(unittest.TestCase):
    def test_empty_or_none_returns_default(self) -> None:
        self.assertEqual(notes_mod.extract_whats_new(None), notes_mod.DEFAULT_WHATS_NEW)
        self.assertEqual(notes_mod.extract_whats_new(""), notes_mod.DEFAULT_WHATS_NEW)
        self.assertEqual(notes_mod.extract_whats_new("   \n\n"), notes_mod.DEFAULT_WHATS_NEW)

    def test_pr_without_testflight_section_returns_default(self) -> None:
        body = (
            "## Summary\n"
            "- Refactored internal API client\n\n"
            "## Testing\n"
            "- Ran unit tests\n"
        )
        self.assertEqual(notes_mod.extract_whats_new(body), notes_mod.DEFAULT_WHATS_NEW)

    def test_extracts_testflight_section_and_stops_at_next_heading(self) -> None:
        body = (
            "## Summary\n"
            "Internal refactor + new feature.\n\n"
            "## TestFlight\n"
            "- Added voice input in chat\n"
            "- Improved PDF attachment previews\n\n"
            "### Known Issues\n"
            "- Landscape layout is still being refined\n\n"
            "## Verification\n"
            "- npm test\n"
        )
        expected = (
            "- Added voice input in chat\n"
            "- Improved PDF attachment previews\n\n"
            "### Known Issues\n"
            "- Landscape layout is still being refined"
        )
        self.assertEqual(notes_mod.extract_whats_new(body), expected)

    def test_accepts_heading_variants_and_colon(self) -> None:
        for heading in (
            "## What to Test:",
            "### TestFlight Notes",
            "## Release Notes",
            "## 测试内容：",
        ):
            body = f"{heading}\nTry out the new whiteboard export.\n"
            self.assertEqual(
                notes_mod.extract_whats_new(body),
                "Try out the new whiteboard export.",
            )

    def test_ignores_headings_inside_fenced_code_blocks(self) -> None:
        body = (
            "## Summary\n"
            "```markdown\n"
            "## TestFlight\n"
            "Not a real section\n"
            "```\n\n"
            "## What to Test\n"
            "Real beta notes here.\n"
            "```\n"
            "## Verification\n"
            "still inside code block\n"
            "```\n"
            "## Verification\n"
            "Should not be included.\n"
        )
        expected = (
            "Real beta notes here.\n"
            "```\n"
            "## Verification\n"
            "still inside code block\n"
            "```"
        )
        self.assertEqual(notes_mod.extract_whats_new(body), expected)

    def test_strips_html_comments_and_handles_placeholders(self) -> None:
        for placeholder in ("None", "N/A", "default", "-", "无", "<!-- comment only -->"):
            body = f"## TestFlight\n{placeholder}\n"
            self.assertEqual(
                notes_mod.extract_whats_new(body), notes_mod.DEFAULT_WHATS_NEW
            )

    def test_truncates_to_4000_chars(self) -> None:
        long_text = "A" * 4500
        result = notes_mod.extract_whats_new(f"## TestFlight\n{long_text}\n")
        self.assertEqual(len(result), 4000)
        self.assertTrue(result.endswith("..."))


if __name__ == "__main__":
    unittest.main()
