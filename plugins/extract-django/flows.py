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

import catalog
from clients import Client
from domain import Aggregate, ModelDef
from ids import pascal, slug
from operations import UseCase
from source import Module, Project, assigned, doc, dotted, methods

LANE_CLIENT = "client"
LANE_BUS = "bus"

# A call on the ORM that goes to the database. `objects.<anything>` does too,
# and is caught by the manager rather than by this list.
STORE_METHODS = {"save", "delete", "refresh_from_db", "update", "full_clean_and_save"}
# What a publish looks like. A signal's `send` is one; so is anything handed an
# event, which is the rule that catches a project's own `publish()` helper.
SEND_METHODS = {"send", "send_robust", "publish"}


@dataclass
class Options:
    context: str
    svc_id: str
    service: str
    store: str
    peers: Dict[str, str] = dc_field(default_factory=dict)
    events: Dict[str, str] = dc_field(default_factory=dict)


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

    def add(self, from_: str, to: str, kind: str, label: str, status: str = catalog.DECLARED, ref: str = "", note: str = "", line: str = "") -> None:
        self.n += 1
        self.sink().append(catalog.step("s%d" % self.n, from_, to, kind, label, status, ref, self.note(note), line))

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


class Frame:
    """What a name means inside one body being walked."""

    def __init__(self, module: Module, variables: Optional[Dict[str, Tuple[str, object]]] = None):
        self.module = module
        self.vars: Dict[str, Tuple[str, object]] = dict(variables or {})
        self.returned: Optional[Tuple[str, object]] = None


