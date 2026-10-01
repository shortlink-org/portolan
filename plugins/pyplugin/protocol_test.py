"""The plugin protocol: what the request carries, and how a path is spelled back."""

import os
import sys
import unittest
from dataclasses import dataclass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from protocol import Builder, File, Input, read_options  # noqa: E402


class Paths(unittest.TestCase):
    def test_a_workspace_path_is_from_the_working_directory_with_forward_slashes(self):
        inp = Input.of({"root": "services/geo"})
        self.assertEqual(inp.repository, "")
        self.assertEqual(inp.repository_path(os.path.join("/w", "services", "geo", "views.py"), "/w"), "services/geo/views.py")

    def test_a_fetched_copy_is_spelled_from_its_own_repository(self):
        inp = Input.of({"root": "vendor/repos/acme/shop/geo", "repository": "vendor/repos/acme/shop/"})
        self.assertEqual(inp.repository_path("/w/vendor/repos/acme/shop/geo/views.py", "/w"), "geo/views.py")
        self.assertEqual(inp.repository_path("/w/vendor/repos/acme/shop", "/w"), "")

    def test_a_path_outside_the_copy_keeps_the_workspace_spelling(self):
        inp = Input.of({"root": "vendor/repos/acme/shop/geo", "repository": "vendor/repos/acme/shop"})
        self.assertEqual(inp.repository_path("/w/proto/shop.proto", "/w"), "proto/shop.proto")

    def test_a_dot_repository_is_the_workspace(self):
        self.assertEqual(Input.of({"repository": "."}).repository_path("/w/a.py", "/w"), "a.py")

    def test_nothing_sent_is_an_empty_input(self):
        self.assertEqual(Input.of(None), Input())


class Options(unittest.TestCase):
    def setUp(self):
        @dataclass
        class Opts:
            context: str = ""
            settings_module: str = ""

        self.Opts = Opts
        self.keys = {"context": "context", "settings": "settings_module"}

    def test_an_option_lands_on_the_field_that_holds_it(self):
        opts = read_options(self.Opts(), self.keys, {"context": "shop", "settings": "config.settings"})
        self.assertEqual((opts.context, opts.settings_module), ("shop", "config.settings"))

    def test_an_option_nobody_reads_is_refused_rather_than_dropped(self):
        with self.assertRaises(ValueError) as caught:
            read_options(self.Opts(), self.keys, {"setings": "config.settings"})
        self.assertIn("setings", str(caught.exception))

    def test_no_options_leaves_the_defaults(self):
        self.assertEqual(read_options(self.Opts(), self.keys, None), self.Opts())


class Output(unittest.TestCase):
    def test_the_response_carries_the_files_and_keeps_the_warnings_beside_them(self):
        b = Builder()
        b.files.append(File("geo.json", "{}"))
        b.warn("shop.geo", "nothing under geo/")
        self.assertEqual(b.response(), {"files": [{"name": "geo.json", "contents": "{}"}]})
        self.assertEqual([(w.severity, w.ref, w.message) for w in b.warnings], [("warning", "shop.geo", "nothing under geo/")])


if __name__ == "__main__":
    unittest.main()
