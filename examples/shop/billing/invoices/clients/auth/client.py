"""The auth service, as billing calls it.

The route is in the code and the document beside this file says which operation
answers on it, so the call is recorded under the id auth's own extractor gives
it: `auth.v1.Sessions/validateSession`.
"""

import os

import httpx


class AuthClient:
    """Sessions, over HTTP."""

    def __init__(self, base_url=None):
        self._http = httpx.Client(base_url=base_url or os.environ.get("AUTH_URL", "http://auth:8080"))

    def validate_session(self, token):
        """Resolves the bearer token to a live session, or refuses."""
        return self._http.get("/v1/sessions/current", headers={"Authorization": token}).json()
