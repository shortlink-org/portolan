import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import openapi  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DOCUMENT = os.path.join(HERE, "testdata", "billing", "invoices", "clients", "pricing", "openapi.yaml")


class Ids(unittest.TestCase):
    """The ids have to be the ones plugins/openapi/ids.go makes, or a call
    would never resolve to the method that answers it."""

    def test_api_is_the_title_and_the_major_version(self):
        self.assertEqual(openapi.api_id("auth", "1.0.0"), "auth.v1")
        self.assertEqual(openapi.api_id("Price List", "2.1.0"), "price-list.v2")
        self.assertEqual(openapi.api_id("", ""), "api")

    def test_an_interface_is_the_api_and_the_first_tag(self):
        self.assertEqual(openapi.interface_id("auth.v1", "sessions"), "auth.v1.Sessions")
        self.assertEqual(openapi.interface_id("auth.v1", "price_list"), "auth.v1.PriceList")
        self.assertEqual(openapi.interface_id("auth.v1", ""), "auth.v1")

    def test_a_parameter_is_compared_by_position(self):
        # However either side spells the hole, and however the leading slash
        # falls out of the split - the Go side spells it the same way.
        self.assertEqual(openapi.shape("/v1/users/{userId}"), openapi.shape("/v1/users/{}"))
        self.assertNotEqual(openapi.shape("/v1/users/{userId}"), openapi.shape("/v1/users/me"))


class Read(unittest.TestCase):
    def test_reads_the_document_a_client_is_vendored_beside(self):
        spec = openapi.read(DOCUMENT)
        self.assertEqual(spec.api, "pricing.v1")
        self.assertEqual([o.id for o in spec.operations], ["createQuote"])
        found = spec.find("POST", "/v1/quotes")
        self.assertIsNotNone(found)
        self.assertEqual(found.call_id(spec.api), "pricing.v1.Quotes/createQuote")

    def test_a_route_the_document_does_not_declare_finds_nothing(self):
        spec = openapi.read(DOCUMENT)
        self.assertIsNone(spec.find("GET", "/v1/quotes"))
        self.assertIsNone(spec.find("POST", "/v1/quotes/{}/lines"))

    def test_an_operation_with_no_id_is_known_by_its_route(self):
        spec = openapi.parse('info:\n  title: x\n  version: "1.0"\npaths:\n  /health:\n    get:\n      responses:\n        "200":\n          description: fine\n')
        self.assertEqual(spec["info"]["title"], "x")
        self.assertIn("/health", spec["paths"])

    def test_beside_finds_the_document_in_the_client_directory(self):
        self.assertEqual(openapi.beside(os.path.dirname(DOCUMENT)), DOCUMENT)
        self.assertIsNone(openapi.beside(os.path.join(HERE, "testdata", "billing", "config")))


if __name__ == "__main__":
    unittest.main()
