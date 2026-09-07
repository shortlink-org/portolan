"""Django URLConf, read without importing the project.

The runtime route table is assembled from ``path``/``re_path``, nested
``include`` calls and DRF routers.  Importing it would execute settings and
application code, so this module follows the same declarations through the
AST instead.  The result is deliberately the wire fact only: target view,
HTTP path and the URLConf line that declared it.
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Set, Tuple

from celery_conf import follow, settings_module_name, str_value
from source import Module, Project, const_str, dotted, keyword


@dataclass(frozen=True)
class Route:
    module: str
    view: str
    path: str
    source: str
    name: str = ""
    router: bool = False
    basename: str = ""
    parameters: Tuple[Tuple[str, str], ...] = ()


@dataclass
class Routes:
    root: Optional[Module]
    entries: List[Route]
    runtime_schema: str = ""

    def for_view(self, module: str, view: str) -> List[Route]:
        return [route for route in self.entries if route.module == module and route.view == view]


def read(project: Project, settings: str = "") -> Routes:
    root = root_urlconf(project, settings)
    if root is None:
        return Routes(None, [])
    entries: List[Route] = []
    runtime_schema = ""
    visit(project, root, "", (), entries, set())
    for node in ast.walk(root.tree):
        if isinstance(node, ast.Call) and dotted(node.func).split(".")[-1] in ("get_schema_view", "SpectacularAPIView"):
            runtime_schema = root.where(node)
            break
    return Routes(root, entries, runtime_schema)


def root_urlconf(project: Project, settings: str = "") -> Optional[Module]:
    settings_name = settings or settings_module_name(project)
    module = project.module(settings_name) if settings_name else None
    if module is not None:
        for node in module.tree.body:
            if not isinstance(node, (ast.Assign, ast.AnnAssign)):
                continue
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            if not any(isinstance(target, ast.Name) and target.id == "ROOT_URLCONF" for target in targets):
                continue
            value = node.value
            name = str_value(follow(value, module), module)
            if name and project.module(name) is not None:
                return project.module(name)
        package = settings_name.rsplit(".", 1)[0] if "." in settings_name else ""
        if package and project.module(package + ".urls") is not None:
            return project.module(package + ".urls")

    # Conventional fallback for small projects whose settings are assembled
    # dynamically: prefer a URLConf beside manage.py's package, otherwise the
    # only non-application URLConf in the tree.
    candidates = [m for m in project.modules.values() if m.dotted.endswith(".urls") or m.dotted == "urls"]
    return candidates[0] if len(candidates) == 1 else None


def visit(project: Project, module: Module, prefix: str, prefix_parameters: Tuple[Tuple[str, str], ...], out: List[Route], seen: Set[Tuple[str, str]]) -> None:
    key = (module.dotted, prefix)
    if key in seen:
        return
    seen.add(key)

    for node in ast.walk(module.tree):
        if not isinstance(node, ast.Call) or dotted(node.func).split(".")[-1] not in ("path", "re_path", "url"):
            continue
        if len(node.args) < 2:
            continue
        # An empty string is a route too: `path("", include("invoices.urls"))`
        # mounts an application at the root, and `path("", index)` is the
        # root itself.  Only a pattern that is not a literal is skipped.
        first = node.args[0]
        if not (isinstance(first, ast.Constant) and isinstance(first.value, str)):
            continue
        fragment = first.value
        regex = dotted(node.func).split(".")[-1] != "path"
        path = join_path(prefix, fragment, regex)
        parameters = prefix_parameters + route_parameters(fragment, regex)
        target = node.args[1]
        if isinstance(target, ast.Call) and dotted(target.func).split(".")[-1] == "include":
            included = include_module(project, module, target)
            if included is not None:
                visit(project, included, path, parameters, out, seen)
            continue
        resolved = view_target(project, module, target)
        if resolved is None:
            continue
        target_module, view = resolved
        out.append(Route(target_module, view, path, module.where(node), const_str(keyword(node, "name")), parameters=parameters))

    # ``urlpatterns = router.urls`` contributes routes without a path() call.
    # Each registration is mounted at every prefix by which this URLConf was
    # reached from the root.
    for node in ast.walk(module.tree):
        if not isinstance(node, ast.Call) or dotted(node.func).split(".")[-1] != "register" or len(node.args) < 2:
            continue
        route_prefix = const_str(node.args[0]).strip("^/$")
        resolved = view_target(project, module, node.args[1])
        if not route_prefix or resolved is None:
            continue
        target_module, view = resolved
        basename = const_str(keyword(node, "basename")) or route_prefix.replace("/", "_")
        out.append(Route(target_module, view, join_path(prefix, route_prefix + "/"), module.where(node), router=True, basename=basename, parameters=prefix_parameters))


def route_parameters(fragment: str, regex: bool = False) -> Tuple[Tuple[str, str], ...]:
    if regex:
        return tuple((match.group(1), "str") for match in re.finditer(r"\(\?P<([A-Za-z_][A-Za-z0-9_]*)>[^)]+\)", fragment))
    return tuple(
        (match.group(2), match.group(1) or "str")
        for match in re.finditer(r"<(?:(str|int|slug|uuid|path):)?([A-Za-z_][A-Za-z0-9_]*)>", fragment)
    )


def include_module(project: Project, module: Module, call: ast.Call) -> Optional[Module]:
    if not call.args:
        return None
    value = call.args[0]
    if isinstance(value, (ast.Tuple, ast.List)) and value.elts:
        value = value.elts[0]
    name = const_str(value)
    if name:
        return project.module(name)
    resolved = imported_name(project, module, dotted(value))
    return project.module(resolved) if resolved else None


def view_target(project: Project, module: Module, node: ast.AST) -> Optional[Tuple[str, str]]:
    # Decorators and ``SomeView().as_view()`` wrap the same target.  Peeling
    # calls is safe here because only names are read; nothing is executed.
    while isinstance(node, ast.Call):
        name = dotted(node.func)
        if name.endswith(".as_view"):
            node = node.func.value  # type: ignore[union-attr]
            continue
        if node.args and name.split(".")[-1] in ("csrf_exempt", "login_required", "permission_required"):
            node = node.args[0]
            continue
        if isinstance(node.func, ast.Attribute) and node.func.attr == "as_view":
            node = node.func.value
            continue
        break
    name = dotted(node)
    if not name:
        return None
    parts = name.split(".")
    resolved = imported_name(project, module, name)
    if resolved:
        parts = resolved.split(".")
        for end in range(len(parts) - 1, 0, -1):
            target_module = ".".join(parts[:end])
            if project.module(target_module) is not None:
                return target_module, ".".join(parts[end:])
    if len(parts) == 1:
        return module.dotted, parts[0]
    return None


def imported_name(project: Project, module: Module, name: str) -> str:
    parts = name.split(".")
    imported = module.imports.get(parts[0])
    if imported is None:
        return name if project.module(".".join(parts[:-1])) is not None else ""
    base = imported.module
    if imported.name != "*":
        base = ".".join(part for part in (base, imported.name) if part)
    rest = parts[1:]
    # ``from avia.views import booking`` names the submodule
    # ``avia.views.booking``; ``from .views import View`` names the class in
    # ``app.views``.  Prefer the longest prefix that is an actual module.
    candidates = []
    combined = [part for part in base.split(".") if part] + rest
    for end in range(len(combined), 0, -1):
        prefix = ".".join(combined[:end])
        if project.module(prefix) is not None:
            candidates.append(prefix + ("." + ".".join(combined[end:]) if combined[end:] else ""))
    return candidates[0] if candidates else ".".join(combined)


def join_path(prefix: str, fragment: str, regex: bool = False) -> str:
    value = fragment
    if regex:
        value = value.removeprefix("^").removesuffix("$")
        value = re.sub(r"\(\?P<([A-Za-z_][A-Za-z0-9_]*)>[^)]+\)", r"{\1}", value)
        value = value.replace("\\/", "/")
        value = re.sub(r"\\[AbZ]", "", value)
    value = re.sub(r"<(?:(?:str|int|slug|uuid|path):)?([A-Za-z_][A-Za-z0-9_]*)>", r"{\1}", value)
    joined = "/".join(part.strip("/") for part in (prefix, value) if part.strip("/"))
    trailing = value.endswith("/")
    return "/" + joined + ("/" if trailing and joined else "")
