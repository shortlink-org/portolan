"""`models.py` read as the model.

A Django application groups its models. When a root is known, the group is
an aggregate; otherwise it remains a model-group with no asserted boundary.
Frozen dataclasses in `values.py` are its value objects. Ambiguity never hides
the concrete models or requires configuration to browse them.
"""

from __future__ import annotations

import ast
import json
from dataclasses import dataclass, field as dc_field
from typing import Dict, List, Optional

import catalog
from apps import App
from ids import aggregate_id, block_id, pascal, singular, slug
from source import (
    Module,
    Project,
    assigned,
    bases,
    const_str,
    doc,
    dotted,
    inner_class,
    keyword,
    keyword_str,
    type_of,
)

RELATIONS = {"ForeignKey", "OneToOneField", "ManyToManyField"}


@dataclass
class FieldDef:
    name: str
    kind: str  # the field class as written, last segment: "CharField"
    call: ast.Call
    node: ast.AST
    integers: Dict[str, int] = dc_field(default_factory=dict)

    @property
    def relation(self) -> str:
        """What a relational field points at, as written."""
        if self.kind not in RELATIONS or not self.call.args:
            return ""
        first = self.call.args[0]
        return const_str(first) or dotted(first)

    def type(self) -> str:
        target = self.relation
        return "%s[%s]" % (self.kind, target) if target else self.kind

    def help(self) -> str:
        return keyword_str(self.call, "help_text")

    def integer(self, name: str) -> Optional[int]:
        return self.integers.get(name)


@dataclass
class ModelDef:
    name: str
    node: ast.ClassDef
    module: Module
    app: App
    abstract: bool = False
    proxy: bool = False
    fields: List[FieldDef] = dc_field(default_factory=list)

    @property
    def concrete(self) -> bool:
        return not self.abstract and not self.proxy

    @property
    def meta(self) -> Optional[ast.ClassDef]:
        return inner_class(self.node, "Meta")

    def field(self, name: str) -> Optional[FieldDef]:
        for f in self.fields:
            if f.name == name:
                return f
        return None


@dataclass
class Aggregate:
    """One application, and the catalog object being built from it."""

    app: App
    root: Optional[ModelDef]
    models: List[ModelDef]
    aggregate: Dict[str, object]

    @property
    def id(self) -> str:
        return str(self.aggregate["id"])

    @property
    def slug(self) -> str:
        return str(self.aggregate["slug"])


def is_model(node: ast.ClassDef, known: Dict[str, ast.ClassDef]) -> bool:
    for base in bases(node):
        last = base.split(".")[-1]
        if last == "Model" or last in known:
            return True
    return False


def is_dataclass(node: ast.ClassDef) -> bool:
    for dec in getattr(node, "decorator_list", []):
        if dotted(dec).split(".")[-1] == "dataclass":
            return True
    return False


def integer_value(value: Optional[ast.AST], module: Module, modules: Dict[str, Module], depth: int = 0) -> Optional[int]:
    """A small integer expression, including constants imported from a model module."""
    if value is None or depth > 5:
        return None
    if isinstance(value, ast.Constant) and isinstance(value.value, int) and not isinstance(value.value, bool):
        return value.value
    if isinstance(value, ast.Name):
        imported = module.imports.get(value.id)
        target = modules.get(imported.module) if imported is not None else module
        name = imported.name if imported is not None else value.id
        if target is None:
            return None
        for assigned_name, assigned_value, _ in assigned(target.tree):
            if assigned_name == name:
                return integer_value(assigned_value, target, modules, depth + 1)
    if isinstance(value, ast.BinOp):
        left = integer_value(value.left, module, modules, depth + 1)
        right = integer_value(value.right, module, modules, depth + 1)
        if left is None or right is None:
            return None
        if isinstance(value.op, ast.Add):
            return left + right
        if isinstance(value.op, ast.Mult):
            return left * right
        if isinstance(value.op, ast.LShift):
            return left << right
    return None


def read_fields(node: ast.ClassDef, module: Module, modules: Dict[str, Module]) -> List[FieldDef]:
    out = []
    for name, value, stmt in assigned(node):
        if not isinstance(value, ast.Call):
            continue
        kind = dotted(value.func).split(".")[-1]
        if kind.endswith("Field") or kind in RELATIONS:
            integers = {
                option: found
                for option in ("max_length", "max_digits", "decimal_places", "size")
                if (found := integer_value(keyword(value, option), module, modules)) is not None
            }
            out.append(FieldDef(name=name, kind=kind, call=value, node=stmt, integers=integers))
    return out


def meta_flag(node: ast.ClassDef, name: str) -> bool:
    meta = inner_class(node, "Meta")
    if meta is None:
        return False
    for attr, value, _ in assigned(meta):
        if attr == name and isinstance(value, ast.Constant):
            return value.value is True
    return False


