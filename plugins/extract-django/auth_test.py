import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(1, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pyplugin"))

import apps  # noqa: E402
import auth  # noqa: E402
import routing  # noqa: E402
import serializers  # noqa: E402
import transport  # noqa: E402
from extract import openapi_document, routed_applications  # noqa: E402
from protocol import Builder  # noqa: E402
from source import Project  # noqa: E402


class WhoMayCall(unittest.TestCase):
    """Each way DRF says who may call, once, and what OpenAPI it becomes."""

    def setUp(self):
        self.holder = tempfile.TemporaryDirectory(prefix="portolan-django-auth-")
        root = self.holder.name
        files = {
            "manage.py": 'os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")\n',
            "config/settings.py": '''
ROOT_URLCONF = "config.urls"
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ("rest_framework.authentication.TokenAuthentication",),
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
}
''',
            "config/urls.py": '''
from django.urls import include, path
urlpatterns = [path("", include("api.urls"))]
''',
            "api/base.py": '''
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
class Protected(APIView):
    permission_classes = [IsAuthenticated]
''',
            "api/views.py": '''
from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.views import APIView
from .base import Protected
from .perms import IsOwner

class Public(APIView):
    def get(self, request):
        return None

class Admin(Protected):
    def post(self, request):
        return None

class Mixed(viewsets.ViewSet):
    def get_permissions(self):
        if self.action == "list":
            return [AllowAny()]
        return [IsAuthenticated()]
    def list(self, request):
        return None
    def create(self, request):
        return None

class Owned(APIView):
    permission_classes = [IsOwner]
    def get(self, request):
        return None

class Spelled(APIView):
    @extend_schema(auth=[{"basicAuth": []}])
    def get(self, request):
        return None

@api_view(["POST"])
@authentication_classes([])
@permission_classes([IsAuthenticated])
def hook(request):
    return None
''',
            "api/perms.py": '''
from rest_framework.permissions import BasePermission
class IsOwner(BasePermission):
    pass
''',
            "api/urls.py": '''
from django.urls import path
from rest_framework.routers import DefaultRouter
from .views import Admin, Owned, Public, Spelled, hook, Mixed

router = DefaultRouter()
router.register("mixed", Mixed, basename="mixed")
urlpatterns = [
    path("public/", Public.as_view()),
    path("admin/", Admin.as_view()),
    path("owned/", Owned.as_view()),
    path("spelled/", Spelled.as_view()),
    path("hook/", hook),
] + router.urls
''',
        }
        for name, contents in files.items():
            path = os.path.join(root, name)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(contents)
        self.project = Project(root, root, lambda path: os.path.relpath(path, root).replace(os.sep, "/"))
        self.b = Builder()
        routes = routing.read(self.project)
        endpoint_apps = routed_applications(self.project, apps.discover(self.project, []), routes)
        endpoints = []
        for app in endpoint_apps:
            endpoints += [(app, endpoint) for endpoint in transport.read_endpoints(app, self.b, routes)]
        registry = serializers.read(self.project, endpoint_apps)
        self.registry = auth.Registry(self.project, "", self.b)
        self.spec = openapi_document(endpoints, "Api", self.b, registry, "", self.registry)

    def tearDown(self):
        self.holder.cleanup()

    def operation(self, path, verb):
        return self.spec["paths"][path][verb]

    def test_the_settings_decide_the_document_and_a_view_that_says_nothing(self):
        self.assertEqual(self.registry.default_authentication, ["TokenAuthentication"])
        self.assertEqual(self.spec["security"], [{"tokenAuth": []}, {}])
        self.assertEqual(self.operation("/public/", "get")["security"], [{"tokenAuth": []}, {}])
        self.assertEqual(self.operation("/public/", "get")["x-portolan-permissions"], ["AllowAny"])
        self.assertEqual(self.spec["components"]["securitySchemes"]["tokenAuth"]["in"], "header")

    def test_a_local_base_class_lends_its_permissions(self):
        self.assertEqual(self.operation("/admin/", "post")["security"], [{"tokenAuth": []}])
        self.assertEqual(self.operation("/admin/", "post")["x-portolan-permissions"], ["IsAuthenticated"])

    def test_get_permissions_is_decided_per_action(self):
        self.assertEqual(self.operation("/mixed/", "get")["security"], [{"tokenAuth": []}, {}])
        self.assertEqual(self.operation("/mixed/", "post")["security"], [{"tokenAuth": []}])

    def test_a_permission_the_reader_does_not_know_is_named_and_not_guessed(self):
        owned = self.operation("/owned/", "get")
        self.assertNotIn("security", owned)
        self.assertEqual(owned["x-portolan-permissions"], ["IsOwner"])
        self.assertTrue(any("IsOwner is not a DRF permission" in w.message for w in self.b.warnings))

    def test_the_schema_decorator_spells_the_requirement_itself(self):
        self.assertEqual(self.operation("/spelled/", "get")["security"], [{"basicAuth": []}])
        self.assertEqual(self.spec["components"]["securitySchemes"]["basicAuth"], {"type": "http", "scheme": "basic"})

    def test_a_function_view_reads_its_decorators_and_an_empty_list_is_a_fact(self):
        hook = self.operation("/hook/", "post")
        self.assertEqual(hook["security"], [])
        self.assertEqual(hook["x-portolan-permissions"], ["IsAuthenticated"])
        self.assertTrue(any("nobody can call it" in w.message for w in self.b.warnings))

    def test_the_document_is_still_json(self):
        json.dumps(self.spec)


class ReadOnly(unittest.TestCase):
    def test_read_only_permissions_relax_safe_verbs_only(self):
        registry = auth.Registry.__new__(auth.Registry)
        registry.schemes = {}
        registry._warned = set()
        registry.b = Builder()
        for verb, expected in (("GET", [{"cookieAuth": []}, {}]), ("POST", [{"cookieAuth": []}])):
            decided = registry.decide(["SessionAuthentication"], ["IsAuthenticatedOrReadOnly"], verb, "")
            self.assertEqual(decided.requirement, expected)

    def test_a_custom_authentication_class_is_a_scheme_whose_transport_is_unknown(self):
        registry = auth.Registry.__new__(auth.Registry)
        registry.schemes = {}
        registry._warned = set()
        registry.b = Builder()
        decided = registry.decide(["HmacAuthentication"], ["IsAuthenticated"], "POST", "api/views.py")
        self.assertEqual(decided.requirement, [{"hmacAuthentication": []}])
        self.assertEqual(decided.schemes["hmacAuthentication"]["scheme"], "unknown")
        self.assertEqual(len(registry.b.warnings), 1)


if __name__ == "__main__":
    unittest.main()
