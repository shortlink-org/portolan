"""What the service publishes.

`<app>/events.py` is where a Django application says it, in either of the two
ways Django projects say it: a dataclass carrying the payload and the name it
travels under, or a bare `Signal()`. A signal is read as an event too - leaving
it out would hide a publish - but it declares no payload, and that is a
diagnostic rather than an empty shape nobody questions.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from typing import Dict, List, Tuple

import catalog
from domain import Aggregate, block_fields
from ids import event_id, pascal, slug
from source import Module, assigned, const_str, doc, dotted


@dataclass
class EventDef:
    name: str  # the class, or the signal's variable name in PascalCase
    id: str
    module: Module
    signal: str = ""  # the module-level variable, when it is a signal


def string_attr(node: ast.ClassDef, name: str) -> str:
    for attr, value, _ in assigned(node):
        if attr == name:
            return const_str(value)
    return ""


def read_events(agg: Aggregate, service: str, b) -> Tuple[List[Dict[str, object]], Dict[str, EventDef]]:
    """The events of one aggregate, and how to find one again by the name the
    code calls it: the class for a dataclass, the variable for a signal."""
    out: List[Dict[str, object]] = []
    found: Dict[str, EventDef] = {}
    for module in agg.app.package("events"):
        for node in module.classes():
            name = string_attr(node, "name")
            if not name:
                b.warn(module.rel, "%s is in events but names no wire name: `name = \"%s.%s\"` is what makes it an event" % (node.name, service, node.name))
                continue
            ident = event_id(agg.id, node.name)
            wire = {"name": name}
            channel = string_attr(node, "channel")
            if channel:
                wire["channel"] = channel
            out.append(
                catalog.event(
                    ident,
                    slug(node.name),
                    node.name,
                    [catalog.version(doc(node), module.rel, block_fields(node))],
                    wire,
                )
            )
            found[node.name] = EventDef(name=node.name, id=ident, module=module)
        for name, value, _ in assigned(module.tree):
            if not isinstance(value, ast.Call) or dotted(value.func).split(".")[-1] != "Signal":
                continue
            class_name = pascal(name)
            if class_name in found:
                # The signal is how that event travels; the name the code
                # sends through resolves to the event the dataclass declares.
                found[name] = found[class_name]
                continue
            ident = event_id(agg.id, class_name)
            b.warn(ident, "read off a Signal in %s: a signal declares no payload, so the event has no fields" % module.rel)
            out.append(
                catalog.event(
                    ident,
                    slug(class_name),
                    class_name,
                    [catalog.version("", module.rel, [])],
                    {"name": "%s.%s" % (service, class_name)},
                )
            )
            found[class_name] = EventDef(name=class_name, id=ident, module=module, signal=name)
            found[name] = found[class_name]
    out.sort(key=lambda e: e["id"])
    return out, found
