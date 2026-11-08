#!/usr/bin/env python3
"""Focused content-preservation checks: python3 docs/test-export-wizard-docs.py."""
import importlib.util
from pathlib import Path
import re
import sys
import unittest
from urllib.parse import urljoin, urlparse

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("export_docs", Path(__file__).with_name("export-wizard-docs.py"))
export = importlib.util.module_from_spec(spec)
spec.loader.exec_module(export)


class DocumentationExport(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = export.build()

    def test_complete_original_guides_are_preserved_exactly(self):
        for path in self.content["sources"]:
            chapters = sorted((c for c in self.content["chapters"] if c["source"] == path and "sourceStart" in c), key=lambda c: c["sourceStart"])
            self.assertEqual("".join(c["markdown"] for c in chapters), (export.ROOT / path).read_text(), path)

    def test_linked_markdown_guides_are_bundled(self):
        sources = set(self.content["sources"])
        for chapter in self.content["chapters"]:
            for link in re.findall(r"(?<!!)\[[^\]]*\]\(([^)]+)\)", chapter["markdown"]):
                parsed = urlparse(link)
                if parsed.scheme or not parsed.path.endswith(".md"):
                    continue
                target = urlparse(urljoin("https://docs.invalid/" + chapter["source"], link)).path.lstrip("/")
                self.assertIn(target, sources, f"{chapter['source']}: {link}")

    def test_screenshots_are_bundled_and_shell_comments_are_not_headings(self):
        self.assertGreaterEqual(len(self.content["images"]), 8)
        self.assertFalse(any("Only for a confirmed failure" in h["title"] for c in self.content["chapters"] for h in c["headings"]))
        self.assertEqual(len(list(export.headings("# Title\n```bash\n# comment\n```\n## Next\n"))), 2)

    def test_no_private_tracker_or_instance_address_leaks(self):
        for chapter in self.content["chapters"]:
            self.assertNotRegex(chapter["markdown"], r"gitlab\.system-bootstrapper\.com|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+")


if __name__ == "__main__":
    unittest.main()
