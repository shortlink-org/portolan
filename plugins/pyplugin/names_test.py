"""A name in the source, as the id the catalog gives it."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import names  # noqa: E402


class Slug(unittest.TestCase):
    def test_camel_case_breaks_at_a_word_and_an_acronym_stays_whole(self):
        self.assertEqual(names.slug("PriceList"), "price-list")
        self.assertEqual(names.slug("Address"), "address")
        self.assertEqual(names.slug("ID"), "id")
        self.assertEqual(names.slug("HTTPClient"), "http-client")

    def test_a_dotted_or_snake_name_is_dashed_and_runs_are_folded(self):
        self.assertEqual(names.slug("email.Address"), "email-address")
        self.assertEqual(names.slug("price_list"), "price-list")
        self.assertEqual(names.slug("_private__name_"), "private-name")


class Camel(unittest.TestCase):
    def test_a_function_name_becomes_an_operation_id(self):
        self.assertEqual(names.camel("issue_invoice"), "IssueInvoice")
        self.assertEqual(names.camel("close-stale-drafts"), "CloseStaleDrafts")
        self.assertEqual(names.camel("__init__"), "Init")


class Title(unittest.TestCase):
    def test_a_directory_name_is_a_human_name(self):
        self.assertEqual(names.title("price_list"), "Price List")
        self.assertEqual(names.title("oms"), "Oms")


if __name__ == "__main__":
    unittest.main()
