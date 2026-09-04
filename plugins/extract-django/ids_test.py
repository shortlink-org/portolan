import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ids  # noqa: E402


class Ids(unittest.TestCase):
    def test_slug_is_the_one_extract_go_makes(self):
        self.assertEqual(ids.slug("PriceList"), "price-list")
        self.assertEqual(ids.slug("Address"), "address")
        self.assertEqual(ids.slug("ID"), "id")
        self.assertEqual(ids.slug("email.Address"), "email-address")
        self.assertEqual(ids.slug("InvoiceLine"), "invoice-line")

    def test_camel_and_title(self):
        self.assertEqual(ids.camel("issue_invoice"), "IssueInvoice")
        self.assertEqual(ids.title("price_list"), "Price List")

    def test_an_application_is_named_for_many_of_the_thing_it_holds(self):
        self.assertEqual(ids.singular("invoices"), "invoice")
        self.assertEqual(ids.singular("policies"), "policy")
        self.assertEqual(ids.singular("billing"), "billing")


if __name__ == "__main__":
    unittest.main()
