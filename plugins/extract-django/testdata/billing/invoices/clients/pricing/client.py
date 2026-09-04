"""The pricing service, as billing calls it."""

import os

import httpx


class PricingClient:
    """Quotes, over HTTP, against the document vendored beside this file."""

    def __init__(self, base_url=None):
        # A mapping's `get` is not a GET: what tells them apart is the path.
        self._http = httpx.Client(base_url=base_url or os.environ.get("PRICING_URL", "http://pricing"))

    def create_quote(self, order_id):
        """Asks pricing what the order comes to."""
        return self._http.post("/v1/quotes", json={"orderId": str(order_id)}).json()
