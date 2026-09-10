import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(1, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pyplugin"))

import apps  # noqa: E402
import routing  # noqa: E402
import serializers  # noqa: E402
import transport  # noqa: E402
from extract import http_contracts, openapi_document, routed_applications  # noqa: E402
from protocol import Builder  # noqa: E402
from source import Project  # noqa: E402


class StaticRoutes(unittest.TestCase):
    def setUp(self):
        self.holder = tempfile.TemporaryDirectory(prefix="portolan-django-routes-")
        root = self.holder.name
        files = {
            "manage.py": 'os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")\n',
            "config/settings.py": 'ROOT_URLCONF = "config.urls"\n',
            "config/urls.py": '''
from django.urls import include, path
from drf_yasg.views import get_schema_view
schema_view = get_schema_view()
urlpatterns = [
    path("api/v2/", include("orders.urls")),
    path("health/", include("health.urls")),
    path("", include("home.urls")),
    path("swagger/", schema_view.with_ui("swagger")),
]
''',
            "home/urls.py": '''
from django.urls import path
from .views import Home
urlpatterns = [path("", Home.as_view()), path("about/", Home.as_view())]
''',
            "home/views.py": '''
from rest_framework.views import APIView
class Home(APIView):
    def get(self, request):
        return None
''',
            "health/urls.py": '''
from django.urls import path
from .views import Ready
urlpatterns = [path("ready/", Ready.as_view())]
''',
            "health/views.py": '''
from rest_framework.views import APIView
class Ready(APIView):
    def get(self, request):
        return None
''',
            "orders/models.py": '''
from django.db import models
class Order(models.Model):
    active = models.BooleanField(default=True)
''',
            "orders/serializers.py": '''
from rest_framework import serializers
from .models import Order
class OrderSerializer(serializers.ModelSerializer):
    class Meta:
        model = Order
        fields = ("active",)
''',
            "orders/views.py": '''
from rest_framework import generics, viewsets
from rest_framework.views import APIView
from .models import Order
from .serializers import OrderSerializer

class OrderList(generics.ListCreateAPIView):
    queryset = Order.objects.filter(active=True)
    serializer_class = OrderSerializer

class OrderDetail(APIView):
    def get(self, request):
        """Read an order."""
        pass
    def delete(self, request):
        pass

class OrderViewSet(viewsets.ModelViewSet):
    serializer_class = OrderSerializer

class Health:
    def get(request):
        pass

class Maintenance:
    @classmethod
    def fetch(cls, request):
        return None

from django.http import HttpResponseNotAllowed
from django.utils.decorators import method_decorator
from django.views.decorators.http import require_GET, require_http_methods
from rest_framework.decorators import api_view
from .helpers import ensure_post, guarded

class Planet:
    @classmethod
    @require_http_methods(["POST"])
    def fetch(cls, request):
        return None

    @classmethod
    @ensure_post
    def refresh(cls, request):
        return None

    @classmethod
    def reindex(cls, request):
        if request.method != "PUT":
            return HttpResponseNotAllowed(["PUT"])
        return None

    @classmethod
    def status(cls, request):
        return guarded(request, cls._status)

    @classmethod
    def _status(cls):
        return None

@method_decorator(require_GET, name="dispatch")
class Reports:
    @classmethod
    def summary(cls, request):
        return None

class Exports:
    http_method_names = ["patch", "options", "head"]

    @classmethod
    def run(cls, request):
        return None

@api_view(["GET", "POST"])
def toggle(request):
    return None
''',
            "orders/helpers.py": '''
from django.views.decorators.http import require_POST

def ensure_post(view):
    return require_POST(view)

def guarded(request, handler):
    if request.method.lower() in ("delete", "patch"):
        return handler()
    return None
''',
            "orders/urls.py": '''
from django.urls import path, re_path
from rest_framework.routers import DefaultRouter
from .views import Exports, Health, Maintenance, OrderDetail, OrderList, OrderViewSet, Planet, Reports, toggle

router = DefaultRouter()
router.register("orders", OrderViewSet, basename="order")
urlpatterns = [
    path("manual/", OrderList.as_view(), name="order-list"),
    path("manual/<uuid:pk>/", OrderDetail.as_view(), name="order-detail"),
    re_path(r"^health/(?P<region>[^/]+)/$", Health.get),
    path("maintenance/fetch", Maintenance.fetch),
    path("planet/fetch", Planet.fetch),
    path("planet/refresh", Planet.refresh),
    path("planet/reindex", Planet.reindex),
    path("planet/status", Planet.status),
    path("reports/summary", Reports.summary),
    path("exports/run", Exports.run),
    path("toggle/", toggle),
] + router.urls
''',
        }
        for name, contents in files.items():
            path = os.path.join(root, name)
            directory = os.path.dirname(path)
            if directory:
                os.makedirs(directory, exist_ok=True)
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(contents)
        self.project = Project(root, root, lambda path: os.path.relpath(path, root).replace(os.sep, "/"))

    def tearDown(self):
        self.holder.cleanup()

    def test_nested_includes_direct_views_regexes_and_runtime_swagger(self):
        routes = routing.read(self.project)
        self.assertEqual(routes.root.dotted, "config.urls")
        self.assertEqual(routes.runtime_schema, "config/urls.py:4")
        paths = {(route.view, route.path) for route in routes.entries}
        self.assertIn(("OrderList", "/api/v2/manual/"), paths)
        self.assertIn(("OrderDetail", "/api/v2/manual/{pk}/"), paths)
        self.assertIn(("Health.get", "/api/v2/health/{region}/"), paths)
        self.assertIn(("OrderViewSet", "/api/v2/orders/"), paths)
        self.assertIn(("Ready", "/health/ready/"), paths)
        # A root mount is the commonest way to include an application, and the
        # empty prefix must not be read as "no route".
        self.assertIn(("Home", "/"), paths)
        self.assertIn(("Home", "/about/"), paths)
        detail = next(route for route in routes.entries if route.view == "OrderDetail")
        self.assertEqual(dict(detail.parameters), {"pk": "uuid"})

    def test_drf_generic_and_router_methods_become_http_operations(self):
        routes = routing.read(self.project)
        app = apps.discover(self.project, ["orders"])[0]
        endpoints = transport.read_endpoints(app, Builder(), routes)
        http = {(item.verb, item.path) for item in endpoints}
        self.assertIn(("GET", "/api/v2/manual/"), http)
        self.assertIn(("POST", "/api/v2/manual/"), http)
        self.assertIn(("GET", "/api/v2/manual/{pk}/"), http)
        self.assertIn(("DELETE", "/api/v2/manual/{pk}/"), http)
        self.assertIn(("GET", "/api/v2/orders/"), http)
        self.assertIn(("POST", "/api/v2/orders/"), http)
        self.assertIn(("GET", "/api/v2/orders/{id}/"), http)
        self.assertIn(("PATCH", "/api/v2/orders/{id}/"), http)
        self.assertIn(("GET", "/api/v2/health/{region}/"), http)
        flow_only = next(item for item in endpoints if item.view == "Maintenance" and item.action == "fetch")
        self.assertEqual((flow_only.verb, flow_only.path), ("", "/api/v2/maintenance/fetch"))
        detail = next(item for item in endpoints if item.verb == "GET" and item.path.endswith("manual/{pk}/"))
        self.assertEqual(detail.path_parameters, {"pk": "uuid"})
        spec = openapi_document([(app, item) for item in endpoints], "Orders", Builder())
        parameter = spec["paths"]["/api/v2/manual/{pk}/"]["get"]["parameters"][0]
        self.assertEqual(parameter["schema"], {"type": "string", "format": "uuid"})

    def test_a_mounted_method_takes_its_verb_from_what_the_code_declares(self):
        routes = routing.read(self.project)
        app = apps.discover(self.project, ["orders"])[0]
        b = Builder()
        endpoints = transport.read_endpoints(app, b, routes, self.project)
        verbs = {}
        for item in endpoints:
            verbs.setdefault(item.path, set()).add(item.verb)
        # Each tier of evidence, from the handler outwards.
        self.assertEqual(verbs["/api/v2/planet/fetch"], {"POST"})  # @require_http_methods on the handler
        self.assertEqual(verbs["/api/v2/reports/summary"], {"GET"})  # @method_decorator(require_GET, name="dispatch") on the class
        self.assertEqual(verbs["/api/v2/exports/run"], {"PATCH"})  # http_method_names, less HEAD and OPTIONS
        self.assertEqual(verbs["/api/v2/planet/reindex"], {"PUT"})  # a branch on request.method
        self.assertEqual(verbs["/api/v2/planet/refresh"], {"POST"})  # a project decorator that applies require_POST
        self.assertEqual(verbs["/api/v2/planet/status"], {"DELETE", "PATCH"})  # a wrapper the handler hands request to
        self.assertEqual(verbs["/api/v2/toggle/"], {"GET", "POST"})  # every method @api_view lists, not the first
        fetch = next(item for item in endpoints if item.path == "/api/v2/planet/fetch")
        self.assertTrue(fetch.verb_source.startswith("decorator at orders/views.py:"), fetch.verb_source)
        status = {item.id: item.verb_source for item in endpoints if item.path == "/api/v2/planet/status"}
        self.assertEqual(sorted(status), ["api_v2_planet_status", "api_v2_planet_status_patch"])
        self.assertTrue(all(source.startswith("wrapper guarded at orders/helpers.py:") for source in status.values()), status)

        # No tier speaks for Maintenance.fetch: the verb is unknown, and the
        # route stays in the model saying so instead of disappearing.
        self.assertEqual(verbs["/api/v2/maintenance/fetch"], {""})
        self.assertEqual(
            [w.message.split(";")[0] for w in b.warnings if w.ref == "orders/urls.py:12"],
            ["Maintenance.fetch is mounted as an HTTP view, but no HTTP verb is declared"],
        )
        pairs = [(app, item) for item in endpoints]
        contracts = http_contracts(pairs, "shop.orders", "orders/portolan/openapi.inferred.yaml")
        methods = {method["name"]: method["http"] for method in contracts[0]["methods"]}
        self.assertEqual(methods["api_v2_maintenance_fetch"], {"method": "", "path": "/api/v2/maintenance/fetch"})
        self.assertEqual(methods["api_v2_planet_status_patch"], {"method": "PATCH", "path": "/api/v2/planet/status"})
        spec = openapi_document(pairs, "Orders", Builder())
        unknown = spec["paths"]["/api/v2/maintenance/fetch"]
        self.assertEqual(unknown["x-portolan-verb"], "unknown")
        self.assertEqual(unknown["x-portolan-source"], "orders/urls.py:12")
        self.assertFalse({"get", "post", "put", "patch", "delete"} & set(unknown))
        self.assertIn("post", spec["paths"]["/api/v2/planet/fetch"])
        self.assertEqual(sorted(spec["paths"]["/api/v2/planet/status"]), ["delete", "patch"])

    def test_queryset_and_serializer_metadata_resolve_the_inherited_action_model(self):
        routes = routing.read(self.project)
        app = apps.discover(self.project, ["orders"])[0]
        endpoints = transport.read_endpoints(app, Builder(), routes)
        registry = serializers.read(self.project, [app])
        list_endpoint = next(item for item in endpoints if item.view == "OrderList" and item.action == "list")
        create_endpoint = next(item for item in endpoints if item.view == "OrderViewSet" and item.action == "create")
        self.assertEqual(registry.model_for_endpoint(list_endpoint).name, "Order")
        self.assertEqual(registry.model_for_endpoint(create_endpoint).name, "Order")

    def test_stateless_routed_app_still_contributes_an_http_interface(self):
        routes = routing.read(self.project)
        model_apps = apps.discover(self.project, [])
        endpoint_apps = routed_applications(self.project, model_apps, routes)
        self.assertEqual([app.dotted for app in endpoint_apps], ["health", "home", "orders"])
        endpoints = []
        for app in endpoint_apps:
            endpoints += [(app, endpoint) for endpoint in transport.read_endpoints(app, Builder(), routes)]
        contracts = http_contracts(endpoints, "shop.billing", "billing/portolan/openapi.inferred.yaml")
        health = [contract for contract in contracts if contract["id"] == "shop.billing.health"][0]
        self.assertEqual(health["methods"], [{"name": "health_ready_get", "http": {"method": "GET", "path": "/health/ready/"}}])
        home = [contract for contract in contracts if contract["id"] == "shop.billing.home"][0]
        self.assertEqual(
            home["methods"],
            [
                {"name": "about_get", "http": {"method": "GET", "path": "/about/"}},
                {"name": "home_get", "http": {"method": "GET", "path": "/"}},
            ],
        )


if __name__ == "__main__":
    unittest.main()
