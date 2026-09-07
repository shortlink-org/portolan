"""What happens when somebody calls in, or when an event arrives.

Statements are read in source order. A call into the ORM is a hop to the store,
an event handed to anything is a hop to the bus, a call on a vendored client is
a hop to the peer. An `if` becomes an alt whose branch is terminal when it ends
in a return or a raise; a loop, a transaction and an except are a note on the
steps inside them. Every step is `declared`: this reads code, and code is a
claim about behaviour, not a record of it.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass, field as dc_field
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse

import catalog
from clients import Client
from domain import Aggregate, ModelDef
from ids import pascal, slug
from operations import UseCase
import celery_conf
import celery_tasks
from source import Module, Project, assigned, doc, dotted, keyword, keyword_str, methods

LANE_CLIENT = "client"
LANE_BUS = "bus"

# What an enqueue looks like: the call, and the signature it may go through.
# The queue it lands on is decided the way Celery decides it, by the same
# reader `extract-celery` uses, so the lane here is the one its flow draws.
ENQUEUE = {"delay", "apply_async"}
SIGNATURE = {"s", "si", "signature", "subtask"}

# A call on the ORM that goes to the database. `objects.<anything>` does too,
# and is caught by the manager rather than by this list.
STORE_METHODS = {"save", "delete", "refresh_from_db", "update", "full_clean_and_save"}
# What a publish looks like. A signal's `send` is one; so is anything handed an
# event, which is the rule that catches a project's own `publish()` helper.
SEND_METHODS = {"send", "send_robust", "publish"}
# A publish with an address: the topic, subject or channel goes first, and is
# read as far as syntax carries it - a literal, a module constant, a setting.
# `KafkaProducer.send`, confluent's `produce`, NATS and Redis `publish`,
# Channels' `group_send`.
PRODUCE_METHODS = {"send", "produce", "publish", "group_send"}
# Django's own model signals: a hook on the row, not an event. A receiver on
# one is reported, not drawn.
ORM_SIGNALS = {"pre_init", "post_init", "pre_save", "post_save", "pre_delete", "post_delete", "m2m_changed", "pre_migrate", "post_migrate"}
HTTP_LIBRARIES = {"requests", "httpx", "aiohttp"}
HTTP_METHODS = {"get", "post", "put", "patch", "delete", "head", "options"}
MAX_CALL_DEPTH = 5


def sender_of(decorator: ast.Call) -> str:
    """`sender=Invoice`, or the models listed, or every model when none is named."""
    value = keyword(decorator, "sender")
    if value is None:
        return "every model"
    if isinstance(value, (ast.List, ast.Tuple)):
        return ", ".join(dotted(v) for v in value.elts if dotted(v)) or "every model"
    return dotted(value) or "every model"


@dataclass
class Options:
    context: str
    svc_id: str
    service: str
    store: str
    stores: Dict[str, str] = dc_field(default_factory=dict)
    peers: Dict[str, str] = dc_field(default_factory=dict)
    events: Dict[str, str] = dc_field(default_factory=dict)
    settings: str = ""  # the Django settings module Celery is configured from


class Draft:
    """One flow being built: the lanes in the order they are first used, and
    the steps, which nest when a branch is open."""

    def __init__(self) -> None:
        self.lanes: List[Dict[str, object]] = []
        self.steps: List[Dict[str, object]] = []
        self.sinks: List[List[Dict[str, object]]] = []
        self.n = 0
        self.notes: List[str] = []

    def lane(self, id_: str, kind: str, context: Optional[str], label: str = "") -> str:
        if not any(l["id"] == id_ for l in self.lanes):
            self.lanes.append(catalog.participant(id_, kind, context, label))
        return id_

    def sink(self) -> List[Dict[str, object]]:
        return self.sinks[-1] if self.sinks else self.steps

    def push(self) -> None:
        self.sinks.append([])

    def pop(self) -> List[Dict[str, object]]:
        return self.sinks.pop() if self.sinks else []

    def enter(self, note: str) -> None:
        self.notes.append(note)

    def leave(self) -> None:
        self.notes.pop()

    def note(self, own: str) -> str:
        outer = []
        for note in self.notes:
            if note and note not in outer:
                outer.append(note)
        prefix = ", ".join(outer) + "." if outer else ""
        return (prefix + " " + own).strip()

    def add(
        self,
        from_: str,
        to: str,
        kind: str,
        label: str,
        status: str = catalog.DECLARED,
        ref: str = "",
        note: str = "",
        line: str = "",
        continues_at: str = "",
        handoff: Optional[Dict[str, str]] = None,
    ) -> None:
        self.n += 1
        self.sink().append(
            catalog.step(
                "s%d" % self.n,
                from_,
                to,
                kind,
                label,
                status,
                ref,
                self.note(note),
                line,
                continues_at,
                handoff,
            )
        )

    def add_alt(self, branches: List[Dict[str, object]]) -> None:
        self.n += 1
        self.sink().append(catalog.alt("alt%d" % self.n, branches))


def sentence(text: str) -> str:
    words = text.replace("-", " ").replace("_", " ").strip()
    return words[0].upper() + words[1:] if words else ""


def condition(node: ast.AST) -> str:
    try:
        text = ast.unparse(node)  # type: ignore[attr-defined]
    except Exception:
        return ""
    text = " ".join(text.split())
    return text if len(text) <= 72 else text[:69] + "..."


@dataclass(frozen=True)
class ClassTarget:
    module: Module
    node: ast.ClassDef


@dataclass(frozen=True)
class CallableTarget:
    module: Module
    node: ast.AST
    owner: Optional[ClassTarget] = None

    @property
    def key(self) -> Tuple[str, str, str]:
        return (self.module.dotted, self.owner.node.name if self.owner is not None else "", getattr(self.node, "name", ""))


class Frame:
    """What a name means inside one body being walked."""

    def __init__(
        self,
        module: Module,
        variables: Optional[Dict[str, Tuple[str, object]]] = None,
        owner: Optional[ClassTarget] = None,
        active: Tuple[Tuple[str, str, str], ...] = (),
    ):
        self.module = module
        self.vars: Dict[str, Tuple[str, object]] = dict(variables or {})
        self.returned: Optional[Tuple[str, object]] = None
        self.owner = owner
        self.active = active


class FlowReader:
    def __init__(self, opts: Options, project: Project, aggregates: List[Aggregate], models: List[ModelDef], use_cases: List[UseCase], clients: List[Client], events: Dict[str, object], rel, b):
        self.opts = opts
        self.project = project
        self.aggregates = aggregates
        self.rel = rel
        self.b = b
        self.calls: Dict[str, Dict[str, object]] = {}
        self.referenced = set()
        self.models: Dict[str, ModelDef] = {}
        self.models_by_name: Dict[str, List[ModelDef]] = {}
        self.emitters: Dict[Tuple[str, str], str] = {}  # (model, method) -> event id
        seen_models = set()
        for model in models:
            key = (model.module.dotted, model.name)
            if key in seen_models:
                continue
            seen_models.add(key)
            self.models_by_name.setdefault(model.name, []).append(model)
        for agg in aggregates:
            for model in agg.models:
                key = (model.module.dotted, model.name)
                if key in seen_models:
                    continue
                seen_models.add(key)
                self.models_by_name.setdefault(model.name, []).append(model)
        for name, candidates in self.models_by_name.items():
            self.models[name] = candidates[0]
        self.use_cases: Dict[str, UseCase] = {}
        for use_case in use_cases:
            self.use_cases[use_case.key] = use_case
        self.clients: Dict[str, Client] = {c.name: c for c in clients}
        self.events = events  # class or signal name -> EventDef
        self._warned_store = False
        self._warned_peers = set()
        self._celery: Optional[Tuple[celery_conf.Config, Dict[Tuple[str, str], celery_tasks.Task]]] = None
        self.produced: Dict[str, List[Tuple[str, str]]] = {}  # event id -> (address, line) it was put on the wire at
        self._settings: Optional[Module] = None
        self.classes: Dict[Tuple[str, str], ClassTarget] = {}
        self.functions: Dict[Tuple[str, str], CallableTarget] = {}
        for module in project.modules.values():
            for node in module.classes():
                target = ClassTarget(module, node)
                self.classes[(module.dotted, node.name)] = target
            for node in module.functions():
                self.functions[(module.dotted, node.name)] = CallableTarget(module, node)

    # --- lanes ---------------------------------------------------------------

    def service_lane(self, d: Draft) -> str:
        return d.lane(self.opts.svc_id, "service", self.opts.context)

    def store_lane(self, d: Draft, alias: str = "default") -> str:
        store = self.opts.stores.get(alias, self.opts.store if alias == "default" else "")
        if not store:
            if not self._warned_store:
                self.b.warn(self.opts.svc_id, "no readable database configuration or `store` option, so calls into the ORM stay on the service's own lane")
                self._warned_store = True
            return self.opts.svc_id
        label = "" if alias == "default" else alias
        return d.lane("%s-%s" % (self.opts.service, store), "store", self.opts.context, label)

    def peer_lane(self, d: Draft, pkg: str) -> Tuple[str, str, str]:
        service = self.opts.peers.get(pkg, "")
        if service:
            context = service.split(".")[0]
            return d.lane(service, "service", context), service, catalog.DECLARED
        if pkg not in self._warned_peers:
            self._warned_peers.add(pkg)
            self.b.warn(
                self.opts.svc_id,
                "calls %s and the manifest names no peer for it; add it under `peers` to say which service answers, until then the calls are unresolved" % pkg,
            )
        return d.lane(pkg.replace(".", "-"), "unknown", None, pkg), pkg, catalog.UNRESOLVED

    def consumes(self) -> List[Dict[str, object]]:
        return [self.calls[key] for key in sorted(self.calls)]

    # --- the two openings ----------------------------------------------------

    def endpoint_flow(self, endpoint, serializer=None, model: Optional[ModelDef] = None) -> Optional[Dict[str, object]]:
        d = Draft()
        d.lane(LANE_CLIENT, "actor", None)
        self.service_lane(d)
        d.add(LANE_CLIENT, self.opts.svc_id, "rpc", endpoint.id, line=endpoint.module.where(endpoint.node))
        ran: List[UseCase] = []
        if isinstance(endpoint.node, ast.ClassDef):
            self.inherited_endpoint(d, endpoint, serializer, model)
        else:
            owner = self.class_target(endpoint.module, endpoint.view) if endpoint.view else None
            frame = Frame(endpoint.module, self.attributes(endpoint), owner=owner)
            self.walk(d, frame, endpoint.node.body, 0, ran)
        endpoint.use_cases = [u.key for u in ran]
        name = slug(endpoint.id)
        ident = "%s-%s" % (self.opts.service, name)
        return catalog.flow(
            "flow." + ident,
            ident,
            sentence(name),
            ran[-1].doc if ran else endpoint.doc,
            endpoint.module.rel,
            self.opts.context,
            d.lanes,
            d.steps,
        )

    def inherited_endpoint(self, d: Draft, endpoint, serializer, model: Optional[ModelDef]) -> None:
        """Materialise the behaviour DRF supplies for inherited CRUD actions.

        The action itself is known from the concrete generic base. Persistence
        is drawn only when ``queryset`` or serializer metadata proves a model;
        the extractor never invents a table from the URL or view name.
        """
        action = endpoint.action
        serializer_name = getattr(serializer, "name", "")
        framework = next(
            (
                dotted(base).split(".")[-1]
                for base in endpoint.node.bases
                if dotted(base).split(".")[-1].endswith(("APIView", "ViewSet"))
            ),
            "generic view",
        )
        source = endpoint.module.where(endpoint.node)
        model_note = "Model resolved from queryset or serializer metadata." if model is not None else "No model is declared by queryset or serializer metadata."
        note = "Supplied by DRF %s. %s" % (framework, model_note)

        if action in ("retrieve", "update", "partial_update", "destroy") and model is not None:
            d.add(self.opts.svc_id, self.store_lane(d), "call", "%s.objects.get" % model.name, note=note, line=source)
        elif action == "list" and model is not None:
            d.add(self.opts.svc_id, self.store_lane(d), "call", "%s.objects.all" % model.name, note=note, line=source)

        if action in ("create", "update", "partial_update") and serializer_name:
            suffix = " (partial)" if action == "partial_update" else ""
            d.add(self.opts.svc_id, self.opts.svc_id, "call", "Validate %s%s" % (serializer_name, suffix), note=note, line=source)

        if model is not None:
            if action == "create":
                d.add(self.opts.svc_id, self.store_lane(d), "call", "%s.objects.create" % model.name, note=note, line=source)
            elif action in ("update", "partial_update"):
                d.add(self.opts.svc_id, self.store_lane(d), "call", "%s.save" % model.name, note=note, line=source)
            elif action == "destroy":
                d.add(self.opts.svc_id, self.store_lane(d), "call", "%s.delete" % model.name, note=note, line=source)

        if action in ("list", "retrieve") and serializer_name:
            suffix = " collection" if action == "list" else ""
            d.add(self.opts.svc_id, self.opts.svc_id, "call", "Serialize %s%s" % (serializer_name, suffix), note=note, line=source)

    def policy_flow(self, agg: Aggregate, module: Module, node: ast.AST, decorator: ast.Call) -> Optional[Dict[str, object]]:
        signal = dotted(decorator.args[0]).split(".")[-1] if decorator.args else ""
        if signal in ORM_SIGNALS:
            # Not a policy on an event: a hook on the row. It says nothing
            # about what happened, and it fires for every save - migrations,
            # fixtures and the admin included - so it is reported rather than
            # drawn as a flow nothing in the domain triggers.
            self.b.warn(
                module.where(node),
                "%s runs on %s of %s: a policy hanging on a persistence hook rather than a domain event - nothing says what happened, and it fires for any save, migrations and fixtures included"
                % (node.name, signal, sender_of(decorator)),
            )
            return None
        trigger = self.trigger(module, decorator)
        if trigger is None:
            self.b.warn(
                self.opts.svc_id,
                "%s: %s receives a signal this repository does not declare and the manifest's `events` does not place; the flow is left out" % (module.rel, node.name),
            )
            return None
        ref, label, status = trigger
        d = Draft()
        d.lane(LANE_BUS, "broker", None)
        self.service_lane(d)
        d.add(LANE_BUS, self.opts.svc_id, "event", label, status, ref if status == catalog.DECLARED else "", line=module.where(node))
        if status == catalog.DECLARED:
            self.referenced.add(ref)
        self.walk(d, Frame(module, self.module_env(module)), node.body, 0, [])
        ident = "%s-%s" % (self.opts.service, slug(node.name))
        return catalog.flow(
            "flow." + ident,
            ident,
            sentence(slug(node.name)),
            doc(node),
            module.rel,
            self.opts.context,
            d.lanes,
            d.steps,
        )

    def trigger(self, module: Module, decorator: ast.Call) -> Optional[Tuple[str, str, str]]:
        """What a receiver reacts to: the signal it is given, resolved to an
        event of this service, or placed by the manifest's `events`."""
        if not decorator.args:
            return None
        name = dotted(decorator.args[0]).split(".")[-1]
        local = self.events.get(name)
        if local is not None:
            return local.id, local.name, catalog.DECLARED
        imported = module.imports.get(name)
        if imported is not None:
            for prefix, aggregate in sorted(self.opts.events.items()):
                if imported.module == prefix or imported.module.startswith(prefix + "."):
                    return "%s.%s" % (aggregate, pascal(name)), pascal(name), catalog.DECLARED
        return None

    def attributes(self, endpoint) -> Dict[str, Tuple[str, object]]:
        """`self.pricing = PricingClient()` in the view, and the same at module
        level: what a handler can reach without being handed it."""
        out: Dict[str, Tuple[str, object]] = self.module_env(endpoint.module)
        for node in endpoint.module.classes():
            if node.name != endpoint.view:
                continue
            for name, value, _ in assigned(node):
                binding = self.constructed(endpoint.module, value)
                if binding is not None:
                    out["self." + name] = binding
            init = None
            for m in methods(node):
                if m.name == "__init__":
                    init = m
            if init is not None:
                for stmt in ast.walk(init):
                    if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Attribute):
                        binding = self.constructed(endpoint.module, stmt.value)
                        if binding is not None:
                            out["self." + stmt.targets[0].attr] = binding
        return out

    def constructed(self, module: Module, value: ast.AST) -> Optional[Tuple[str, object]]:
        if not isinstance(value, ast.Call):
            return None
        name = dotted(value.func).split(".")[-1]
        if name in self.clients:
            return ("client", self.clients[name])
        external = self.external_name(module, dotted(value.func))
        if external in ("requests.Session", "httpx.Client", "httpx.AsyncClient", "aiohttp.ClientSession"):
            return ("http", external.split(".", 1)[0])
        target = self.resolve_class(module, dotted(value.func))
        if target is not None:
            return ("object", target)
        return None

    # --- the walk ------------------------------------------------------------

    def walk(self, d: Draft, frame: Frame, body: List[ast.AST], depth: int, ran: List[UseCase]) -> None:
        for stmt in body:
            self.statement(d, frame, stmt, depth, ran)

    def statement(self, d: Draft, frame: Frame, stmt: ast.AST, depth: int, ran: List[UseCase]) -> None:
        if isinstance(stmt, ast.Assign):
            binding = self.value(d, frame, stmt.value, depth, ran)
            for target in stmt.targets:
                self.bind(frame, target, binding)
        elif isinstance(stmt, ast.AnnAssign) and stmt.value is not None:
            self.bind(frame, stmt.target, self.value(d, frame, stmt.value, depth, ran))
        elif isinstance(stmt, ast.Expr):
            self.value(d, frame, stmt.value, depth, ran)
        elif isinstance(stmt, ast.Return):
            if stmt.value is not None:
                frame.returned = self.value(d, frame, stmt.value, depth, ran)
        elif isinstance(stmt, ast.If):
            self.choice(d, frame, stmt, depth, ran)
        elif isinstance(stmt, (ast.For, ast.AsyncFor)):
            d.enter("for each %s" % condition(stmt.target))
            self.walk(d, frame, stmt.body, depth, ran)
            d.leave()
        elif isinstance(stmt, ast.While):
            d.enter("while %s" % condition(stmt.test))
            self.walk(d, frame, stmt.body, depth, ran)
            d.leave()
        elif isinstance(stmt, (ast.With, ast.AsyncWith)):
            atomic = any(dotted(item.context_expr).split(".")[-1] == "atomic" for item in stmt.items)
            d.enter("in one transaction" if atomic else "")
            self.walk(d, frame, stmt.body, depth, ran)
            d.leave()
        elif isinstance(stmt, ast.Try):
            self.walk(d, frame, stmt.body, depth, ran)
            for handler in stmt.handlers:
                d.enter("on %s" % (condition(handler.type) if handler.type is not None else "failure"))
                self.walk(d, frame, handler.body, depth, ran)
                d.leave()
            self.walk(d, frame, stmt.orelse, depth, ran)
            self.walk(d, frame, stmt.finalbody, depth, ran)
        elif isinstance(stmt, ast.Raise):
            return
        elif isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
            frame.vars[stmt.name] = ("callable", CallableTarget(frame.module, stmt, frame.owner))

    def choice(self, d: Draft, frame: Frame, stmt: ast.If, depth: int, ran: List[UseCase]) -> None:
        branches = []
        current: Optional[ast.AST] = stmt
        while isinstance(current, ast.If):
            d.push()
            self.walk(d, frame, current.body, depth, ran)
            steps = d.pop()
            branches.append(catalog.branch(condition(current.test), steps, terminal(current.body)))
            rest = current.orelse
            if len(rest) == 1 and isinstance(rest[0], ast.If):
                current = rest[0]
                continue
            if rest:
                d.push()
                self.walk(d, frame, rest, depth, ran)
                branches.append(catalog.branch("otherwise", d.pop(), terminal(rest)))
            current = None
        if any(branch["steps"] for branch in branches):
            if len(branches) == 1:
                branches.append(catalog.branch("otherwise", []))
            d.add_alt(branches)

    def bind(self, frame: Frame, target: ast.AST, binding) -> None:
        if binding is None:
            return
        if isinstance(target, ast.Name):
            frame.vars[target.id] = binding
        elif isinstance(target, ast.Attribute) and dotted(target.value) == "self":
            frame.vars["self." + target.attr] = binding
        elif isinstance(target, (ast.Tuple, ast.List)) and isinstance(binding, tuple) and binding[0] == "many":
            for element, one in zip(target.elts, binding[1]):
                self.bind(frame, element, one)

    def lookup(self, frame: Frame, node: ast.AST):
        name = dotted(node)
        if not name:
            return None
        if name in frame.vars:
            return frame.vars[name]
        base = name.split(".")[0]
        found = frame.vars.get(base)
        if found is not None:
            return found
        model = self.model_for(frame.module, name)
        return ("model", model) if model is not None else None

    def value(self, d: Draft, frame: Frame, node: ast.AST, depth: int, ran: List[UseCase]):
        """What an expression holds, and every hop it makes on the way."""
        if isinstance(node, ast.Await):
            return self.value(d, frame, node.value, depth, ran)
        if isinstance(node, (ast.Tuple, ast.List)):
            return ("many", [self.value(d, frame, element, depth, ran) for element in node.elts])
        if isinstance(node, (ast.Name, ast.Attribute)):
            binding = self.lookup(frame, node)
            if binding is not None:
                return binding
            text = self.string_value(frame.module, node)
            return ("string", text) if text else None
        if not isinstance(node, ast.Call):
            text = self.string_value(frame.module, node)
            return ("string", text) if text else None

        # The receiver first, then the arguments: a chain is read the way it is
        # written, so `Invoice.objects.filter(...).first()` makes its query
        # where the queryset is built rather than nowhere at all.
        holder = None
        if isinstance(node.func, ast.Attribute):
            inner = node.func.value
            holder = self.value(d, frame, inner, depth, ran) if isinstance(inner, ast.Call) else self.lookup(frame, inner)
        positional = [self.value(d, frame, arg, depth, ran) for arg in node.args]
        named = {kw.arg: self.value(d, frame, kw.value, depth, ran) for kw in node.keywords if kw.arg}
        args = positional + list(named.values())
        name = dotted(node.func)
        last = name.split(".")[-1]
        line = frame.module.where(node)

        if self.external_name(frame.module, name) == "urllib.parse.urljoin" and len(node.args) >= 2:
            left = binding_string(positional[0]) or self.string_value(frame.module, node.args[0])
            right = binding_string(positional[1]) or self.string_value(frame.module, node.args[1])
            text = left.rstrip("/") + "/" + right.lstrip("/") if left or right else ""
            if text:
                return ("string", text)

        # A use case of this service: its steps are these steps. Looked for
        # first, so a use case handed an event is followed rather than read as
        # a publish of it.
        use_case = self.use_case(frame.module, name)
        if use_case is not None:
            return self.inline(d, use_case, positional, named, depth, ran, line)

        # A publish with an address, or a project's own helper that makes one
        # when handed an event: the event leaves for the bus, and the step
        # says where. Read before the plain event rule so the address is
        # not lost to it.
        event = next((a for a in args if isinstance(a, tuple) and a[0] == "event"), None)
        if holder is None or holder[0] not in ("client", "model", "model-store"):
            address = ""
            if last in PRODUCE_METHODS and node.args:
                address = self.address_of(frame.module, node.args[0])
            if not address and event is not None:
                address = self.helper_address(frame.module, name)
            if address:
                self.produce(d, address, event[1] if event is not None else "", line)
                return None

        # Work handed to Celery is a hop off the request. `on_commit` around
        # it is the one fact about when the message leaves that the code
        # states plainly, so the lambda or partial it holds is read inside a
        # note rather than skipped.
        if last == "on_commit":
            d.enter("after the transaction commits")
            for arg in node.args:
                self.deferred(d, frame, arg, depth, ran)
            d.leave()
            return None
        if last in ENQUEUE and isinstance(node.func, ast.Attribute):
            task = self.task_of(frame.module, node.func.value)
            if task is not None:
                self.enqueue(d, task, keyword_str(node, "queue"), line)
                return None

        # A project helper is evidence stronger than its call shape. Follow it
        # before the generic "an event was handed to something" fallback, so a
        # formatter or validator receiving an event is not invented as a
        # publish operation.
        called = self.callable_target(frame, node.func, holder)
        if called is not None and (holder is None or holder[0] == "object"):
            return self.inline_callable(d, frame, called, positional, named, depth, ran)

        # An event handed to anything is the event leaving for the bus, which
        # is the rule that catches a project's own `publish()` helper as well
        # as a signal's `send`. A list it is being collected into is not one.
        event = next((a for a in args if isinstance(a, tuple) and a[0] == "event"), None)
        if event is not None and last not in ("append", "extend"):
            self.publish(d, event[1], line)
            return None
        if last in SEND_METHODS and "." in name:
            found = self.events.get(name.rsplit(".", 1)[0].split(".")[-1])
            if found is not None:
                self.publish(d, found.id, line)
                return None

        # An event, a model or a client, constructed.
        if last in self.events and isinstance(node.func, (ast.Name, ast.Attribute)):
            return ("event", self.events[last].id)
        model = self.model_for(frame.module, name)
        if model is not None and ".objects." not in name:
            return ("model", model)
        if last in self.clients:
            return ("client", self.clients[last])

        # The ORM: a manager on a model class, or a write on an instance.
        parts = name.split(".")
        manager_model = self.model_for(frame.module, ".".join(parts[:-2])) if len(parts) >= 3 and parts[-2] == "objects" else None
        if manager_model is not None:
            if last in ("using", "db_manager"):
                alias = binding_string(positional[0]) if positional else ""
                return ("model-store", (manager_model, alias or "default"))
            d.add(self.opts.svc_id, self.store_lane(d), "call", "%s.objects.%s" % (parts[-3], last), line=line)
            return ("model", manager_model)
        if holder is not None and holder[0] == "model-store":
            model, alias = holder[1]
            d.add(self.opts.svc_id, self.store_lane(d, alias), "call", "%s.objects.%s" % (model.name, last), line=line)
            return ("model", model)
        if holder is not None and holder[0] == "model":
            model: ModelDef = holder[1]
            if last in STORE_METHODS or (len(parts) >= 2 and parts[-2] == "objects"):
                alias = binding_string(named.get("using")) or "default"
                d.add(self.opts.svc_id, self.store_lane(d, alias), "call", "%s.%s" % (model.name, last), line=line)
                return holder
            emitted = self.emits(model, last)
            if emitted:
                return ("event", emitted)
        if holder is not None and holder[0] == "client":
            return self.rpc(d, holder[1], last, line)

        http = self.http_call(frame.module, node, holder, positional)
        if http is not None:
            method, target = http
            self.http_step(d, method, target, line)
            return None

        called = self.callable_target(frame, node.func, holder)
        if called is not None:
            return self.inline_callable(d, frame, called, positional, named, depth, ran)

        if holder is not None and holder[0] == "model":
            return holder

        return None

    def inline(self, d: Draft, use_case: UseCase, positional, named, depth: int, ran: List[UseCase], line: str):
        """A use case runs here, so its steps are drawn here - two deep at
        most, past which the call itself is the step."""
        if use_case not in ran:
            ran.append(use_case)
        if depth >= 2:
            d.add(self.opts.svc_id, self.opts.svc_id, "call", use_case.id, note="Runs the use case, whose steps are not drawn again here.", line=line)
            return None
        inner = Frame(use_case.module, self.module_env(use_case.module))
        self.bind_arguments(inner, use_case.node, positional, named, False)
        self.walk(d, inner, use_case.node.body, depth + 1, ran)
        return inner.returned

    def inline_callable(self, d: Draft, caller: Frame, target: CallableTarget, positional, named, depth: int, ran: List[UseCase]):
        """Follow a project function or method until its observable effects."""
        if depth >= MAX_CALL_DEPTH or target.key in caller.active:
            return None
        variables = self.module_env(target.module)
        if target.module is caller.module:
            variables.update(caller.vars)
        if target.owner is not None:
            variables.update(self.class_env(target.owner))
            variables.update({name: value for name, value in caller.vars.items() if name.startswith("self.")})
        inner = Frame(target.module, variables, owner=target.owner, active=caller.active + (target.key,))
        self.bind_arguments(inner, target.node, positional, named, target.owner is not None)
        self.walk(d, inner, getattr(target.node, "body", []), depth + 1, ran)
        return inner.returned

    def bind_arguments(self, frame: Frame, node: ast.AST, positional, named, method: bool) -> None:
        args = getattr(node, "args", None)
        if args is None:
            return
        parameters = list(getattr(args, "posonlyargs", [])) + list(getattr(args, "args", []))
        if method and parameters and parameters[0].arg in ("self", "cls"):
            parameters = parameters[1:]
        for parameter, binding in zip(parameters, positional):
            if binding is not None:
                frame.vars[parameter.arg] = binding
        for parameter in parameters:
            binding = named.get(parameter.arg)
            if binding is not None:
                frame.vars[parameter.arg] = binding

    def deferred(self, d: Draft, frame: Frame, node: ast.AST, depth: int, ran: List[UseCase]) -> None:
        """What `on_commit` was handed: a lambda, whose body is read where the
        lambda is; `partial(task.delay, ...)`, which is the enqueue it binds;
        or anything else, read as a value."""
        if isinstance(node, ast.Lambda):
            self.value(d, frame, node.body, depth, ran)
            return
        if isinstance(node, ast.Call) and dotted(node.func).split(".")[-1] == "partial" and node.args:
            bound = node.args[0]
            if isinstance(bound, ast.Attribute) and bound.attr in ENQUEUE:
                task = self.task_of(frame.module, bound.value)
                if task is not None:
                    self.enqueue(d, task, "", frame.module.where(node))
                    return
        self.value(d, frame, node, depth, ran)

    def celery(self) -> Tuple[celery_conf.Config, Dict[Tuple[str, str], celery_tasks.Task]]:
        """The tasks of the tree and the configuration that places them, read
        once, the first time an enqueue is met."""
        if self._celery is None:
            by_key, _ = celery_tasks.index(celery_tasks.read_tasks(self.project))
            self._celery = (celery_conf.read_config(self.project, self.opts.settings), by_key)
        return self._celery

    def task_of(self, module: Module, receiver: ast.AST) -> Optional[celery_tasks.Task]:
        """The task `.delay` was called on, when the name resolves by import to
        a function decorated as one; None for anything else."""
        if isinstance(receiver, ast.Call) and isinstance(receiver.func, ast.Attribute) and receiver.func.attr in SIGNATURE:
            receiver = receiver.func.value
        name = dotted(receiver)
        if not name:
            return None
        parts = name.split(".")
        if len(parts) == 1:
            hit = self.project.resolve(module, name)
            if hit is None:
                return None
            target, local = hit
            key = (celery_tasks.package_of(target), local)
        else:
            imported = module.imports.get(parts[0])
            if imported is None:
                return None
            package = imported.module if imported.name == "*" else imported.module + "." + imported.name
            key = (".".join([package] + parts[1:-1]), parts[-1])
        _, by_key = self.celery()
        return by_key.get(key)

    def enqueue(self, d: Draft, task: celery_tasks.Task, at_call: str, line: str) -> None:
        """One lane per queue, named as `extract-celery` names it, so the two
        flows meet on the same participant."""
        cfg, _ = self.celery()
        address, _ = celery_conf.queue_for(task.name, at_call, task.queue, cfg)
        lane = d.lane("celery-" + slug(address), "broker", None, "Celery · " + address)
        d.add(
            self.opts.svc_id,
            lane,
            "call",
            "enqueue " + task.short,
            line=line,
            handoff={
                "kind": "job",
                "transport": "celery",
                "channel": address,
                "message": task.name,
                "direction": "send",
            },
        )

    def address_of(self, module: Module, node: ast.AST) -> str:
        """The topic a producer was handed, as far as syntax carries it: the
        literal, a module-level constant, or `settings.X` read out of the
        settings module. A name in the settings module follows once more."""
        text = celery_conf.str_value(node, module)
        if text:
            return text
        name = dotted(node)
        if name.startswith("settings.") and name.count(".") == 1:
            if self._settings is None:
                found = self.project.module(self.opts.settings or celery_conf.settings_module_name(self.project))
                self._settings = found if found is not None else False  # type: ignore[assignment]
            if self._settings:
                return celery_conf.str_value(ast.Name(id=name.split(".")[1]), self._settings)
        return ""

    def helper_address(self, module: Module, name: str) -> str:
        """`bus.publish(event)`: a function of this project, one hop away,
        whose body puts what it was handed on an address. Followed one call
        further - a sync wrapper around an async publish - and no more."""
        parts = name.split(".")
        target: Optional[Module] = None
        local = parts[-1]
        if len(parts) == 1:
            hit = self.project.resolve(module, name)
            if hit is not None:
                target, local = hit
        else:
            imported = module.imports.get(parts[0])
            if imported is not None:
                package = imported.module if imported.name == "*" else imported.module + "." + imported.name
                target = self.project.module(".".join([package] + parts[1:-1]))
        if target is None or target.dotted.split(".")[-1] == "services":
            return ""
        return self.produced_in(target, local, 0)

    def produced_in(self, module: Module, function: str, depth: int) -> str:
        fn = next((f for f in module.functions() if f.name == function), None)
        if fn is None or depth > 1:
            return ""
        for node in ast.walk(fn):
            if isinstance(node, ast.Call) and dotted(node.func).split(".")[-1] in PRODUCE_METHODS and node.args:
                address = self.address_of(module, node.args[0])
                if address:
                    return address
        for node in ast.walk(fn):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                address = self.produced_in(module, node.func.id, depth + 1)
                if address:
                    return address
        return ""

    def produce(self, d: Draft, address: str, event_id: str, line: str) -> None:
        lane = d.lane(LANE_BUS, "broker", None)
        if event_id:
            d.add(self.opts.svc_id, lane, "event", event_id.rsplit(".", 1)[-1], ref=event_id, note="on " + address, line=line)
            self.referenced.add(event_id)
            self.produced.setdefault(event_id, []).append((address, line))
        else:
            d.add(self.opts.svc_id, lane, "call", "publish on " + address, line=line)

    def publish(self, d: Draft, event_id: str, line: str) -> None:
        d.add(self.opts.svc_id, d.lane(LANE_BUS, "broker", None), "event", event_id.rsplit(".", 1)[-1], ref=event_id, line=line)
        self.referenced.add(event_id)

    def emits(self, model: ModelDef, method: str) -> str:
        """A method of the root hands back the event of the move it made."""
        for node in methods(model.node):
            if node.name != method:
                continue
            annotation = getattr(node, "returns", None)
            if annotation is None:
                return ""
            for child in ast.walk(annotation):
                if isinstance(child, ast.Name) and child.id in self.events:
                    return self.events[child.id].id
                if isinstance(child, ast.Constant) and isinstance(child.value, str) and child.value in self.events:
                    return self.events[child.value].id
        return ""

    def rpc(self, d: Draft, client: Client, method: str, line: str):
        call = client.calls.get(method)
        if call is None:
            return None
        lane, peer, status = self.peer_lane(d, call.pkg)
        d.add(self.opts.svc_id, lane, "rpc", call.label, status, call.id if status == catalog.DECLARED else "", line=line)
        if status == catalog.DECLARED:
            self.calls[call.id] = catalog.rpc_call(call.id, peer, catalog.DECLARED, call.source)
        else:
            self.calls[call.id] = catalog.rpc_call(call.id, peer, catalog.UNRESOLVED, call.source)
        return None

    # --- project calls and standard HTTP clients ----------------------------

    def class_target(self, module: Module, name: str) -> Optional[ClassTarget]:
        return self.classes.get((module.dotted, name))

    def resolve_class(self, module: Module, name: str) -> Optional[ClassTarget]:
        if not name:
            return None
        if "." not in name:
            hit = self.project.resolve(module, name)
            if hit is not None:
                return self.classes.get((hit[0].dotted, hit[1]))
            return self.classes.get((module.dotted, name))
        parts = name.split(".")
        imported = module.imports.get(parts[0])
        if imported is None:
            return None
        if imported.name == "*":
            target_module = self.project.module(".".join([imported.module] + parts[1:-1]))
            return self.classes.get((target_module.dotted, parts[-1])) if target_module is not None else None
        direct = self.classes.get((imported.module, imported.name))
        if direct is not None and len(parts) == 1:
            return direct
        module_name = imported.module + "." + imported.name
        target_module = self.project.module(".".join([module_name] + parts[1:-1]))
        return self.classes.get((target_module.dotted, parts[-1])) if target_module is not None else None

    def callable_target(self, frame: Frame, func: ast.AST, holder) -> Optional[CallableTarget]:
        name = dotted(func)
        if not name:
            return None
        local = frame.vars.get(name)
        if local is not None and local[0] == "callable":
            return local[1]
        if isinstance(func, ast.Attribute):
            if isinstance(func.value, ast.Call) and dotted(func.value.func) == "super":
                return self.super_method(frame.owner, func.attr)
            receiver = dotted(func.value)
            if receiver in ("self", "cls") and frame.owner is not None:
                return self.method_target(frame.owner, func.attr)
            if holder is not None and holder[0] == "object":
                return self.method_target(holder[1], func.attr)
            owner = self.resolve_class(frame.module, receiver)
            if owner is not None:
                return self.method_target(owner, func.attr)
        return self.resolve_function(frame.module, name)

    def resolve_function(self, module: Module, name: str) -> Optional[CallableTarget]:
        parts = name.split(".")
        if len(parts) == 1:
            hit = self.project.resolve(module, name)
            if hit is None:
                return None
            return self.functions.get((hit[0].dotted, hit[1]))
        imported = module.imports.get(parts[0])
        if imported is None:
            return None
        if imported.name == "*":
            target = self.project.module(".".join([imported.module] + parts[1:-1]))
        else:
            module_name = imported.module + "." + imported.name
            target = self.project.module(".".join([module_name] + parts[1:-1]))
            if target is None and len(parts) == 2:
                target = self.project.module(imported.module)
        return self.functions.get((target.dotted, parts[-1])) if target is not None else None

    def method_target(self, owner: ClassTarget, name: str) -> Optional[CallableTarget]:
        node = next((item for item in methods(owner.node) if item.name == name), None)
        if node is not None:
            return CallableTarget(owner.module, node, owner)
        for base in owner.node.bases:
            parent = self.resolve_class(owner.module, dotted(base))
            if parent is not None:
                found = self.method_target(parent, name)
                if found is not None:
                    return found
        return None

    def super_method(self, owner: Optional[ClassTarget], name: str) -> Optional[CallableTarget]:
        if owner is None:
            return None
        for base in owner.node.bases:
            parent = self.resolve_class(owner.module, dotted(base))
            if parent is not None:
                found = self.method_target(parent, name)
                if found is not None:
                    return found
        return None

    def class_env(self, target: ClassTarget) -> Dict[str, Tuple[str, object]]:
        out: Dict[str, Tuple[str, object]] = {}
        for name, value, _ in assigned(target.node):
            binding = self.constructed(target.module, value)
            if binding is not None:
                out["self." + name] = binding
        init = next((node for node in methods(target.node) if node.name == "__init__"), None)
        if init is not None:
            for stmt in ast.walk(init):
                if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Attribute):
                    binding = self.constructed(target.module, stmt.value)
                    if binding is not None:
                        out["self." + stmt.targets[0].attr] = binding
        return out

    def model_for(self, module: Module, name: str) -> Optional[ModelDef]:
        short = name.split(".")[-1]
        candidates = self.models_by_name.get(short, [])
        if not candidates:
            return None
        hit = self.project.resolve(module, short) if "." not in name else None
        if hit is not None:
            exact = [model for model in candidates if model.module.dotted == hit[0].dotted and model.name == hit[1]]
            if len(exact) == 1:
                return exact[0]
        same_package = [model for model in candidates if module.dotted == model.app.dotted or module.dotted.startswith(model.app.dotted + ".")]
        if len(same_package) == 1:
            return same_package[0]
        return candidates[0] if len(candidates) == 1 else None

    def external_name(self, module: Module, name: str) -> str:
        if not name:
            return ""
        parts = name.split(".")
        imported = module.imports.get(parts[0])
        if imported is None:
            return name
        base = imported.module if imported.name == "*" else imported.module + "." + imported.name
        return ".".join([base] + parts[1:])

    def http_call(self, module: Module, node: ast.Call, holder, positional) -> Optional[Tuple[str, str]]:
        name = dotted(node.func)
        last = name.split(".")[-1].lower()
        if holder is not None and holder[0] == "http" and last in HTTP_METHODS:
            url = binding_string(positional[0]) if positional else ""
            url = url or (self.string_value(module, node.args[0]) if node.args else "")
            return last.upper(), url or expression(node.args[0] if node.args else None)
        external = self.external_name(module, name)
        library = external.split(".", 1)[0]
        if library not in HTTP_LIBRARIES:
            return None
        if last == "request" and len(node.args) >= 2:
            method = binding_string(positional[0]).upper() if positional else ""
            target = binding_string(positional[1]) if len(positional) > 1 else ""
            return method or "HTTP", target or self.string_value(module, node.args[1]) or expression(node.args[1])
        if last not in HTTP_METHODS:
            return None
        url = binding_string(positional[0]) if positional else ""
        url = url or (self.string_value(module, node.args[0]) if node.args else "")
        return last.upper(), url or expression(node.args[0] if node.args else None)

    def string_value(self, module: Module, node: Optional[ast.AST], depth: int = 0) -> str:
        if node is None or depth > 5:
            return ""
        text = celery_conf.str_value(node, module)
        if text:
            return text
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            left = self.string_value(module, node.left, depth + 1)
            right = self.string_value(module, node.right, depth + 1)
            return left + right if left or right else ""
        if isinstance(node, ast.JoinedStr):
            chunks = []
            for item in node.values:
                if isinstance(item, ast.Constant) and isinstance(item.value, str):
                    chunks.append(item.value)
                elif isinstance(item, ast.FormattedValue):
                    chunks.append("{%s}" % expression(item.value))
            return "".join(chunks)
        if isinstance(node, ast.Call) and self.external_name(module, dotted(node.func)) == "urllib.parse.urljoin" and len(node.args) >= 2:
            left = self.string_value(module, node.args[0], depth + 1)
            right = self.string_value(module, node.args[1], depth + 1)
            return left.rstrip("/") + "/" + right.lstrip("/") if left or right else ""
        name = dotted(node)
        if not name:
            return ""
        if name.startswith("settings."):
            return self.address_of(module, node)
        if "." not in name:
            hit = self.project.resolve(module, name)
            if hit is not None and hit[0] is not module:
                return self.string_value(hit[0], ast.Name(id=hit[1]), depth + 1)
        return ""

    def http_step(self, d: Draft, method: str, target: str, line: str) -> None:
        parsed = urlparse(target)
        peer = parsed.netloc or parsed.path.split("/", 1)[0] or "external-http"
        path = parsed.path if parsed.netloc else target
        label = "%s %s" % (method, path or "/")
        lane = d.lane("http-" + slug(peer), "unknown", None, peer)
        d.add(self.opts.svc_id, lane, "rpc", label, catalog.UNRESOLVED, line=line)

    def use_case(self, module: Module, name: str) -> Optional[UseCase]:
        """`issue_invoice(...)` imported from the services module,
        `services.issue_invoice(...)` through the module itself, or a function
        of the module being read."""
        parts = name.split(".")
        keys = []
        imported = module.imports.get(parts[0])
        if imported is not None:
            if imported.name != "*":
                keys.append(imported.module + "." + imported.name)  # from .services import x
                keys.append(imported.module + "." + imported.name + "." + parts[-1])  # from . import services
            keys.append(imported.module + "." + parts[-1])  # import package.services
        keys.append(module.dotted + "." + parts[-1])
        for key in keys:
            hit = self.use_cases.get(key)
            if hit is not None:
                return hit
        return None

    def module_env(self, module: Module) -> Dict[str, Tuple[str, object]]:
        """What a module-level name holds before a body starts: the clients a
        module keeps as singletons, which is how a Django project holds one."""
        out: Dict[str, Tuple[str, object]] = {}
        for name, value, _ in assigned(module.tree):
            binding = self.constructed(module, value)
            if binding is not None:
                out[name] = binding
        return out


def terminal(body: List[ast.AST]) -> bool:
    return bool(body) and isinstance(body[-1], (ast.Return, ast.Raise))


def expression(node: Optional[ast.AST]) -> str:
    if node is None:
        return ""
    try:
        return " ".join(ast.unparse(node).split())  # type: ignore[attr-defined]
    except Exception:
        return dotted(node)


def binding_string(binding) -> str:
    return binding[1] if isinstance(binding, tuple) and len(binding) > 1 and binding[0] == "string" else ""
