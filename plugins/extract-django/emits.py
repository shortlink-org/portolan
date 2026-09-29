"""What a use case can publish, read off the domain calls it makes.

    class Invoice(models.Model):
        def issue(self, number, now) -> "InvoiceIssued": ...

    def issue_invoice(order_id, lines, number, now):
        event = invoice.issue(number, now)
        invoice_issued.send(sender=Invoice, event=event)

The models module says which of its functions produce which events: a model
method or a module-level function produces the event its return annotation
names - the same reading the lifecycle gives a mover's `emits` - the events it
constructs, the signals it sends, and whatever the functions it calls produce.
The use case says which of those it calls, and adds what it constructs or sends
itself. The event is the domain's to name and the use case only decides whether
to run the method that names it, so the operation emits what it reaches,
whether or not a branch keeps the result.

Calls are matched by name, as extract-go matches them: a model method by its
name on any receiver, a module-level function of the models module through the
import that names it. A `save()` on something that is not a model is read as
the model's when the model's `save()` sends a signal; the collision is rare
enough to take, and a `save()` that sends is exactly the one worth seeing.
"""

from __future__ import annotations

import ast
from typing import Dict, Iterable, List, Optional, Set

from flows import SEND_METHODS
from lifecycle import annotated_events
from source import Import, dotted, methods


class Emitters:
    """The emitting functions of one aggregate's models."""

    def __init__(
        self,
        classes: Iterable[ast.ClassDef],
        functions: Iterable[ast.AST],
        events: Dict[str, object],
        order: List[str],
        domain: Iterable[str] = (),
    ):
        # Only the aggregate's own events: an operation changes its own
        # aggregate, and what another publishes is that one's to say.
        self.order = {ident: i for i, ident in enumerate(order)}
        self.events = {name: e for name, e in events.items() if getattr(e, "id", "") in self.order}
        self.domain = set(domain)  # the models modules, dotted: "billing.invoices.models"
        self.methods: Dict[str, Set[str]] = {}  # method name -> event ids
        self.funcs: Dict[str, Set[str]] = {}  # module-level function name -> event ids
        if not self.events:
            return

        # Each function's own events and the domain functions it calls, then
        # the calls folded in until nothing changes: a method that records
        # through a private helper emits what the helper builds.
        own: Dict[str, Set[str]] = {}
        calls: Dict[str, List[str]] = {}
        for cls in classes:
            for node in methods(cls):
                key = "m:%s.%s" % (cls.name, node.name)
                own[key] = self.produced(node)
                calls[key] = []
                for call in ast.walk(node):
                    if not isinstance(call, ast.Call):
                        continue
                    func = call.func
                    if isinstance(func, ast.Name):
                        calls[key].append("f:" + func.id)
                    elif isinstance(func, ast.Attribute) and dotted(func.value) in ("self", "cls", cls.name):
                        calls[key].append("m:%s.%s" % (cls.name, func.attr))
        for node in functions:
            key = "f:" + node.name
            own[key] = self.produced(node)
            calls[key] = [
                "f:" + call.func.id for call in ast.walk(node) if isinstance(call, ast.Call) and isinstance(call.func, ast.Name)
            ]
        fold(own, calls)
        for key, ids in own.items():
            name = key.rsplit(".", 1)[-1] if key.startswith("m:") else key[2:]
            # A private name is how the models say it to themselves; the use
            # case reaches it through the public one that calls it.
            if not ids or name.startswith("_"):
                continue
            target = self.methods if key.startswith("m:") else self.funcs
            target.setdefault(name, set()).update(ids)

    def produced(self, node: ast.AST) -> Set[str]:
        """What one function publishes by itself: the event its annotation
        names, and the events it constructs or sends."""
        out = set(annotated_events(node, self.events))
        for call in ast.walk(node):
            if isinstance(call, ast.Call):
                ident = self.event_of(call)
                if ident:
                    out.add(ident)
        return out

    def event_of(self, call: ast.Call) -> str:
        """`InvoiceIssued(...)` constructed, or `invoice_issued.send(...)`:
        the same two shapes the flows read as an event leaving."""
        name = dotted(call.func)
        last = name.split(".")[-1]
        if last in SEND_METHODS and "." in name:
            found = self.events.get(name.rsplit(".", 1)[0].split(".")[-1])
            if found is not None:
                return found.id
        found = self.events.get(last)
        if found is not None and isinstance(call.func, (ast.Name, ast.Attribute)):
            return found.id
        return ""

    def of(self, node: ast.AST, siblings: Iterable[ast.AST] = (), imports: Optional[Dict[str, Import]] = None) -> List[str]:
        """What one use case reaches: the model methods it calls by name, the
        models' functions through the import that names them, and what it
        constructs or sends itself. `siblings` are the other functions of the
        services module; one the use case calls is part of it, the way a
        helper in a Go use case package is. Empty when it reaches nothing."""
        if not self.events:
            return []
        imports = imports or {}
        local = {n.name: n for n in siblings}
        found: Set[str] = set()
        seen: Set[str] = set()
        pending = [node]
        while pending:
            fn = pending.pop()
            if getattr(fn, "name", "") in seen:
                continue
            seen.add(getattr(fn, "name", ""))
            found |= self.produced(fn)
            for call in ast.walk(fn):
                if not isinstance(call, ast.Call):
                    continue
                func = call.func
                if isinstance(func, ast.Name):
                    if func.id in local:
                        pending.append(local[func.id])
                    elif self.from_domain(imports.get(func.id), func.id):
                        found |= self.funcs.get(func.id, set())
                elif isinstance(func, ast.Attribute):
                    holder = imports.get(dotted(func.value)) if isinstance(func.value, ast.Name) else None
                    if holder is not None and self.is_domain_module(holder):
                        found |= self.funcs.get(func.attr, set())
                    else:
                        found |= self.methods.get(func.attr, set())
        return sorted(found, key=lambda ident: self.order[ident])

    def from_domain(self, imported: Optional[Import], name: str) -> bool:
        """`from .models import record_payment`."""
        return imported is not None and imported.name == name and imported.module in self.domain

    def is_domain_module(self, imported: Import) -> bool:
        """`from . import models`, or `import billing.invoices.models as m` -
        and not `from .models import Invoice`, whose methods are methods."""
        if imported.name == "*":
            return imported.module in self.domain
        return imported.module + "." + imported.name in self.domain


def fold(own: Dict[str, Set[str]], calls: Dict[str, List[str]]) -> None:
    changed = True
    while changed:
        changed = False
        for key, callees in calls.items():
            for callee in callees:
                extra = own.get(callee, set()) - own[key]
                if extra:
                    own[key] |= extra
                    changed = True


def for_aggregate(agg, events: Dict[str, object]) -> Emitters:
    """The emitters of one application's models: every model's methods and
    the models package's own functions."""
    modules = agg.app.package("models")
    functions = [fn for module in modules for fn in module.functions()]
    order = [str(event["id"]) for event in agg.aggregate["events"]]
    # A package's `__init__` is imported by the package's own name.
    names = [m.dotted[: -len(".__init__")] if m.dotted.endswith(".__init__") else m.dotted for m in modules]
    return Emitters([m.node for m in agg.models], functions, events, order, names)
