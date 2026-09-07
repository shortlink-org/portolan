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
    path("swagger/", schema_view.with_ui("swagger")),
]
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
''',
            "orders/urls.py": '''
from django.urls import path, re_path
from rest_framework.routers import DefaultRouter
from .views import Health, Maintenance, OrderDetail, OrderList, OrderViewSet

router = DefaultRouter()
router.register("orders", OrderViewSet, basename="order")
urlpatterns = [
    path("manual/", OrderList.as_view(), name="order-list"),
    path("manual/<uuid:pk>/", OrderDetail.as_view(), name="order-detail"),
    re_path(r"^health/(?P<region>[^/]+)/$", Health.get),
    path("maintenance/fetch", Maintenance.fetch),
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
        self.assertEqual([app.dotted for app in endpoint_apps], ["health", "orders"])
        endpoints = []
        for app in endpoint_apps:
            endpoints += [(app, endpoint) for endpoint in transport.read_endpoints(app, Builder(), routes)]
        contracts = http_contracts(endpoints, "shop.billing", "billing/portolan/openapi.inferred.yaml")
        health = [contract for contract in contracts if contract["id"] == "shop.billing.health"][0]
        self.assertEqual(health["methods"], [{"name": "health_ready_get", "http": {"method": "GET", "path": "/health/ready/"}}])


if __name__ == "__main__":
    unittest.main()
