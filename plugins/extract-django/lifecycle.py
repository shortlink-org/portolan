"""The root's states, read off the table the code keeps.

Never off the branches of the methods: the table is the claim and the methods
are held to it. In Django the table is either a `TRANSITIONS` mapping on the
model, beside the `TextChoices` that names the states, or the `@transition`
decorators of django-fsm, which are a table written one edge at a time. An edge
nothing makes, a move into a state the table lacks, and a status assigned
anywhere but a mover are each reported.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass, field as dc_field
from typing import Dict, List, Optional, Tuple

import catalog
from domain import Aggregate, ModelDef
from source import assigned, bases, const_str, dotted, inner_class, keyword, methods


@dataclass
class Move:
    to: str
    on: str
    emits: str
    source: str
    sources: List[str] = dc_field(default_factory=list)  # the states it may be made from, when the decorator says


def choices_of(model: ModelDef, name: str) -> Dict[str, str]:
    """A TextChoices class, as member name to the value stored in the column."""
    node = inner_class(model.node, name)
    if node is None:
        for other in model.module.classes():
            if other.name == name:
                node = other
                break
    if node is None or not any(b.split(".")[-1].endswith("Choices") for b in bases(node)):
        return {}
    out = {}
    for member, value, _ in assigned(node):
        if isinstance(value, ast.Constant) and isinstance(value.value, str):
            out[member] = value.value
        elif isinstance(value, ast.Tuple) and value.elts and isinstance(value.elts[0], ast.Constant):
            out[member] = value.elts[0].value
    return out


def state_of(node: ast.AST, choices: Dict[str, Dict[str, str]]) -> str:
    """`Status.DRAFT` or `"draft"`, either way the value in the column."""
    literal = const_str(node)
    if literal:
        return literal
    name = dotted(node)
    if "." in name:
        holder, member = name.rsplit(".", 1)
        table = choices.get(holder.split(".")[-1], {})
        if member in table:
            return table[member]
    return ""


def status_field(model: ModelDef) -> Optional[str]:
    """The field whose choices are the states. `status` by convention, or the
    one field whose choices name a Choices class."""
    for f in model.fields:
        value = keyword(f.call, "choices")
        if value is not None and dotted(value):
            return f.name
    return "status" if model.field("status") else None


def choice_tables(model: ModelDef) -> Dict[str, Dict[str, str]]:
    out = {}
    for node in list(model.node.body) + list(model.module.tree.body):
        if isinstance(node, ast.ClassDef) and any(b.split(".")[-1].endswith("Choices") for b in bases(node)):
            out[node.name] = choices_of(model, node.name)
    return out


def declared_table(model: ModelDef, choices: Dict[str, Dict[str, str]]) -> Dict[str, List[str]]:
    """`TRANSITIONS = {Status.DRAFT: [Status.ISSUED], ...}`, in the order written."""
    for name, value, _ in assigned(model.node):
        if name != "TRANSITIONS" or not isinstance(value, ast.Dict):
            continue
        table: Dict[str, List[str]] = {}
        for key, targets in zip(value.keys, value.values):
            state = state_of(key, choices)
            if not state:
                continue
            listed = []
            if isinstance(targets, (ast.List, ast.Tuple, ast.Set)):
                for item in targets.elts:
                    to = state_of(item, choices)
                    if to:
                        listed.append(to)
            table[state] = listed
        return table
    return {}


def emits_of(node: ast.AST, events: Dict[str, object]) -> str:
    """The event a mover hands back, as its return annotation names it, by the
    id the catalog knows it under."""
    annotation = getattr(node, "returns", None)
    if annotation is None:
        return ""
    found = ""
    for name in ast.walk(annotation):
        if isinstance(name, ast.Name) and name.id in events:
            found = events[name.id].id
        elif isinstance(name, ast.Constant) and isinstance(name.value, str) and name.value in events:
            found = events[name.value].id
    return found


def movers(model: ModelDef, status: str, choices: Dict[str, Dict[str, str]], events: Dict[str, object]) -> Tuple[List[Move], List[Tuple[str, str]]]:
    """Every method that moves the root: the ones assigning the status field,
    and the ones django-fsm decorates. Also what they assign that no table
    knows, which the caller reports."""
    out: List[Move] = []
    loose: List[Tuple[str, str]] = []
    for node in methods(model.node):
        if node.name.startswith("_"):
            continue
        emits = emits_of(node, events)
        where = model.module.where(node)
        decorator = None
        for dec in getattr(node, "decorator_list", []):
            if dotted(dec).split(".")[-1] == "transition" and isinstance(dec, ast.Call):
                decorator = dec
        if decorator is not None:
            target = state_of(keyword(decorator, "target"), choices)
            source = keyword(decorator, "source")
            froms = []
            if isinstance(source, (ast.List, ast.Tuple, ast.Set)):
                froms = [state_of(item, choices) for item in source.elts]
            elif source is not None:
                one = state_of(source, choices)
                froms = [one] if one else []
            if target:
                out.append(Move(to=target, on=node.name, emits=emits, source=where, sources=[f for f in froms if f]))
            continue
        for assignment in ast.walk(node):
            if not isinstance(assignment, ast.Assign):
                continue
            for target in assignment.targets:
                if not isinstance(target, ast.Attribute) or target.attr != status:
                    continue
                if dotted(target.value) != "self":
                    continue
                to = state_of(assignment.value, choices)
                if to:
                    out.append(Move(to=to, on=node.name, emits=emits, source=model.module.where(assignment)))
                else:
                    loose.append((node.name, model.module.where(assignment)))
    return out, loose


def read(agg: Aggregate, events: Dict[str, object], b) -> Optional[Dict[str, object]]:
    model = agg.root
    status = status_field(model)
    if status is None:
        return None
    choices = choice_tables(model)
    table = declared_table(model, choices)
    moves, loose = movers(model, status, choices, events)

    if not table:
        if not moves:
            return None
        # django-fsm writes the table one edge at a time; a model that only
        # assigns its status has no table at all, and a lifecycle read off the
        # assignments would be the branches talking.
        if not any(m.sources for m in moves):
            b.warn(agg.id, "%s moves its %s but declares no TRANSITIONS: the table is the claim, the methods are held to it" % (model.name, status))
            return None
        table = {}
        for move in moves:
            for source in move.sources:
                table.setdefault(source, [])
                if move.to not in table[source]:
                    table[source].append(move.to)
            table.setdefault(move.to, [])

    states = list(table.keys())
    # The order the Choices class writes them in is the order a reader expects,
    # and the first is where a new root starts.
    declared = next(iter(choices.values()), {})
    if declared:
        ordered = [value for value in declared.values() if value in table or any(value in tos for tos in table.values())]
        for state in states:
            if state not in ordered:
                ordered.append(state)
        states = ordered
    for move in moves:
        if move.to not in states:
            states.append(move.to)
            b.warn(agg.id, "%s moves to %r, which the table does not list" % (move.on, move.to))

    transitions = []
    made = set()
    for move in moves:
        froms = [state for state, tos in table.items() if move.to in tos]
        if move.sources:
            froms = [f for f in move.sources if f in states] or move.sources
        if not froms:
            continue
        for state in froms:
            transitions.append(catalog.transition(state, move.to, move.on, move.emits, move.source))
            made.add((state, move.to))
    for state, tos in table.items():
        for to in tos:
            if (state, to) not in made:
                b.warn(agg.id, "the table has %s -> %s and no method of %s makes it" % (state, to, model.name))
    for name, where in loose:
        b.warn(agg.id, "%s assigns %s to something the states do not name (%s)" % (name, status, where))

    if not transitions:
        return None
    return {"states": states, "transitions": transitions}