def inherited_fields(model: ModelDef, models: Dict[str, ModelDef], modules: Dict[str, Module], active=None) -> List[FieldDef]:
    """Fields copied from abstract bases, followed by fields on the model.

    Django copies abstract-base fields into each concrete child. Model modules
    are independent Python files, so their path order must not decide whether
    an imported base is understood.
    """
    active = set(active or ())
    if model.name in active:
        return read_fields(model.node, model.module, modules)
    active.add(model.name)
    fields: List[FieldDef] = []
    for base in bases(model.node):
        parent = models.get(base.split(".")[-1])
        if parent is not None and parent.abstract:
            fields.extend(inherited_fields(parent, models, modules, active))
    fields.extend(read_fields(model.node, model.module, modules))
    by_name: Dict[str, FieldDef] = {}
    for field in fields:
        by_name[field.name] = field
    return list(by_name.values())


def read_models(app: App) -> List[ModelDef]:
    """Every model of an application, independent of module path order."""
    classes = [(module, node) for module in app.models for node in module.classes()]
    known: Dict[str, ast.ClassDef] = {}
    changed = True
    while changed:
        changed = False
        for _module, node in classes:
            if node.name in known or not is_model(node, known):
                continue
            known[node.name] = node
            changed = True

    out = [
        ModelDef(
            name=node.name,
            node=node,
            module=module,
            app=app,
            abstract=meta_flag(node, "abstract"),
            proxy=meta_flag(node, "proxy"),
        )
        for module, node in classes
        if node.name in known
    ]
    definitions = {model.name: model for model in out}
    modules = {module.dotted: module for module in app.models}
    for model in out:
        model.fields = inherited_fields(model, definitions, modules)
    return out


def value_objects(app: App) -> List[ast.ClassDef]:
    """The dataclasses in `<app>/values.py`: a shape with rules and no row of
    its own is a value object, and keeping them in one module is what says so."""
    out = []
    for module in app.package("values"):
        for node in module.classes():
            if is_dataclass(node):
                out.append((module, node))
    return out


def block_fields(node: ast.ClassDef) -> List[Dict[str, object]]:
    """The annotated attributes of a dataclass, with the type as written."""
    out = []
    for stmt in node.body:
        if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
            out.append(catalog.field(stmt.target.id, type_of(stmt.annotation)))
    return out


def root_of(app: App, models: List[ModelDef], named: Dict[str, str], b) -> Optional[ModelDef]:
    """The root is the model named after the application - `invoices` holds
    `Invoice` - or the only model there is, or the one the manifest names."""
    concrete = [m for m in models if m.concrete]
    want = named.get(app.dotted) or named.get(app.label)
    if want:
        for m in concrete:
            if m.name == want:
                return m
        b.warn(app.rel, "aggregates names %s for %s, and no model there is called that%s" % (want, app.label, aggregate_candidates(app, concrete)))
        return None
    for candidate in (pascal(singular(app.label)), pascal(app.label)):
        for m in concrete:
            if m.name == candidate:
                return m
    if len(concrete) == 1:
        return concrete[0]
    if not concrete:
        b.warn(app.rel, "no models in this application: nothing here to be an aggregate")
        return None
    return None


def aggregate_candidates(app: App, models: List[ModelDef]) -> str:
    """Keep candidate evidence in the warning-only plugin protocol."""
    return "; aggregate candidates: " + json.dumps({
        "app": app.dotted,
        "models": [
            {"name": model.name, "path": model.module.rel, "line": model.node.lineno}
            for model in sorted(models, key=lambda model: (model.name, model.module.rel))
        ],
    }, ensure_ascii=True)


def read_aggregates(
    project: Project,
    applications: List[App],
    svc_id: str,
    named: Dict[str, str],
    b,
    models_by_app: Optional[Dict[str, List[ModelDef]]] = None,
) -> List[Aggregate]:
    out = []
    for app in applications:
        models = (models_by_app or {}).get(app.dotted)
        if models is None:
            models = read_models(app)
        root = root_of(app, models, named, b)
        concrete = [m for m in models if m.concrete]
        if not concrete:
            continue
        ordered = [root] + [m for m in concrete if m is not root] if root else concrete
        # An application is a source grouping, not proof of a transactional
        # boundary. Keep every model visible without inventing such a boundary.
        agg_slug = slug(root.name) if root else "models-" + slug(app.dotted.replace(".", "-"))
        agg_id = aggregate_id(svc_id, agg_slug)
        readme = app.readme or ((ast.get_docstring(root.node, clean=True) or "").strip() if root else "")
        obj = catalog.aggregate(agg_id, agg_slug, root.name if root else app.dotted, readme, root.name if root else "")
        if root is None:
            obj["kind"] = "model-group"
        for model in ordered:
            obj["entities"].append(
                catalog.block(
                    block_id(agg_id, slug(model.name)),
                    slug(model.name),
                    model.name,
                    doc(model.node),
                    [catalog.field(f.name, f.type(), f.help()) for f in model.fields],
                )
            )
        for module, node in value_objects(app):
            obj["valueObjects"].append(
                catalog.block(block_id(agg_id, slug(node.name)), slug(node.name), node.name, doc(node), block_fields(node))
            )
        for model in ordered:
            if not model.fields:
                b.warn(model.module.rel, "%s declares no fields: nothing of it reaches the page" % model.name)
        out.append(Aggregate(app=app, root=root, models=ordered, aggregate=obj))
    return out
