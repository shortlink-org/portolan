"""The `Choices` classes a model keeps, read as the values the column holds.

`class Status(models.TextChoices): DRAFT = "draft", "Draft"` says two things:
the states a lifecycle moves between, and the values a `status` field may
take. Both readers want the same table, member name to stored value, and
neither wants the label.
"""

from __future__ import annotations

import ast
from typing import Dict

from source import assigned, bases, inner_class


def is_choices(node: ast.AST) -> bool:
    return isinstance(node, ast.ClassDef) and any(b.split(".")[-1].endswith("Choices") for b in bases(node))


def choices_of(model, name: str) -> Dict[str, str]:
    """A Choices class, as member name to the value stored in the column. Looked
    up inside the model first, then among the module's own classes."""
    node = inner_class(model.node, name)
    if node is None:
        for other in model.module.classes():
            if other.name == name:
                node = other
                break
    if node is None or not is_choices(node):
        return {}
    out = {}
    for member, value, _ in assigned(node):
        if isinstance(value, ast.Constant) and not isinstance(value.value, bool):
            out[member] = str(value.value)
        elif isinstance(value, ast.Tuple) and value.elts and isinstance(value.elts[0], ast.Constant):
            out[member] = str(value.elts[0].value)
    return out


def choice_tables(model) -> Dict[str, Dict[str, str]]:
    """Every Choices class in reach of the model, by class name."""
    out = {}
    for node in list(model.node.body) + list(model.module.tree.body):
        if is_choices(node):
            out[node.name] = choices_of(model, node.name)
    return out
