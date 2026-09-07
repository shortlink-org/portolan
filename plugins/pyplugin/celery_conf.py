"""Where a task goes: the app's configuration, read as syntax.

A Django project configures Celery in one of two places, and usually both: the
app module, `app = Celery("billing")` followed by `app.conf.update(...)` or
`app.conf.task_routes = ...`, and the settings module the app is told to read
with `config_from_object("django.conf:settings", namespace="CELERY")`, where
every key is spelled in upper case under that prefix. Both are read here, the
settings first and the app's own assignments over them, which is the order
Celery applies them in.

Three keys decide a queue: `task_routes`, `task_default_queue` and
`broker_url`. A fourth, `beat_schedule`, says what the clock sets off - and
so does `app.add_periodic_task(...)`, wherever it is called. A value that is
not a literal is read as far as it goes - `os.environ.get("X", default)` is
its default - and past that it is unknown, which is said rather than guessed.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass, field
from fnmatch import fnmatchcase
from typing import Dict, List, Optional, Tuple

from source import Module, Project, assigned, const_str, dotted, keyword, keyword_str

# Celery's own default queue, used when nothing in the tree says otherwise.
DEFAULT_QUEUE = "celery"

# The pre-4.0 spellings, still accepted by Celery and still found in settings.
LEGACY = {
    "CELERY_ROUTES": "task_routes",
    "CELERY_DEFAULT_QUEUE": "task_default_queue",
    "BROKER_URL": "broker_url",
    "CELERYBEAT_SCHEDULE": "beat_schedule",
}

KNOWN = {"task_routes", "task_default_queue", "broker_url", "beat_schedule"}

# The application that keeps the schedule in the database instead of the tree.
BEAT_IN_DATABASE = "django_celery_beat"


@dataclass
class App:
    """A `Celery(...)` instance: the module it lives in and the name it is
    bound to there, which is what `@app.task` is resolved against."""

    module: Module
    name: str
    node: ast.Call
    namespace: str = ""


@dataclass
class Schedule:
    """One thing the clock sets off: a `beat_schedule` entry, or one call of
    `add_periodic_task`. The task is named on the wire (`task`) or as the
    signature spells it (`ref`, resolved by whoever holds the task index)."""

    name: str  # the entry's key, or the `name=` the call gave
    when: str  # "cron 0 9 * * *", "every 6h" - or the expression as written, when opaque
    module: Module  # where it is declared
    node: ast.AST
    task: str = ""  # the wire name, when the entry says one
    ref: str = ""  # the task as `add_periodic_task` names it, when it is a signature
    queue: str = ""  # `options={"queue": ...}` or a `queue=` on the call
    opaque: bool = False  # the schedule was not readable as syntax

    @property
    def where(self) -> str:
        return self.module.where(self.node)


@dataclass
class Config:
    routes: List[Tuple[str, str]] = field(default_factory=list)  # pattern -> queue, in declaration order
    default_queue: str = ""
    broker: str = ""
    settings: str = ""  # the settings module, as looked for
    settings_found: bool = False
    opaque: List[str] = field(default_factory=list)  # where a value could not be read
    apps: List[App] = field(default_factory=list)
    schedules: List[Schedule] = field(default_factory=list)  # in declaration order
    opaque_schedules: List[str] = field(default_factory=list)  # where a beat_schedule was not a mapping
    beat_in_database: bool = False  # django_celery_beat is installed

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
            if name == "INSTALLED_APPS":
                installed = follow(value, module)
                if isinstance(installed, (ast.List, ast.Tuple)) and any(const_str(e) == BEAT_IN_DATABASE for e in installed.elts):
                    cfg.beat_in_database = True

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

    # `add_periodic_task` is the other way to say what the clock sets off,
    # usually under `@app.on_after_configure.connect`, where the app arrives
    # as `sender`; so it is read by the method's name, wherever it is called.
    for module in sorted(project.modules.values(), key=lambda m: m.rel):
        for node in ast.walk(module.tree):
            if isinstance(node, ast.Call) and dotted(node.func).split(".")[-1] == "add_periodic_task" and len(node.args) >= 2:
                cfg.schedules.append(periodic_task(node, module))
    return cfg


def periodic_task(call: ast.Call, module: Module) -> Schedule:
    """`sender.add_periodic_task(crontab(hour=3), close_stale_drafts.s(), name="...")`."""
    when, readable = schedule_text(call.args[0], module)
    signature = call.args[1]
    ref = ""
    if isinstance(signature, ast.Call) and isinstance(signature.func, ast.Attribute) and signature.func.attr in ("s", "si", "signature", "subtask"):
        ref = dotted(signature.func.value)
    else:
        ref = dotted(signature)
    name = keyword_str(call, "name") or ref.split(".")[-1]
    return Schedule(name, when, module, call, ref=ref, queue=keyword_str(call, "queue"), opaque=not readable)


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
    elif key == "beat_schedule":
        read_beat(cfg, value, module)


def read_beat(cfg: Config, node: ast.AST, module: Module) -> None:
    """`{"nightly": {"task": "pkg.tasks.nightly", "schedule": crontab(hour=2),
    "options": {"queue": "slow"}}}`, entry by entry, in the order written."""
    node = follow(node, module)
    if not isinstance(node, ast.Dict):
        cfg.opaque_schedules.append(module.where(node) if node is not None else module.rel)
        return
    for key, spec in zip(node.keys, node.values):
        name = const_str(key) if key is not None else ""
        spec = follow(spec, module)
        if not name or not isinstance(spec, ast.Dict):
            cfg.opaque_schedules.append(module.where(spec if spec is not None else node))
            continue
        fields = {const_str(k): v for k, v in zip(spec.keys, spec.values) if k is not None and const_str(k)}
        when, readable = schedule_text(fields.get("schedule"), module)
        cfg.schedules.append(
            Schedule(
                name,
                when,
                module,
                spec,
                task=str_value(fields.get("task"), module),
                queue=route_queue(fields["options"], module) if "options" in fields else "",
                opaque=not readable,
            )
        )


# --- a schedule, as text ----------------------------------------------------
#
# Celery's schedule is an object - a crontab, a timedelta, a number of seconds
# - and the page wants a sentence. The forms the documentation gives are read
# into the spellings a reader already knows: `cron 0 9 * * *` in crontab's own
# field order, `every 6h` for an interval. Anything else is kept as written and
# marked opaque, which the caller says out loud.

CRON_FIELDS = ("minute", "hour", "day_of_month", "month_of_year", "day_of_week")


def schedule_text(node: Optional[ast.AST], module: Module) -> Tuple[str, bool]:
    """(text, readable): the schedule as a sentence, and whether syntax
    actually said so."""
    node = follow(node, module)
    if node is None:
        return "", False
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
        return "every " + interval(float(node.value)), True
    if isinstance(node, ast.Call):
        last = dotted(node.func).split(".")[-1]
        if last == "crontab":
            given = {kw.arg: cron_field(kw.value) for kw in node.keywords if kw.arg in CRON_FIELDS}
            for position, arg in enumerate(node.args[: len(CRON_FIELDS)]):
                given.setdefault(CRON_FIELDS[position], cron_field(arg))
            if any(value is None for value in given.values()):
                return unparse(node), False
            return "cron " + " ".join(given.get(field_, "*") or "*" for field_ in CRON_FIELDS), True
        if last == "timedelta":
            seconds = timedelta_seconds(node)
            if seconds is None:
                return unparse(node), False
            return "every " + interval(seconds), True
        if last == "schedule":
            inner = keyword(node, "run_every") if keyword(node, "run_every") is not None else (node.args[0] if node.args else None)
            return schedule_text(inner, module)
        if last == "solar" and node.args and const_str(node.args[0]):
            return "solar " + const_str(node.args[0]), True
    return unparse(node), False


def cron_field(node: ast.AST) -> Optional[str]:
    if isinstance(node, ast.Constant) and isinstance(node.value, (str, int)) and not isinstance(node.value, bool):
        return str(node.value)
    return None


TIMEDELTA_UNITS = {"weeks": 604800.0, "days": 86400.0, "hours": 3600.0, "minutes": 60.0, "seconds": 1.0, "milliseconds": 0.001}
TIMEDELTA_POSITIONS = ("days", "seconds", "microseconds", "milliseconds", "minutes", "hours", "weeks")


def timedelta_seconds(call: ast.Call) -> Optional[float]:
    total = 0.0
    parts = [(TIMEDELTA_POSITIONS[i], arg) for i, arg in enumerate(call.args[: len(TIMEDELTA_POSITIONS)])]
    parts += [(kw.arg or "", kw.value) for kw in call.keywords]
    for unit, value in parts:
        if unit not in TIMEDELTA_UNITS or not (isinstance(value, ast.Constant) and isinstance(value.value, (int, float)) and not isinstance(value.value, bool)):
            return None
        total += float(value.value) * TIMEDELTA_UNITS[unit]
    return total


def interval(seconds: float) -> str:
    """90 -> "1m30s", 21600 -> "6h", 0.5 -> "0.5s"."""
    if seconds != int(seconds):
        return "%gs" % seconds
    whole = int(seconds)
    out = ""
    for unit, size in (("d", 86400), ("h", 3600), ("m", 60)):
        if whole >= size:
            out += "%d%s" % (whole // size, unit)
            whole %= size
    if whole or not out:
        out += "%ds" % whole
    return out


def unparse(node: ast.AST) -> str:
    try:
        return ast.unparse(node)
    except Exception:  # a node ast.unparse does not know
        return type(node).__name__


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
