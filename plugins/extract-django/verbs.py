"""Which HTTP verb a mounted handler answers, read from what the code declares.

A URLConf can mount any callable — ``path("planet/fetch", Planet.fetch)`` —
and then the route table proves the path but says nothing about the verb.
The verb is still written down somewhere in the handler, in one of the ways
Django and DRF offer for it, and this module reads them in the order a
reviewer would trust them:

1. a decorator on the handler: DRF's ``@action(methods=…)`` and ``@api_view``,
   Django's ``@require_http_methods([…])``, ``@require_GET``, ``@require_POST``
   and ``@require_safe``, also through ``method_decorator(…)``;
2. the same decorators on the class, ``@method_decorator(…, name="dispatch")``;
3. the class's ``http_method_names``;
4. a branch on ``request.method`` in the handler body;
5. a project wrapper — a decorator or a function the handler hands ``request``
   to — whose own body does one of the above, followed a bounded number of
   levels deep.

The first tier that speaks decides. Nothing here is guessed: a handler none
of the tiers describes has no verb, and the caller says so rather than
inventing one.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from typing import List, Optional, Set, Tuple

from source import Module, Project, const_str, dotted, keyword, methods, node_name

HTTP_VERBS = ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE")

# What a framework answers for every route regardless of the handler; listing
# them never says what the handler is for, so they are dropped when any other
# verb is named beside them.
IMPLICIT = {"HEAD", "OPTIONS", "TRACE"}

SHORTHAND = {"require_GET": ("GET",), "require_POST": ("POST",), "require_safe": ("GET",)}
LISTED = ("require_http_methods", "action", "api_view")

# How far a project wrapper is followed before the reader stops. Two levels
# cover a decorator that wraps a decorator; anything deeper is a project that
# should declare its verb where the handler is.
DEPTH = 3


@dataclass(frozen=True)
class Evidence:
    verbs: Tuple[str, ...]
    rule: str  # "decorator", "class decorator", "http_method_names", "request.method", "wrapper <name>"
    source: str  # file:line of what was read


class Reader:
    def __init__(self, project: Optional[Project]):
        self.project = project

    # --- the tiers -----------------------------------------------------------

    def for_handler(self, module: Module, handler: ast.AST, owner: Optional[ast.ClassDef] = None) -> Optional[Evidence]:
        found = self.decorators(module, handler, handler_name=getattr(handler, "name", ""))
        if found is None and owner is not None:
            found = self.decorators(module, owner, handler_name=getattr(handler, "name", ""), rule="class decorator")
        if found is None and owner is not None:
            found = self.method_names(module, owner)
        if found is None:
            found = self.branches(module, handler)
        if found is None:
            found = self.wrappers(module, handler, owner, DEPTH, set())
        return found

    def decorators(self, module: Module, node: ast.AST, handler_name: str = "", rule: str = "decorator") -> Optional[Evidence]:
        for dec in getattr(node, "decorator_list", []) or []:
            inner = dec
            # ``method_decorator(require_POST)`` on a method, or on the class
            # with ``name=`` saying which method; ``dispatch`` means every one.
            if isinstance(inner, ast.Call) and dotted(inner.func).split(".")[-1] == "method_decorator" and inner.args:
                applies_to = const_str(keyword(inner, "name"))
                if rule == "class decorator" and applies_to not in ("", "dispatch", handler_name):
                    continue
                inner = inner.args[0]
            verbs = listed_verbs(inner)
            if verbs:
                return Evidence(verbs, rule, module.where(dec))
        return None

    def method_names(self, module: Module, owner: ast.ClassDef) -> Optional[Evidence]:
        for stmt in owner.body:
            if not isinstance(stmt, (ast.Assign, ast.AnnAssign)):
                continue
            targets = stmt.targets if isinstance(stmt, ast.Assign) else [stmt.target]
            if not any(isinstance(target, ast.Name) and target.id == "http_method_names" for target in targets):
                continue
            verbs = verbs_in(stmt.value)
            if verbs:
                return Evidence(verbs, "http_method_names", module.where(stmt))
        return None

    def branches(self, module: Module, node: ast.AST) -> Optional[Evidence]:
        found: List[str] = []
        where = ""
        for compare in ast.walk(node):
            if not isinstance(compare, ast.Compare):
                continue
            sides = [compare.left] + list(compare.comparators)
            if not any(is_request_method(side) for side in sides):
                continue
            for side in sides:
                for verb in verbs_in(side, filter_implicit=False):
                    if verb not in found:
                        found.append(verb)
                        where = where or module.where(compare)
        verbs = normalise(found)
        return Evidence(verbs, "request.method", where) if verbs else None

    def wrappers(self, module: Module, handler: ast.AST, owner: Optional[ast.ClassDef], depth: int, seen: Set[Tuple[str, str]]) -> Optional[Evidence]:
        if depth <= 0 or self.project is None:
            return None
        candidates: List[Tuple[Module, ast.AST, Optional[ast.ClassDef], str]] = []
        for dec in getattr(handler, "decorator_list", []) or []:
            target = dec.func if isinstance(dec, ast.Call) else dec
            resolved = self.callable_target(module, owner, target)
            if resolved is not None:
                candidates.append(resolved + (dotted(target),))
        for call in ast.walk(handler):
            if not isinstance(call, ast.Call) or not passes_request(call):
                continue
            resolved = self.callable_target(module, owner, call.func)
            if resolved is not None:
                candidates.append(resolved + (dotted(call.func),))
        for target_module, target, target_owner, name in candidates:
            key = (target_module.dotted, node_name(target) if not target_owner else target_owner.name + "." + node_name(target))
            if key in seen:
                continue
            seen.add(key)
            found = self.decorators(target_module, target) or self.calls(target_module, target) or self.branches(target_module, target)
            if found is None:
                found = self.wrappers(target_module, target, target_owner, depth - 1, seen)
            if found is not None:
                return Evidence(found.verbs, "wrapper %s" % name, found.source)
        return None

    def calls(self, module: Module, node: ast.AST) -> Optional[Evidence]:
        """``return require_POST(view)`` inside a project decorator: the
        framework decorator applied by hand rather than with ``@``."""
        for call in ast.walk(node):
            if not isinstance(call, ast.Call):
                continue
            for candidate in (call, call.func):
                verbs = listed_verbs(candidate)
                if verbs:
                    return Evidence(verbs, "decorator", module.where(call))
        return None

    # --- names ---------------------------------------------------------------

    def callable_target(self, module: Module, owner: Optional[ast.ClassDef], node: ast.AST) -> Optional[Tuple[Module, ast.AST, Optional[ast.ClassDef]]]:
        """A project function or method this name refers to; nothing for a
        framework name, a builtin or anything the imports do not explain."""
        name = dotted(node)
        if not name or self.project is None:
            return None
        parts = name.split(".")
        if len(parts) == 2 and parts[0] in ("self", "cls") and owner is not None:
            for item in methods(owner):
                if item.name == parts[1]:
                    return module, item, owner
            return None
        if len(parts) == 1:
            hit = self.project.resolve(module, name)
            if hit is None:
                return None
            target = function_in(hit[0], hit[1])
            return (hit[0], target, None) if target is not None else None
        imported = module.imports.get(parts[0])
        if imported is None:
            return None
        target_module = self.project.module(".".join([imported.module] + ([] if imported.name == "*" else [imported.name]) + parts[1:-1]))
        if target_module is None:
            return None
        target = function_in(target_module, parts[-1])
        return (target_module, target, None) if target is not None else None


def function_in(module: Module, name: str) -> Optional[ast.AST]:
    for node in module.tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return node
    return None


def listed_verbs(node: ast.AST) -> Tuple[str, ...]:
    """The verbs a framework decorator names, however it was imported:
    ``@require_http_methods(["GET", "POST"])``, ``@action(methods=["post"])``,
    ``@api_view(["GET"])``, or the ``require_POST`` shorthand."""
    name = dotted(node.func if isinstance(node, ast.Call) else node).split(".")[-1]
    if name in SHORTHAND:
        return SHORTHAND[name]
    if not isinstance(node, ast.Call) or name not in LISTED:
        return ()
    listed = keyword(node, "methods") or keyword(node, "request_method_list") or keyword(node, "http_method_names")
    if listed is None and node.args:
        listed = node.args[0]
    if listed is None and name in ("action", "api_view"):
        # DRF's documented default when the decorator names no methods.
        return ("GET",)
    return verbs_in(listed)


def verbs_in(node: Optional[ast.AST], filter_implicit: bool = True) -> Tuple[str, ...]:
    """The HTTP verbs a literal spells, upper-cased; anything that is not one
    is left out, so ``["get", "frobnicate"]`` reads as GET alone."""
    if node is None:
        return ()
    items = node.elts if isinstance(node, (ast.List, ast.Tuple, ast.Set)) else [node]
    found = [const_str(item).upper() for item in items if const_str(item)]
    return normalise(found) if filter_implicit else tuple(verb for verb in found if verb in HTTP_VERBS)


def normalise(found: List[str]) -> Tuple[str, ...]:
    verbs = [verb for verb in found if verb in HTTP_VERBS]
    explicit = [verb for verb in verbs if verb not in IMPLICIT]
    out: List[str] = []
    for verb in explicit or verbs:
        if verb not in out:
            out.append(verb)
    return tuple(out)


def is_request_method(node: ast.AST) -> bool:
    """``request.method``, ``self.request.method``, or either through
    ``.upper()``/``.lower()``."""
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in ("upper", "lower") and not node.args:
        node = node.func.value
    return dotted(node).endswith("request.method")


def passes_request(call: ast.Call) -> bool:
    values = list(call.args) + [kw.value for kw in call.keywords]
    return any(dotted(value) in ("request", "self.request") for value in values)
