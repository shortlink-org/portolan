"""`models.py` read as the model.

A Django application is one aggregate: the root is the model named after the
application, the other models in it are its entities, and the frozen
dataclasses in `values.py` are its value objects. Nothing is annotated for the
catalog - the application is the claim, the same way a directory is the claim
in `extract-ts`.
"""

from __future__ import annotations

import ast
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


@dataclass
class ModelDef:
    name: str
    node: ast.ClassDef
    module: Module
    app: App
    abstract: bool = False
    fields: List[FieldDef] = dc_field(default_factory=list)

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
    root: ModelDef
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


def read_fields(node: ast.ClassDef) -> List[FieldDef]:
    out = []
    for name, value, stmt in assigned(node):
        if not isinstance(value, ast.Call):
            continue
        kind = dotted(value.func).split(".")[-1]
        if kind.endswith("Field") or kind in RELATIONS:
            out.append(FieldDef(name=name, kind=kind, call=value, node=stmt))
    return out


def read_models(app: App) -> List[ModelDef]:
    """Every model of an application, in the order the files declare them."""
    out: List[ModelDef] = []
    known: Dict[str, ast.ClassDef] = {}
    for module in app.models:
        for node in module.classes():
            if not is_model(node, known):
                continue
            known[node.name] = node
            meta = inner_class(node, "Meta")
            abstract = False
            if meta is not None:
                for name, value, _ in assigned(meta):
                    if name == "abstract" and isinstance(value, ast.Constant) and value.value is True:
                        abstract = True
            out.append(ModelDef(name=node.name, node=node, module=module, app=app, abstract=abstract, fields=read_fields(node)))
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
    concrete = [m for m in models if not m.abstract]
    want = named.get(app.dotted) or named.get(app.label)
    if want:
        for m in concrete:
            if m.name == want:
                return m
        b.warn(app.rel, "aggregates names %s for %s, and no model there is called that" % (want, app.label))
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
    b.warn(
        app.rel,
        "no model called %s, and %d models to choose from: name the root in the aggregates option" % (pascal(singular(app.label)), len(concrete)),
    )
    return None


def read_aggregates(project: Project, applications: List[App], svc_id: str, named: Dict[str, str], b) -> List[Aggregate]:
    out = []
    for app in applications:
        models = read_models(app)
        root = root_of(app, models, named, b)
        if root is None:
            continue
        concrete = [m for m in models if not m.abstract]
        ordered = [root] + [m for m in concrete if m is not root]
        agg_slug = slug(root.name)
        agg_id = aggregate_id(svc_id, agg_slug)
        readme = app.readme or (ast.get_docstring(root.node, clean=True) or "").strip()
        obj = catalog.aggregate(agg_id, agg_slug, root.name, readme, root.name)
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
