import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(1, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pyplugin"))

import apps  # noqa: E402
import routing  # noqa: E402
import transport  # noqa: E402
from extract import extract, http_contracts, openapi_document  # noqa: E402
from options import Options  # noqa: E402
from protocol import Builder, Input  # noqa: E402
from source import Project  # noqa: E402

FILES = {
    "manage.py": 'os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")\n',
    "config/settings.py": 'ROOT_URLCONF = "config.urls"\nINSTALLED_APPS = ["proxy"]\n',
    "config/urls.py": '''
from django.urls import include, path
urlpatterns = [path("proxy/", include("proxy.urls"))]
''',
    "proxy/urls.py": '''
from django.urls import path
from .views import Page, Uploads, export, ingest, lookup, ping, search, stream, submit
urlpatterns = [
    path("lookup", lookup),
    path("search", search),
    path("ingest", ingest),
    path("stream", stream),
    path("ping", ping),
    path("export", export),
    path("submit", submit),
    path("uploads/csv", Uploads.csv),
    path("uploads/form", Uploads.form),
    path("page", Page.as_view()),
]
''',
    "proxy/views.py": '''
import json
from django.http import HttpResponseNotAllowed, JsonResponse
from django.views import View
from django.views.decorators.http import require_GET


def lookup(request):
    if request is None:
        return JsonResponse({})
    return JsonResponse({"url": request.GET.get("url", "")})


def search(req):
    return JsonResponse({"q": req.GET["q"]})


def ingest(request):
    return JsonResponse(json.loads(request.body))


def stream(request):
    return JsonResponse({"size": len(request.read())})


def ping(request):
    return JsonResponse({"ok": True})


@require_GET
def export(request):
    return JsonResponse(dict(request.POST))


def submit(request):
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    return JsonResponse(dict(request.POST))


class Uploads:
    @classmethod
    def csv(cls, request):
        back = request.GET.get("next")
        data = request.FILES["data"]
        return JsonResponse({"next": back, "size": data.size, "to": request.POST.get("redirect_to")})

    @classmethod
    def form(cls, request):
        return JsonResponse({"name": request.POST.get("name")})


class Page(View):
    def get(self, request):
        return JsonResponse({"q": request.GET.get("q")})
''',
}


class Fixture(unittest.TestCase):
    def setUp(self):
        self.holder = tempfile.TemporaryDirectory(prefix="portolan-django-verbs-")
        self.root = self.holder.name
        for name, contents in FILES.items():
            path = os.path.join(self.root, name)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(contents)

    def tearDown(self):
        self.holder.cleanup()


class VerbsReadOffTheRequest(Fixture):
    def setUp(self):
        super().setUp()
        root = self.root
        self.project = Project(root, root, lambda path: os.path.relpath(path, root).replace(os.sep, "/"))
        self.routes = routing.read(self.project)
        self.app = apps.discover(self.project, ["proxy"])[0]
        self.b = Builder()
        self.endpoints = transport.read_endpoints(self.app, self.b, self.routes, self.project)
        self.by_path = {}
        for item in self.endpoints:
            self.by_path.setdefault(item.path, []).append(item)

    def one(self, path):
        found = self.by_path["/proxy/" + path]
        self.assertEqual(len(found), 1, found)
        return found[0]

    def assertVerb(self, path, verb, source, inferred):
        item = self.one(path)
        self.assertEqual((item.verb, item.verb_inferred), (verb, inferred), item.verb_source)
        self.assertEqual(item.verb_source, source)

    def test_a_handler_that_reads_only_the_query_string_is_inferred_as_get(self):
        self.assertVerb("lookup", "GET", "reads only request.GET at proxy/views.py:11", True)

    def test_the_request_is_whatever_the_handler_names_its_first_argument(self):
        self.assertVerb("search", "GET", "reads only request.GET at proxy/views.py:15", True)

    def test_a_body_read_is_inferred_as_post(self):
        self.assertVerb("ingest", "POST", "reads request.body at proxy/views.py:19", True)
        self.assertVerb("stream", "POST", "reads request.read at proxy/views.py:23", True)
        self.assertVerb("uploads/form", "POST", "reads request.POST at proxy/views.py:50", True)

    def test_a_body_read_outweighs_a_query_read_and_the_first_body_read_is_named(self):
        self.assertVerb("uploads/csv", "POST", "reads request.FILES at proxy/views.py:45", True)

    def test_a_declaration_wins_over_what_the_handler_reads(self):
        self.assertVerb("export", "GET", "decorator at proxy/views.py:30", False)
        self.assertVerb("submit", "POST", "request.method at proxy/views.py:36", False)
        page = self.one("page")
        self.assertEqual((page.verb, page.verb_inferred), ("GET", False))

    def test_a_handler_that_reads_nothing_keeps_its_verb_unknown_and_is_named(self):
        self.assertVerb("ping", "", "", False)
        warned = [w.ref for w in self.b.warnings if "no HTTP verb is declared and none can be inferred" in w.message]
        self.assertEqual(warned, ["proxy/urls.py:9"])

    def test_an_inferred_verb_is_an_operation_marked_inferred_but_not_a_contract_route(self):
        pairs = [(self.app, item) for item in self.endpoints]
        spec = openapi_document(pairs, "Proxy", Builder())
        upload = spec["paths"]["/proxy/uploads/csv"]["post"]
        self.assertEqual(upload["x-portolan-verb"], "inferred")
        self.assertEqual(upload["x-portolan-verb-evidence"], "reads request.FILES at proxy/views.py:45")
        self.assertNotIn("x-portolan-verb", spec["paths"]["/proxy/submit"]["post"])
        self.assertEqual(spec["paths"]["/proxy/ping"]["x-portolan-verb"], "unknown")

        contracts = http_contracts(pairs, "shop.proxy", "proxy/portolan/openapi.inferred.yaml")
        routes = {method["http"]["path"]: method["http"]["method"] for method in contracts[0]["methods"]}
        # The merge links an outbound call to a provided route by verb and
        # path; an inferred verb must not be what confirms that link.
        self.assertEqual(routes["/proxy/uploads/csv"], "")
        self.assertEqual(routes["/proxy/lookup"], "")
        self.assertEqual(routes["/proxy/submit"], "POST")
        self.assertEqual(routes["/proxy/export"], "GET")


class InferredVerbFlowTrigger(Fixture):
    def test_the_flow_trigger_names_the_inferred_verb_at_medium_confidence(self):
        b = Builder()
        extract(Input(root=".", output="portolan"), Options.of({"context": "shop", "service": "proxy"}), b, cwd=self.root)
        files = {f.name: f.contents for f in b.files}
        fragment = json.loads(files["domain.json"])
        triggers = {flow["trigger"]["label"]: flow["trigger"]["confidence"] for flow in fragment["flows"]}
        self.assertEqual(triggers["POST /proxy/uploads/csv"], "medium")
        self.assertEqual(triggers["GET /proxy/lookup"], "medium")
        self.assertEqual(triggers["POST /proxy/submit"], "high")
        self.assertEqual(triggers["GET /proxy/export"], "high")


if __name__ == "__main__":
    unittest.main()
