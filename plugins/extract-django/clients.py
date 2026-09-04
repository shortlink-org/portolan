"""A call to another service, read off the client that makes it.

`<app>/clients/<peer>/` holds the vendored document and the class that calls
it. The code names the verb and the route - `self._http.post("/v1/quotes")` -
and the document beside it says which operation answers there, so the call is
recorded under the id the callee's own extractor would give it. Without a
document there is no id to share: the call is still recorded, against the route
it names, and left unresolved.
"""

from __future__ import annotations

import ast
import os
from dataclasses import dataclass, field as dc_field
from typing import Dict, List, Optional, Tuple

import openapi
from apps import App
from source import Module, const_str, dotted

VERBS = {"get", "post", "put", "patch", "delete", "head", "options", "request"}


@dataclass
class Call:
    """One method of a client, and what it reaches."""

    id: str  # "shop.v1.Pricing/GetQuote", or "POST /v1/quotes" when nothing names it
    pkg: str  # what the manifest's peers map is keyed by: the api id
    source: str  # the document, or the client module
    label: str  # what the arrow says: the operation, or the route
    resolved: bool


@dataclass
class Client:
    name: str  # the class
    module: Module
    directory: str
    spec: Optional[openapi.Spec] = None
    calls: Dict[str, Call] = dc_field(default_factory=dict)  # method -> call


def path_of(node: ast.AST) -> str:
    """The route as the code writes it, with every hole spelled the same."""
    literal = const_str(node)
    if literal:
        return literal
    if isinstance(node, ast.JoinedStr):
        out = ""
        for part in node.values:
            if isinstance(part, ast.Constant) and isinstance(part.value, str):
                out += part.value
            else:
                out += "{}"
        return out
    return ""


def http_call(node: ast.Call) -> Optional[Tuple[str, str]]:
    """(verb, route) for a call that goes out over HTTP.

    The route has to look like one. `get` is the name of an HTTP verb and also
    the name of the method every mapping in Python has, and what tells the two
    apart is that only one of them is handed a path."""
    name = dotted(node.func)
    verb = name.split(".")[-1]
    if verb not in VERBS or not node.args:
        return None
    if verb == "request":
        if len(node.args) < 2:
            return None
        route = path_of(node.args[1])
        return (const_str(node.args[0]).upper(), route) if is_route(route) else None
    route = path_of(node.args[0])
    return (verb.upper(), route) if is_route(route) else None


def is_route(route: str) -> bool:
    return route.startswith("/") or route.startswith("http://") or route.startswith("https://")


def read_clients(app: App, peers: Dict[str, str], rel, b) -> List[Client]:
    out: List[Client] = []
    for module in app.package("clients"):
        directory = os.path.dirname(module.path)
        spec_path = openapi.beside(directory)
        spec = openapi.read(spec_path) if spec_path else None
        for node in module.classes():
            client = Client(name=node.name, module=module, directory=directory, spec=spec)
            for method in node.body:
                if not isinstance(method, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                for child in ast.walk(method):
                    if not isinstance(child, ast.Call):
                        continue
                    found = http_call(child)
                    if found is None:
                        continue
                    verb, route = found
                    client.calls[method.name] = resolve(verb, route, spec, module, os.path.basename(directory), rel, b)
                    break
            if client.calls:
                out.append(client)
        if spec is None and any(module.classes()):
            b.warn(module.rel, "no OpenAPI document beside this client: its calls name a route, and nothing says which operation answers there")
    for client in out:
        for call in client.calls.values():
            if call.resolved and call.pkg not in peers:
                b.warn(call.id, "%s answers this call and the manifest names no peer for it: the step stays unresolved" % call.pkg)
    return out


def resolve(verb: str, route: str, spec: Optional[openapi.Spec], module: Module, fallback: str, rel, b) -> Call:
    if spec is not None:
        operation = spec.find(verb, route)
        if operation is not None:
            return Call(id=operation.call_id(spec.api), pkg=spec.api, source=rel(spec.path), label=operation.id, resolved=True)
        b.warn(module.rel, "%s %s is not a route %s declares" % (verb, route, rel(spec.path)))
    return Call(id="%s %s" % (verb, route), pkg=fallback, source=module.rel, label="%s %s" % (verb, route), resolved=False)
