"""The way in.

A DRF view is the handler: a `ViewSet`'s actions - the five it inherits and
every `@action` it adds - and an `@api_view` function. The router registration
in `<app>/urls.py` says what the endpoint is called, so an endpoint id here is
the one a reader would see in a drf-spectacular document: `invoice_issue`.

The route itself is not read. A path is a fact about the document, and the
document is `extract-openapi`'s to read - which is also what pairs these
endpoints with the interface a service provides.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass, field as dc_field
from typing import Dict, List

from apps import App
from ids import slug
from source import Module, const_str, doc, dotted, keyword, methods

# The actions a ViewSet has without writing one.
ACTIONS = {
    "list": "GET",
    "create": "POST",
    "retrieve": "GET",
    "update": "PUT",
    "partial_update": "PATCH",
    "destroy": "DELETE",
}

VIEW_BASES = ("ViewSet", "ModelViewSet", "ReadOnlyModelViewSet", "GenericViewSet", "APIView", "View", "GenericAPIView")


@dataclass
class Endpoint:
    id: str  # invoice_issue
    action: str  # issue
    view: str  # InvoiceViewSet
    verb: str
    node: ast.AST
    module: Module
    doc: str = ""
    use_cases: List[str] = dc_field(default_factory=list)


def basenames(app: App) -> Dict[str, str]:
    """`router.register("invoices", InvoiceViewSet, basename="invoice")`, as the
    view class to the name its endpoints go by."""
    out = {}
    for module in app.package("urls"):
        for node in ast.walk(module.tree):
            if not isinstance(node, ast.Call) or dotted(node.func).split(".")[-1] != "register":
                continue
            view = ""
            for arg in node.args[1:]:
                name = dotted(arg)
                if name:
                    view = name.split(".")[-1]
                    break
            if not view:
                continue
            base = const_str(keyword(node, "basename"))
            if not base and len(node.args) > 0:
                base = const_str(node.args[0]).strip("^/$").replace("/", "_")
            out[view] = base or view_name(view)
    return out


def view_name(name: str) -> str:
    """InvoiceViewSet -> invoice: what is left when the framework's suffix is."""
    for suffix in ("ViewSet", "APIView", "GenericAPIView", "View"):
        if name.endswith(suffix) and len(name) > len(suffix):
            name = name[: -len(suffix)]
            break
    return slug(name).replace("-", "_")


def verb_of(node: ast.AST, action: str) -> str:
    decorator = None
    for dec in getattr(node, "decorator_list", []):
        if isinstance(dec, ast.Call) and dotted(dec.func).split(".")[-1] in ("action", "api_view"):
            decorator = dec
    if decorator is not None:
        methods_arg = keyword(decorator, "methods")
        if methods_arg is None and decorator.args:
            methods_arg = decorator.args[0]
        if isinstance(methods_arg, (ast.List, ast.Tuple, ast.Set)) and methods_arg.elts:
            return const_str(methods_arg.elts[0]).upper()
    return ACTIONS.get(action, "" if action not in ("get", "post", "put", "patch", "delete") else action.upper())


def read_endpoints(app: App, b) -> List[Endpoint]:
    registered = basenames(app)
    out: List[Endpoint] = []
    for module in app.package("views"):
        for node in module.classes():
            if not any(base.split(".")[-1] in VIEW_BASES for base in [d for d in map(dotted, node.bases)]):
                continue
            base = registered.get(node.name)
            if base is None:
                base = view_name(node.name)
                b.warn(module.rel, "%s is registered by no router in %s/urls.py; its endpoints are named after the class" % (node.name, app.rel))
            for handler in methods(node):
                if handler.name.startswith("_"):
                    continue
                is_action = any(
                    isinstance(dec, ast.Call) and dotted(dec.func).split(".")[-1] == "action" for dec in getattr(handler, "decorator_list", [])
                )
                if handler.name not in ACTIONS and not is_action and handler.name not in ("get", "post", "put", "patch", "delete"):
                    continue
                out.append(
                    Endpoint(
                        id="%s_%s" % (base, handler.name),
                        action=handler.name,
                        view=node.name,
                        verb=verb_of(handler, handler.name),
                        node=handler,
                        module=module,
                        doc=doc(handler),
                    )
                )
        for node in module.functions():
            if not any(isinstance(dec, ast.Call) and dotted(dec.func).split(".")[-1] == "api_view" for dec in getattr(node, "decorator_list", [])):
                continue
            out.append(
                Endpoint(
                    id=node.name,
                    action=node.name,
                    view="",
                    verb=verb_of(node, node.name),
                    node=node,
                    module=module,
                    doc=doc(node),
                )
            )
    return sorted(out, key=lambda e: e.id)


def receivers(app: App) -> List[ast.AST]:
    """`@receiver(signal)` functions: what runs when somebody else's event
    arrives. Django keeps them in `handlers.py`, `signals.py` or `receivers.py`,
    and all three are read."""
    out = []
    for name in ("handlers", "signals", "receivers"):
        for module in app.package(name):
            for node in module.functions():
                for dec in getattr(node, "decorator_list", []):
                    if isinstance(dec, ast.Call) and dotted(dec.func).split(".")[-1] == "receiver":
                        out.append((module, node, dec))
                        break
    return out