class FlowReader:
    def __init__(self, opts: Options, project: Project, aggregates: List[Aggregate], use_cases: List[UseCase], clients: List[Client], events: Dict[str, object], rel, b):
        self.opts = opts
        self.project = project
        self.aggregates = aggregates
        self.rel = rel
        self.b = b
        self.calls: Dict[str, Dict[str, object]] = {}
        self.referenced = set()
        self.models: Dict[str, ModelDef] = {}
        self.emitters: Dict[Tuple[str, str], str] = {}  # (model, method) -> event id
        for agg in aggregates:
            for model in agg.models:
                self.models[model.name] = model
        self.use_cases: Dict[str, UseCase] = {}
        for use_case in use_cases:
            self.use_cases[use_case.key] = use_case
        self.clients: Dict[str, Client] = {c.name: c for c in clients}
        self.events = events  # class or signal name -> EventDef
        self._warned_store = False
        self._warned_peers = set()

    # --- lanes ---------------------------------------------------------------

    def service_lane(self, d: Draft) -> str:
        return d.lane(self.opts.svc_id, "service", self.opts.context)

    def store_lane(self, d: Draft) -> str:
        if not self.opts.store:
            if not self._warned_store:
                self.b.warn(self.opts.svc_id, "no store named in the options, so calls into the ORM stay on the service's own lane")
                self._warned_store = True
            return self.opts.svc_id
        return d.lane("%s-%s" % (self.opts.service, self.opts.store), "store", self.opts.context)

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

    def endpoint_flow(self, agg: Aggregate, endpoint) -> Optional[Dict[str, object]]:
        d = Draft()
        d.lane(LANE_CLIENT, "actor", None)
        self.service_lane(d)
        d.add(LANE_CLIENT, self.opts.svc_id, "rpc", endpoint.id, line=endpoint.module.where(endpoint.node))
        frame = Frame(endpoint.module, self.attributes(endpoint))
        ran: List[UseCase] = []
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

    def policy_flow(self, agg: Aggregate, module: Module, node: ast.AST, decorator: ast.Call) -> Optional[Dict[str, object]]:
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
                binding = self.constructed(value)
                if binding is not None:
                    out["self." + name] = binding
            init = None
            for m in methods(node):
                if m.name == "__init__":
                    init = m
            if init is not None:
                for stmt in ast.walk(init):
                    if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Attribute):
                        binding = self.constructed(stmt.value)
                        if binding is not None:
                            out["self." + stmt.targets[0].attr] = binding
        return out

    def constructed(self, value: ast.AST) -> Optional[Tuple[str, object]]:
        if not isinstance(value, ast.Call):
            return None
        name = dotted(value.func).split(".")[-1]
        if name in self.clients:
            return ("client", self.clients[name])
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
        return frame.vars.get(base)

    def value(self, d: Draft, frame: Frame, node: ast.AST, depth: int, ran: List[UseCase]):
        """What an expression holds, and every hop it makes on the way."""
        if isinstance(node, ast.Await):
            return self.value(d, frame, node.value, depth, ran)
        if isinstance(node, (ast.Tuple, ast.List)):
            return ("many", [self.value(d, frame, element, depth, ran) for element in node.elts])
        if isinstance(node, (ast.Name, ast.Attribute)):
            return self.lookup(frame, node)
        if not isinstance(node, ast.Call):
            return None

        # The receiver first, then the arguments: a chain is read the way it is
        # written, so `Invoice.objects.filter(...).first()` makes its query
        # where the queryset is built rather than nowhere at all.
        holder = None
        if isinstance(node.func, ast.Attribute):
            inner = node.func.value
            holder = self.value(d, frame, inner, depth, ran) if isinstance(inner, ast.Call) else self.lookup(frame, inner)
        args = [self.value(d, frame, arg, depth, ran) for arg in node.args]
        args += [self.value(d, frame, kw.value, depth, ran) for kw in node.keywords]
        name = dotted(node.func)
        last = name.split(".")[-1]
        line = frame.module.where(node)

        # A use case of this service: its steps are these steps. Looked for
        # first, so a use case handed an event is followed rather than read as
        # a publish of it.
        use_case = self.use_case(frame.module, name)
        if use_case is not None:
            return self.inline(d, use_case, args, depth, ran, line)

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
        if last in self.models and ".objects." not in name:
            return ("model", self.models[last])
        if last in self.clients:
            return ("client", self.clients[last])

        # The ORM: a manager on a model class, or a write on an instance.
        parts = name.split(".")
        if len(parts) >= 3 and parts[-2] == "objects" and parts[-3] in self.models:
            d.add(self.opts.svc_id, self.store_lane(d), "call", "%s.objects.%s" % (parts[-3], last), line=line)
            return ("model", self.models[parts[-3]])
        if holder is not None and holder[0] == "model":
            model: ModelDef = holder[1]
            if last in STORE_METHODS or (len(parts) >= 2 and parts[-2] == "objects"):
                d.add(self.opts.svc_id, self.store_lane(d), "call", "%s.%s" % (model.name, last), line=line)
                return holder
            emitted = self.emits(model, last)
            if emitted:
                return ("event", emitted)
            return holder
        if holder is not None and holder[0] == "client":
            return self.rpc(d, holder[1], last, line)

        return None

    def inline(self, d: Draft, use_case: UseCase, args, depth: int, ran: List[UseCase], line: str):
        """A use case runs here, so its steps are drawn here - two deep at
        most, past which the call itself is the step."""
        if use_case not in ran:
            ran.append(use_case)
        if depth >= 2:
            d.add(self.opts.svc_id, self.opts.svc_id, "call", use_case.id, note="Runs the use case, whose steps are not drawn again here.", line=line)
            return None
        inner = Frame(use_case.module, self.module_env(use_case.module))
        for parameter, binding in zip(getattr(use_case.node.args, "args", []), args):
            if binding is not None:
                inner.vars[parameter.arg] = binding
        self.walk(d, inner, use_case.node.body, depth + 1, ran)
        return inner.returned

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
            binding = self.constructed(value)
            if binding is not None:
                out[name] = binding
        return out


def terminal(body: List[ast.AST]) -> bool:
    return bool(body) and isinstance(body[-1], (ast.Return, ast.Raise))
