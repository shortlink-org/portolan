"""The way in.

A DRF view is the handler: local HTTP methods, concrete generic actions and a
ViewSet's inherited or decorated actions.  ``routing`` supplies the URLConf
mount, so the same endpoint opens a code flow and contributes its verb/path to
the service's inferred HTTP contract.
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass, field as dc_field
from typing import Dict, List, Optional

from apps import App
from ids import slug
from routing import Route, Routes
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

# Methods supplied by DRF's concrete generic views even when the project does
# not override them.  These are framework declarations, not guesses about the
# application's code.
GENERIC_ACTIONS = {
    "ListAPIView": [("list", "GET")],
    "CreateAPIView": [("create", "POST")],
    "ListCreateAPIView": [("list", "GET"), ("create", "POST")],
    "RetrieveAPIView": [("retrieve", "GET")],
    "UpdateAPIView": [("update", "PUT"), ("partial_update", "PATCH")],
    "DestroyAPIView": [("destroy", "DELETE")],
    "RetrieveUpdateAPIView": [("retrieve", "GET"), ("update", "PUT"), ("partial_update", "PATCH")],
    "RetrieveDestroyAPIView": [("retrieve", "GET"), ("destroy", "DELETE")],
    "RetrieveUpdateDestroyAPIView": [("retrieve", "GET"), ("update", "PUT"), ("partial_update", "PATCH"), ("destroy", "DELETE")],
    "ModelViewSet": list(ACTIONS.items()),
    "ReadOnlyModelViewSet": [("list", "GET"), ("retrieve", "GET")],
}


@dataclass
class Endpoint:
    id: str  # invoice_issue
    action: str  # issue
    view: str  # InvoiceViewSet
    verb: str
    node: ast.AST
    module: Module
    path: str = ""
    route_source: str = ""
    doc: str = ""
    use_cases: List[str] = dc_field(default_factory=list)
    path_parameters: Dict[str, str] = dc_field(default_factory=dict)


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


def route_base(route: Route, fallback: str) -> str:
    if route.router:
        return route.basename or fallback
    named = slug(route.name).replace("-", "_") if route.name else ""
    path = re.sub(r"[^a-z0-9]+", "_", route.path.lower()).strip("_")
    return named or path or fallback


def action_path(route: Route, node: ast.AST, action: str) -> str:
    if not route.router:
        return route.path
    if action in ("list", "create"):
        return route.path
    detail = action in ("retrieve", "update", "partial_update", "destroy")
    suffix = action.replace("_", "-")
    for dec in getattr(node, "decorator_list", []):
        if not isinstance(dec, ast.Call) or dotted(dec.func).split(".")[-1] != "action":
            continue
        detail_node = keyword(dec, "detail")
        detail = isinstance(detail_node, ast.Constant) and detail_node.value is True
        suffix = const_str(keyword(dec, "url_path")) or suffix
    base = route.path.rstrip("/")
    return base + ("/{id}" if detail else "") + ("/" + suffix if action not in ACTIONS else "") + "/"


def endpoint(node: ast.AST, module: Module, view: str, action: str, verb: str, base: str, route: Optional[Route], description: str = "") -> Endpoint:
    ident = base if base == action or base.endswith("_" + action) else "%s_%s" % (base, action)
    return Endpoint(
        id=ident,
        action=action,
        view=view,
        verb=verb,
        node=node,
        module=module,
        path=action_path(route, node, action) if route else "",
        route_source=route.source if route else "",
        doc=description,
        path_parameters=dict(route.parameters) if route else {},
    )


def read_endpoints(app: App, b, routes: Optional[Routes] = None) -> List[Endpoint]:
    registered = basenames(app)
    out: List[Endpoint] = []
    for module in app.package("views"):
        for node in module.classes():
            bases = [base.split(".")[-1] for base in map(dotted, node.bases)]
            mounted = routes.for_view(module.dotted, node.name) if routes else []
            mounted += [route for route in (routes.entries if routes else []) if route.module == module.dotted and route.view.startswith(node.name + ".")]
            if not any(base in VIEW_BASES or base in GENERIC_ACTIONS for base in bases) and not mounted:
                continue
            base = registered.get(node.name)
            if base is None and not mounted:
                base = view_name(node.name)
                b.warn(module.rel, "%s is registered by no router in %s/urls.py; its endpoints are named after the class" % (node.name, app.rel))
            handlers = {handler.name: handler for handler in methods(node)}
            declared = []
            for handler in handlers.values():
                if handler.name.startswith("_"):
                    continue
                is_action = any(
                    isinstance(dec, ast.Call) and dotted(dec.func).split(".")[-1] == "action" for dec in getattr(handler, "decorator_list", [])
                )
                if handler.name not in ACTIONS and not is_action and handler.name not in ("get", "post", "put", "patch", "delete"):
                    # A plain Django class may expose an arbitrarily named
                    # method directly in URLConf (`Planet.fetch`). The route
                    # proves the HTTP entrypoint but, without a method
                    # decorator or request-method branch, not one particular
                    # verb. Keep it as a flow root and leave it out of the
                    # inferred OpenAPI contract.
                    if handler.name not in {
                        route.view.split(".", 1)[1]
                        for route in mounted
                        if "." in route.view
                    }:
                        continue
                declared.append((handler.name, verb_of(handler, handler.name), handler, doc(handler)))
            inherited = []
            for inherited_base in bases:
                inherited += GENERIC_ACTIONS.get(inherited_base, [])
            for action, verb in inherited:
                same_direct_handler = mounted and all(not route.router for route in mounted) and any(item[1] == verb for item in declared)
                if action not in handlers and not any(item[0] == action for item in declared) and not same_direct_handler:
                    declared.append((action, verb, node, doc(node)))
            class_routes = routes.for_view(module.dotted, node.name) if routes else []
            method_routes = {route.view.split(".", 1)[1]: route for route in mounted if "." in route.view}
            if not class_routes and not method_routes:
                for action, verb, handler, description in declared:
                    out.append(endpoint(handler, module, node.name, action, verb, base or view_name(node.name), None, description))
                continue
            for action, verb, handler, description in declared:
                targets = class_routes or ([method_routes[action]] if action in method_routes else [])
                for route in targets:
                    if not verb:
                        b.warn(
                            route.source,
                            "%s is mounted as an HTTP view, but no HTTP verb is declared; its flow is extracted and the route is omitted from inferred OpenAPI"
                            % route.view,
                        )
                    out.append(endpoint(handler, module, node.name, action, verb, route_base(route, base or view_name(node.name)), route, description))
        for node in module.functions():
            mounted = routes.for_view(module.dotted, node.name) if routes else []
            if not mounted and not any(isinstance(dec, ast.Call) and dotted(dec.func).split(".")[-1] == "api_view" for dec in getattr(node, "decorator_list", [])):
                continue
            verb = verb_of(node, node.name)
            if not verb:
                continue
            if mounted:
                for route in mounted:
                    out.append(endpoint(node, module, "", verb.lower(), verb, route_base(route, node.name), route, doc(node)))
            else:
                out.append(Endpoint(id=node.name, action=node.name, view="", verb=verb, node=node, module=module, doc=doc(node)))
    unique = {}
    for found in out:
        unique[(found.id, found.verb, found.path, found.module.rel)] = found
    return sorted(unique.values(), key=lambda e: (e.id, e.verb, e.path))


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
