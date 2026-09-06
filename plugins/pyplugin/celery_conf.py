"""Where a task goes: the app's configuration, read as syntax.

A Django project configures Celery in one of two places, and usually both: the
app module, `app = Celery("billing")` followed by `app.conf.update(...)` or
`app.conf.task_routes = ...`, and the settings module the app is told to read
with `config_from_object("django.conf:settings", namespace="CELERY")`, where
every key is spelled in upper case under that prefix. Both are read here, the
settings first and the app's own assignments over them, which is the order
Celery applies them in.

Three keys decide a queue and are the only ones read: `task_routes`,
`task_default_queue` and `broker_url`. A value that is not a literal is read
as far as it goes - `os.environ.get("X", default)` is its default - and past
that it is unknown, which is said rather than guessed.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass, field
from fnmatch import fnmatchcase
from typing import Dict, List, Optional, Tuple

from source import Module, Project, assigned, const_str, dotted, keyword

# Celery's own default queue, used when nothing in the tree says otherwise.
DEFAULT_QUEUE = "celery"

# The pre-4.0 spellings, still accepted by Celery and still found in settings.
LEGACY = {
    "CELERY_ROUTES": "task_routes",
    "CELERY_DEFAULT_QUEUE": "task_default_queue",
    "BROKER_URL": "broker_url",
}

KNOWN = {"task_routes", "task_default_queue", "broker_url"}


@dataclass
class App:
    """A `Celery(...)` instance: the module it lives in and the name it is
    bound to there, which is what `@app.task` is resolved against."""

    module: Module
    name: str
    node: ast.Call
    namespace: str = ""


@dataclass
class Config:
    routes: List[Tuple[str, str]] = field(default_factory=list)  # pattern -> queue, in declaration order
    default_queue: str = ""
    broker: str = ""
    settings: str = ""  # the settings module, as looked for
    settings_found: bool = False
    opaque: List[str] = field(default_factory=list)  # where a value could not be read
    apps: List[App] = field(default_factory=list)

    @property
    def broker_scheme(self) -> str:
        return self.broker.split("://", 1)[0] if "://" in self.broker else ""


def find_apps(project: Project) -> List[App]:
    """Every module-level `X = Celery(...)`, in path order."""
    out = []
    for module in sorted(project.modules.values(), key=lambda m: m.rel):
        for name, value, _ in assigned(module.tree):
            if isinstance(value, ast.Call) and dotted(value.func).split(".")[-1] == "Celery":
                out.append(App(module, name, value))
    return out


def settings_module_name(project: Project) -> str:
    """What `manage.py` sets `DJANGO_SETTINGS_MODULE` to, or the app module
    does; the settings module is otherwise nowhere written down."""
    for module in sorted(project.modules.values(), key=lambda m: m.rel):
        if module.dotted.split(".")[-1] not in ("manage", "celery", "wsgi", "asgi"):
            continue
        for node in ast.walk(module.tree):
            if isinstance(node, ast.Call) and dotted(node.func).split(".")[-1] == "setdefault":
                if len(node.args) == 2 and const_str(node.args[0]) == "DJANGO_SETTINGS_MODULE":
                    return const_str(node.args[1])
            if isinstance(node, ast.Assign) and len(node.targets) == 1:
                target = node.targets[0]
                if isinstance(target, ast.Subscript) and dotted(target.value) == "os.environ" and const_str(target.slice) == "DJANGO_SETTINGS_MODULE":
                    return const_str(node.value)
    return ""


def read_config(project: Project, settings: str) -> Config:
    cfg = Config(apps=find_apps(project))

    # The app first, for the namespace the settings are read under.
    for app in cfg.apps:
        for node in ast.walk(app.module.tree):
            if isinstance(node, ast.Call) and dotted(node.func) == app.name + ".config_from_object":
                app.namespace = const_str(keyword(node, "namespace"))
        broker = keyword(app.node, "broker")
        if broker is not None:
            cfg.broker = str_value(broker, app.module) or cfg.broker

    cfg.settings = settings or settings_module_name(project)
    module = project.module(cfg.settings) if cfg.settings else None
    if module is not None:
        cfg.settings_found = True
        namespaces = [app.namespace for app in cfg.apps if app.namespace]
        for name, value, _ in assigned(module.tree):
            key = settings_key(name, namespaces)
            if key:
                apply(cfg, key, value, module)

    # Then what the app module assigns itself, over the settings.
    for app in cfg.apps:
        for node in app.module.tree.body:
            if isinstance(node, ast.Assign) and len(node.targets) == 1:
                target = dotted(node.targets[0])
                prefix = app.name + ".conf."
                if target.startswith(prefix):
                    apply(cfg, target[len(prefix):].lower(), node.value, app.module)
            call = node.value if isinstance(node, ast.Expr) else None
            if isinstance(call, ast.Call) and dotted(call.func) == app.name + ".conf.update":
                for kw in call.keywords:
                    if kw.arg:
                        apply(cfg, kw.arg.lower(), kw.value, app.module)
    return cfg


def settings_key(name: str, namespaces: List[str]) -> str:
    """`CELERY_TASK_ROUTES` under the `CELERY` namespace is `task_routes`;
    without a namespace the new-style lower-case keys and the legacy upper-case
    ones are what Celery itself accepts."""
    for namespace in namespaces:
        prefix = namespace + "_"
        if name.startswith(prefix):
            key = name[len(prefix):].lower()
            return key if key in KNOWN else ""
    if namespaces:
        return ""
    if name in LEGACY:
        return LEGACY[name]
    return name if name in KNOWN else ""


def apply(cfg: Config, key: str, value: ast.AST, module: Module) -> None:
    if key == "task_routes":
        routes = read_routes(value, module)
        if routes is None:
            cfg.opaque.append(module.where(value))
        else:
            cfg.routes = routes
    elif key == "task_default_queue":
        cfg.default_queue = str_value(value, module) or cfg.default_queue
    elif key == "broker_url":
        cfg.broker = str_value(value, module) or cfg.broker


def read_routes(node: ast.AST, module: Module) -> Optional[List[Tuple[str, str]]]:
    """`{"pkg.tasks.send": {"queue": "mail"}}`, or the same as a list of pairs.
    A router function, or anything else that is not a literal, is None: the
    routes are decided at run time and this reader does not run anything."""
    node = follow(node, module)
    pairs: List[Tuple[ast.AST, ast.AST]] = []
    if isinstance(node, ast.Dict):
        pairs = [(k, v) for k, v in zip(node.keys, node.values) if k is not None]
    elif isinstance(node, (ast.List, ast.Tuple)):
        for element in node.elts:
            if isinstance(element, ast.Tuple) and len(element.elts) == 2:
                pairs.append((element.elts[0], element.elts[1]))
            elif isinstance(element, ast.Dict):
                pairs += [(k, v) for k, v in zip(element.keys, element.values) if k is not None]
            else:
                return None
    else:
        return None
    out = []
    for key, spec in pairs:
        pattern = const_str(key)
        queue = route_queue(spec, module)
        if pattern and queue:
            out.append((pattern, queue))
    return out


def route_queue(spec: ast.AST, module: Module) -> str:
    spec = follow(spec, module)
    if isinstance(spec, ast.Dict):
        for key, value in zip(spec.keys, spec.values):
            if key is not None and const_str(key) == "queue":
                return str_value(value, module)
        return ""
    return str_value(spec, module)


def str_value(node: Optional[ast.AST], module: Module) -> str:
    """A string as far as syntax carries it: the literal, the default of an
    environment lookup, or a module-level constant, followed once."""
    node = follow(node, module)
    if node is None:
        return ""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Call):
        name = dotted(node.func)
        last = name.split(".")[-1]
        if last in ("get", "getenv") and (name.startswith("os.environ") or name == "os.getenv" or name == "getenv"):
            default = node.args[1] if len(node.args) > 1 else keyword(node, "default")
            return str_value(default, module)
        if last in ("env", "str") and name.split(".")[0] in ("env", "environ", "config"):
            default = node.args[1] if len(node.args) > 1 else keyword(node, "default")
            return str_value(default, module)
    return ""


def follow(node: Optional[ast.AST], module: Module) -> Optional[ast.AST]:
    """A bare name is the module-level assignment it refers to, once."""
    if isinstance(node, ast.Name):
        for name, value, _ in assigned(module.tree):
            if name == node.id:
                return value
    return node


def apps_by_module(cfg: Config) -> Dict[Tuple[str, str], App]:
    return {(app.module.dotted, app.name): app for app in cfg.apps}


# --- which queue a task lands on, decided the way Celery decides it ---------
#
# The call comes first, `apply_async(queue=...)`; then the decorator's `queue=`;
# then `task_routes`, an exact name before a glob, in the order they are
# written; then `task_default_queue`; and past all of those Celery's own
# `celery`. Every answer says which rule gave it, so a page can say "routed by
# task_routes" rather than leave a reader to work it out.

from typing import List, Tuple


AT_CALL = "named at the call"
ON_TASK = "named on the task"
BY_ROUTES = "routed by task_routes"
BY_DEFAULT = "the default queue"
BY_CELERY = "Celery's own default"


def queue_for(wire: str, at_call: str, on_task: str, cfg: Config) -> Tuple[str, str]:
    if at_call:
        return at_call, AT_CALL
    if on_task:
        return on_task, ON_TASK
    for pattern, queue in cfg.routes:
        if matches(pattern, wire):
            return queue, BY_ROUTES
    if cfg.default_queue:
        return cfg.default_queue, BY_DEFAULT
    return DEFAULT_QUEUE, BY_CELERY


def matches(pattern: str, wire: str) -> bool:
    """Celery takes a glob - `invoices.tasks.*` - and a compiled regex; only
    the glob is syntax, so only the glob is matched here."""
    return pattern == wire or fnmatchcase(wire, pattern)


def unmatched(cfg: Config, wires: List[str]) -> List[str]:
    """Route patterns that name no task in the tree: a route to nowhere is
    stale, or the task moved."""
    return [pattern for pattern, _ in cfg.routes if not any(matches(pattern, wire) for wire in wires)]
