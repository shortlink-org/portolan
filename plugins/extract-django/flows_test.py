"""Project-call traversal used to turn Django handlers into useful flows."""

import ast
import os
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(1, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pyplugin"))

import flows  # noqa: E402
from domain import ModelDef  # noqa: E402
from source import Module, node_name, read_imports  # noqa: E402


def module(name, source):
    found = Module(path="/" + name + ".py", rel=name + ".py", dotted=name, tree=ast.parse(source))
    found.imports = read_imports(found)
    return found


class Project:
    def __init__(self, modules):
        self.modules = {item.dotted: item for item in modules}

    def module(self, name):
        return self.modules.get(name) or self.modules.get(name + ".__init__")

    def resolve(self, owner, name):
        imported = owner.imports.get(name)
        if imported is None:
            if any(node_name(node) == name for node in owner.tree.body):
                return owner, name
            return None
        target = self.module(imported.module)
        if target is None:
            return None
        return target, name if imported.name == "*" else imported.name


class Warnings:
    def warn(self, *_args):
        pass


class FlowCalls(unittest.TestCase):
    def test_self_and_imported_helpers_reach_http_and_cycles_are_cut(self):
        views = module(
            "app.views",
            """
from app.helpers import send

class Tools:
    @staticmethod
    def deliver():
        return send()

class BaseView:
    @classmethod
    def dispatch(cls):
        return Tools.deliver()

class StatusView(BaseView):
    def get(self, request):
        return self.forward()

    def forward(self):
        return super().dispatch()
""",
        )
        helpers = module(
            "app.helpers",
            """
import os
from requests import post

BASE = os.environ.get("PEER_URL", "https://peer.example")

def send():
    post(BASE + "/v1/status")
    again()

def again():
    send()
""",
        )
        project = Project([views, helpers])
        reader = flows.FlowReader(
            flows.Options(context="app", svc_id="app.web", service="web", store=""),
            project,
            [],
            [],
            [],
            [],
            {},
            lambda path: path,
            Warnings(),
        )
        view = next(node for node in views.classes() if node.name == "StatusView")
        handler = next(node for node in view.body if getattr(node, "name", "") == "get")
        endpoint = SimpleNamespace(id="status_get", module=views, node=handler, view="StatusView", doc="", use_cases=[])

        flow = reader.endpoint_flow(endpoint)

        self.assertEqual([step["label"] for step in flow["steps"]], ["status_get", "POST /v1/status"])
        self.assertEqual(flow["steps"][1]["status"], "unresolved")
        self.assertEqual(flow["steps"][1]["line"], "app.helpers.py:8")
        self.assertEqual([lane["label"] for lane in flow["participants"] if lane.get("label")], ["peer.example"])

    def test_one_sided_condition_keeps_an_explicit_otherwise_branch(self):
        views = module(
            "app.views",
            """
from requests import get

class StatusView:
    def get(self, request):
        if request.ready:
            get("https://peer.example/ready")
""",
        )
        project = Project([views])
        reader = flows.FlowReader(
            flows.Options(context="app", svc_id="app.web", service="web", store=""),
            project,
            [],
            [],
            [],
            [],
            {},
            lambda path: path,
            Warnings(),
        )
        view = views.classes()[0]
        handler = next(node for node in view.body if getattr(node, "name", "") == "get")
        endpoint = SimpleNamespace(id="status_get", module=views, node=handler, view="StatusView", doc="", use_cases=[])

        flow = reader.endpoint_flow(endpoint)

        alternative = flow["steps"][1]
        self.assertEqual([branch["title"] for branch in alternative["branches"]], ["request.ready", "otherwise"])
        self.assertEqual(alternative["branches"][1]["steps"], [])

    def test_routed_models_are_visible_without_an_aggregate(self):
        models = module(
            "app.models",
            """
class Widget:
    pass
""",
        )
        views = module(
            "app.views",
            """
from .models import Widget

class WidgetView:
    def get(self, request):
        return Widget.objects.get(id=request.id)
""",
        )
        app = SimpleNamespace(dotted="app")
        model = ModelDef(name="Widget", node=models.classes()[0], module=models, app=app)
        project = Project([models, views])
        reader = flows.FlowReader(
            flows.Options(context="app", svc_id="app.web", service="web", store=""),
            project,
            [],
            [model],
            [],
            [],
            {},
            lambda path: path,
            Warnings(),
        )
        view = views.classes()[0]
        handler = next(node for node in view.body if getattr(node, "name", "") == "get")
        endpoint = SimpleNamespace(id="widget_get", module=views, node=handler, view="WidgetView", doc="", use_cases=[])

        flow = reader.endpoint_flow(endpoint)

        self.assertEqual([step["label"] for step in flow["steps"]], ["widget_get", "Widget.objects.get"])

    def test_configured_wrappers_are_semantic_and_technical_ones_are_counted(self):
        views = module(
            "app.views",
            """
from app.helpers import record_log, send_mail

class StatusView:
    def post(self, request):
        record_log("started")
        send_mail(request.email)
        record_log("finished")
""",
        )
        helpers = module(
            "app.helpers",
            """
from requests import post

def record_log(message):
    post("https://logger.example/logs", json={"message": message})

def send_mail(email):
    post("https://mailer.example/messages", json={"email": email})
""",
        )
        reader = flows.FlowReader(
            flows.Options(
                context="app",
                svc_id="app.web",
                service="web",
                store="",
                flow_wrappers={
                    "app.helpers.record_log": {"label": "Record application log", "technical": True},
                    "app.helpers.send_mail": {"label": "Send email", "target": "messaging.mailer"},
                },
            ),
            Project([views, helpers]),
            [],
            [],
            [],
            [],
            {},
            lambda path: path,
            Warnings(),
        )
        view = views.classes()[0]
        handler = next(node for node in view.body if getattr(node, "name", "") == "post")
        endpoint = SimpleNamespace(id="status_post", module=views, node=handler, view="StatusView", doc="", use_cases=[])

        flow = reader.endpoint_flow(endpoint)

        self.assertEqual(
            [step["label"] for step in flow["steps"]],
            ["status_post", "Record application log ×2", "Send email"],
        )
        self.assertEqual(flow["steps"][1]["from"], "app.web")
        self.assertEqual(flow["steps"][1]["to"], "app.web")
        self.assertIn("2 call sites are collapsed", flow["steps"][1]["note"])
        self.assertEqual(flow["steps"][2]["to"], "messaging.mailer")
        self.assertNotIn("logger.example", [lane.get("label") for lane in flow["participants"]])

    def test_task_body_is_a_source_backed_continuation(self):
        tasks = module(
            "app.tasks",
            """
from celery import shared_task
from requests import post

class Refresher:
    def run(self):
        for item in self.items():
            pass

    def items(self):
        return post("https://peer.example/refresh")

@shared_task(name="app.refresh")
def refresh():
    refresher = Refresher()
    refresher.run()
""",
        )
        reader = flows.FlowReader(
            flows.Options(context="app", svc_id="app.web", service="web", store=""),
            Project([tasks]),
            [],
            [],
            [],
            [],
            {},
            lambda path: path,
            Warnings(),
        )

        found = reader.task_flows()

        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["entrypoint"], "python:app.tasks:refresh")
        self.assertEqual([step["label"] for step in found[0]["steps"]], ["POST /refresh"])


if __name__ == "__main__":
    unittest.main()
