"""What a model field says a value must satisfy, in the catalog's words.

A Django model states its rules in the field call: `CharField(max_length=3,
unique=True, choices=Status.choices, validators=[MinValueValidator(0)])`. The
catalog has one vocabulary for these across every source (portolan.0015), so
`max_length` is `max_len` here as `minLength` is in an OpenAPI document and
`min_len` in a proto, and the page says all three the same way.

The model is the source of truth for `required`: a field must be given when a
row is made unless the class fills it in (`default`, `auto_now`, an auto id),
lets it be empty (`blank`) or lets it be absent (`null`). What a serializer or
a form adds on top is that layer's word, not the model's, and is not read here.
"""

from __future__ import annotations

import ast
from typing import Dict, List, Optional

import catalog
from choices import choice_tables
from source import assigned, dotted, keyword, keyword_bool

# The field classes whose name is itself a rule on the value.
FORMATS = {
    "EmailField": "email",
    "URLField": "uri",
    "UUIDField": "uuid",
    "GenericIPAddressField": "ip",
}
NON_NEGATIVE = {"PositiveIntegerField", "PositiveBigIntegerField", "PositiveSmallIntegerField"}

# Never required: the database numbers an auto id, a bool is False when not
# given, and a many-to-many is a table of its own with no row to be missing.
NEVER_REQUIRED = {"AutoField", "BigAutoField", "SmallAutoField", "BooleanField", "ManyToManyField"}

# Options under which the model itself fills or excuses the value.
FILLED_OR_EXCUSED = ("blank", "null", "auto_now", "auto_now_add")

VALIDATORS = {
    "MinValueValidator": "gte",
    "MaxValueValidator": "lte",
    "MinLengthValidator": "min_len",
    "MaxLengthValidator": "max_len",
    "RegexValidator": "pattern",
}


def rules_of(f, model) -> Dict[str, object]:
    """`required` and `rules` for `catalog.field`, as keyword arguments; an
    empty dict when the field says nothing about its value."""
    out: Dict[str, object] = {}
    if required(f):
        out["required"] = True
    found = rules(f, model)
    if found:
        out["rules"] = found
    return out


def required(f) -> bool:
    if f.kind in NEVER_REQUIRED:
        return False
    if any(keyword_bool(f.call, option) for option in FILLED_OR_EXCUSED):
        return False
    return keyword(f.call, "default") is None


def rules(f, model) -> List[Dict[str, str]]:
    """The rules in the order the source states them: what the field class
    says first, then the options as written."""
    out = []
    if f.kind in FORMATS:
        out.append(catalog.rule("format", FORMATS[f.kind]))
    if f.kind in NON_NEGATIVE:
        out.append(catalog.rule("gte", "0"))
    for kw in f.call.keywords:
        if kw.arg == "max_length":
            length = f.integer("max_length")
            if length is not None:
                out.append(catalog.rule("max_len", str(length)))
        elif kw.arg == "unique" and keyword_bool(f.call, "unique"):
            out.append(catalog.rule("unique"))
        elif kw.arg == "choices":
            values = choice_values(kw.value, model)
            if values:
                out.append(catalog.rule("in", ", ".join(values)))
        elif kw.arg == "validators":
            out.extend(validator_rules(kw.value))
    return out


def choice_values(node: ast.AST, model, depth: int = 0) -> List[str]:
    """The values a `choices=` option allows, in the order it lists them.

    `Status.choices` reads the Choices class; a literal list of pairs or of
    bare values reads the value of each pair, descending into a group's own
    list; a name reads the module-level constant it is assigned. Anything
    else - a call, an import the module does not define - yields nothing, and
    nothing is what the field then says, rather than an empty `in`.
    """
    if depth > 3:
        return []
    if isinstance(node, ast.Attribute) and node.attr == "choices":
        table = choice_tables(model).get(dotted(node.value).split(".")[-1], {})
        return list(table.values())
    if isinstance(node, (ast.List, ast.Tuple)):
        out: List[str] = []
        for item in node.elts:
            if isinstance(item, ast.Constant) and not isinstance(item.value, bool):
                out.append(str(item.value))
            elif isinstance(item, (ast.List, ast.Tuple)) and item.elts:
                first = item.elts[0]
                second = item.elts[1] if len(item.elts) > 1 else None
                if isinstance(second, (ast.List, ast.Tuple)):
                    out.extend(choice_values(second, model, depth + 1))  # a group: (label, [pairs])
                elif isinstance(first, ast.Constant) and not isinstance(first.value, bool):
                    out.append(str(first.value))
                elif isinstance(first, ast.Attribute):
                    value = choice_member(first, model)
                    if value:
                        out.append(value)
        return out
    if isinstance(node, ast.Name):
        for name, value, _ in assigned(model.module.tree):
            if name == node.id:
                return choice_values(value, model, depth + 1)
    return []


def choice_member(node: ast.Attribute, model) -> Optional[str]:
    """`Status.DRAFT` in a literal list of pairs: the member's stored value."""
    table = choice_tables(model).get(dotted(node.value).split(".")[-1], {})
    return table.get(node.attr)


def validator_rules(node: ast.AST) -> List[Dict[str, str]]:
    """`validators=[MinValueValidator(0), RegexValidator(r"^[A-Z]+$")]`: the
    validators the catalog has words for, with the bound they were given. A
    validator built from a name the module computes, or a regex meant to be
    NOT matched, is left out rather than guessed."""
    if not isinstance(node, (ast.List, ast.Tuple)):
        return []
    out = []
    for item in node.elts:
        if not isinstance(item, ast.Call):
            continue
        rule = VALIDATORS.get(dotted(item.func).split(".")[-1])
        if rule is None or keyword_bool(item, "inverse_match"):
            continue
        given = item.args[0] if item.args else keyword(item, "limit_value") or keyword(item, "regex")
        if isinstance(given, ast.Constant) and not isinstance(given.value, bool):
            out.append(catalog.rule(rule, str(given.value)))
    return out
