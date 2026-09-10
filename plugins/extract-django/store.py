"""The schema, read off the models.

A Django model is both the domain object and the table, so the two facts the
SQL extractor has to pair up - a column, and the field it carries - are one
declaration here. That is why the store comes out of this plugin rather than
out of `extract-sql`: nothing has to be guessed, and `maps` is exact.

The types are the ones Django's PostgreSQL backend emits. `storeKind` picks the
mapping; a kind with no mapping is reported and the column keeps the field's
own name, which is honest about not knowing rather than plausible and wrong.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import catalog
from apps import App, label_of
from domain import Aggregate, FieldDef, ModelDef
from ids import slug
from source import assigned, const_str, dotted, inner_class, keyword, keyword_bool, keyword_int, keyword_str

POSTGRES = {
    "AutoField": "serial",
    "BigAutoField": "bigserial",
    "SmallAutoField": "smallserial",
    "BigIntegerField": "bigint",
    "BinaryField": "bytea",
    "BooleanField": "boolean",
    "CharField": "varchar",
    "DateField": "date",
    "DateTimeField": "timestamptz",
    "DecimalField": "numeric",
    "DurationField": "interval",
    "EmailField": "varchar(254)",
    "FileField": "varchar(100)",
    "FilePathField": "varchar(100)",
    "FloatField": "double precision",
    "GenericIPAddressField": "inet",
    "ImageField": "varchar(100)",
    "IntegerField": "integer",
    "JSONField": "jsonb",
    "PositiveBigIntegerField": "bigint",
    "PositiveIntegerField": "integer",
    "PositiveSmallIntegerField": "smallint",
    "SlugField": "varchar(50)",
    "SmallIntegerField": "smallint",
    "TextField": "text",
    "TimeField": "time",
    "URLField": "varchar(200)",
    "UUIDField": "uuid",
    # django-multiselectfield stores its comma-separated value in a varchar.
    "MultiSelectField": "varchar",
}

ON_DELETE = {
    "CASCADE": "cascade",
    "SET_NULL": "set null",
    "SET_DEFAULT": "set default",
    "PROTECT": "restrict",
    "RESTRICT": "restrict",
    "DO_NOTHING": "no action",
}

def meta_value(model: ModelDef, name: str):
    meta = inner_class(model.node, "Meta")
    if meta is None:
        return None
    for attr, value, _ in assigned(meta):
        if attr == name:
            return value
    return None


def meta_str(model: ModelDef, name: str) -> str:
    return const_str(meta_value(model, name))


def table_name(model: ModelDef, label: str) -> str:
    """`Meta.db_table`, or the name Django composes: `<app label>_<model>`."""
    return meta_str(model, "db_table") or "%s_%s" % (label, model.name.lower())


def column_name(f: FieldDef) -> str:
    declared = keyword_str(f.call, "db_column")
    if declared:
        return declared
    return f.name + "_id" if f.kind in ("ForeignKey", "OneToOneField") else f.name


def field_call_type(field_kind: str, call: ast.Call, kind: str, b, ref: str, integers: Optional[Dict[str, int]] = None) -> str:
    integers = integers or {}
    if kind != "postgres":
        return field_kind
    if field_kind == "ArrayField":
        base_field = call.args[0] if call.args else keyword(call, "base_field")
        if not isinstance(base_field, ast.Call):
            b.warn(ref, "ArrayField has no statically readable base field; the column keeps the field's own name")
            return field_kind
        item_kind = dotted(base_field.func).split(".")[-1]
        item_type = field_call_type(item_kind, base_field, kind, b, ref)
        size = integers.get("size", keyword_int(call, "size"))
        return "%s[%s]" % (item_type, size if size is not None else "")
    base = POSTGRES.get(field_kind)
    if base is None:
        b.warn(ref, "%s is not a field this reader has a column type for; the column keeps the field's own name" % field_kind)
        return field_kind
    if field_kind in ("CharField", "MultiSelectField"):
        length = integers.get("max_length", keyword_int(call, "max_length"))
        return "varchar(%d)" % length if length else "varchar"
    if field_kind == "DecimalField":
        digits = integers.get("max_digits", keyword_int(call, "max_digits"))
        places = integers.get("decimal_places", keyword_int(call, "decimal_places"))
        if digits is not None and places is not None:
            return "numeric(%d,%d)" % (digits, places)
        return "numeric"
    return base


def column_type(f: FieldDef, kind: str, b, ref: str) -> str:
    return field_call_type(f.kind, f.call, kind, b, ref, f.integers)


SERIAL = {"serial": "integer", "bigserial": "bigint", "smallserial": "smallint"}


@dataclass
class ModelIndex:
    """Models addressable the same ways Django relation fields spell them."""

    qualified: Dict[str, Tuple[str, ModelDef]]
    by_name: Dict[str, List[Tuple[str, ModelDef]]]

    def find(self, relation: str, current: ModelDef) -> Optional[Tuple[str, ModelDef]]:
        name = relation.strip("'\"")
        if name in ("self", ""):
            name = current.name
        if "." in name:
            hit = self.qualified.get(name.lower())
            if hit is not None:
                return hit
        local = self.qualified.get((current.app.label + "." + name).lower())
        if local is not None:
            return local
        candidates = self.by_name.get(name.lower(), [])
        return candidates[0] if len(candidates) == 1 else None


def target_of(f: FieldDef, model: ModelDef, tables: ModelIndex) -> Optional[Tuple[str, ModelDef]]:
    """The model a relational field points at, wherever in the service it is."""
    if f.kind not in ("ForeignKey", "OneToOneField", "ManyToManyField"):
        return None
    return tables.find(f.relation, model)


def auto_column_type(auto_field: str, kind: str) -> str:
    return POSTGRES.get(auto_field, auto_field) if kind == "postgres" else auto_field


def referenced_field(model: ModelDef, relation: Optional[FieldDef] = None) -> Optional[FieldDef]:
    to_field = keyword_str(relation.call, "to_field") if relation is not None else ""
    return model.field(to_field) if to_field else pk_field(model)


def referenced_column(model: ModelDef, relation: Optional[FieldDef] = None) -> str:
    field = referenced_field(model, relation)
    return column_name(field) if field is not None else "id"


def referenced_name(model: ModelDef, relation: Optional[FieldDef] = None) -> str:
    field = referenced_field(model, relation)
    return field.name if field is not None else "id"


def key_type(model: ModelDef, kind: str, auto_field: str, b, ref: str, relation: Optional[FieldDef] = None) -> str:
    """What a foreign key pointing at this model holds. A key into a bigserial
    column is a bigint: the sequence belongs to the row, not to the reference."""
    f = referenced_field(model, relation)
    if f is None:
        return SERIAL.get(auto_column_type(auto_field, kind), auto_column_type(auto_field, kind))
    declared = column_type(f, kind, b, ref)
    return SERIAL.get(declared, declared)


def fk_of(f: FieldDef, model: ModelDef, tables: ModelIndex, store_id: str) -> Optional[Dict[str, str]]:
    constrained = keyword(f.call, "db_constraint")
    if isinstance(constrained, ast.Constant) and constrained.value is False:
        return None
    hit = target_of(f, model, tables)
    if hit is None:
        return None
    name, target_model = hit
    on_delete = dotted(keyword(f.call, "on_delete")).split(".")[-1]
    out = {"table": "%s.%s" % (store_id, name), "column": referenced_column(target_model, f)}
    if on_delete in ON_DELETE:
        out["onDelete"] = ON_DELETE[on_delete]
    return out


def pk_field(model: ModelDef) -> Optional[FieldDef]:
    for f in model.fields:
        if keyword_bool(f.call, "primary_key"):
            return f
    return None


def pk_name(model: ModelDef) -> str:
    f = pk_field(model)
    return column_name(f) if f is not None else "id"


def indexes(model: ModelDef, table: str, columns: Dict[str, str]) -> List[Dict[str, object]]:
    """What the database is told to keep, from the fields and from Meta.

    Django appends a hash of its own to an index it names itself; inventing one
    would be a name no database has, so an index without a declared name is
    called after its table and its columns.
    """
    out: List[Dict[str, object]] = []
    for f in model.fields:
        column = columns.get(f.name)
        if column is None:
            continue
        if keyword_bool(f.call, "unique"):
            out.append({"name": "%s_%s_key" % (table, column), "columns": [column], "unique": True})
        elif keyword_bool(f.call, "db_index"):
            out.append({"name": "%s_%s" % (table, column), "columns": [column], "unique": False})
    listed = meta_value(model, "indexes")
    if isinstance(listed, (ast.List, ast.Tuple)):
        for item in listed.elts:
            if not isinstance(item, ast.Call):
                continue
            fields = keyword(item, "fields")
            names = [columns.get(const_str(e).lstrip("-"), const_str(e).lstrip("-")) for e in fields.elts] if isinstance(fields, (ast.List, ast.Tuple)) else []
            if not names:
                continue
            out.append({"name": keyword_str(item, "name") or "%s_%s" % (table, "_".join(names)), "columns": names, "unique": False})
    for name in ("unique_together", "constraints"):
        value = meta_value(model, name)
        if not isinstance(value, (ast.List, ast.Tuple, ast.Set)):
            continue
        for item in value.elts:
            names: List[str] = []
            declared = ""
            if isinstance(item, (ast.Tuple, ast.List)):
                names = [columns.get(const_str(e), const_str(e)) for e in item.elts if const_str(e)]
            elif isinstance(item, ast.Call):
                fields = keyword(item, "fields")
                if isinstance(fields, (ast.List, ast.Tuple)):
                    names = [columns.get(const_str(e), const_str(e)) for e in fields.elts if const_str(e)]
                declared = keyword_str(item, "name")
            if names:
                out.append({"name": declared or "%s_%s_key" % (table, "_".join(names)), "columns": names, "unique": True})
    return out


def index_models(models_by_app: Dict[str, List[ModelDef]]) -> ModelIndex:
    """Every concrete model, including applications with no aggregate root.

    Qualified names always resolve. A bare model name resolves only when it is
    unique across the service, matching Django's preference for a local app
    before a globally imported model.
    """
    qualified: Dict[str, Tuple[str, ModelDef]] = {}
    by_name: Dict[str, List[Tuple[str, ModelDef]]] = {}
    for models in models_by_app.values():
        for model in models:
            if not model.concrete:
                continue
            hit = (table_name(model, label_of(model.app)), model)
            qualified[(model.app.label + "." + model.name).lower()] = hit
            qualified[(model.app.dotted + "." + model.name).lower()] = hit
            by_name.setdefault(model.name.lower(), []).append(hit)
    return ModelIndex(qualified=qualified, by_name=by_name)


def aggregate_models(aggregates: List[Aggregate]) -> Dict[Tuple[str, str], Aggregate]:
    out: Dict[Tuple[str, str], Aggregate] = {}
    for aggregate in aggregates:
        for model in aggregate.models:
            out[(model.module.dotted, model.name)] = aggregate
    return out


def model_table(
    model: ModelDef,
    names: ModelIndex,
    aggregate: Optional[Aggregate],
    domains: Dict[Tuple[str, str], Aggregate],
    svc_id: str,
    store: str,
    kind: str,
    auto_field: str,
    b,
) -> Dict[str, object]:
    store_id = "%s.%s" % (svc_id, store)
    found = names.find(model.app.label + "." + model.name, model)
    name = found[0] if found is not None else table_name(model, label_of(model.app))
    table_id = "%s.%s" % (store_id, name)
    columns: List[Dict[str, object]] = []
    by_field: Dict[str, str] = {}
    if pk_field(model) is None:
        columns.append(catalog.column("id", auto_column_type(auto_field, kind), False, pk=True))
        by_field["id"] = "id"
    for f in model.fields:
        if f.kind == "ManyToManyField":
            continue
        column = column_name(f)
        by_field[f.name] = column
        fk = fk_of(f, model, names, store_id)
        target = target_of(f, model, names)
        if target is not None:
            declared = key_type(target[1], kind, auto_field, b, table_id, f)
        elif f.kind in ("ForeignKey", "OneToOneField"):
            implicit = auto_column_type(auto_field, kind)
            declared = SERIAL.get(implicit, implicit)
            b.warn(
                model.module.where(f.node),
                "%s.%s points at %s, which is not a model read here; the column uses the default primary-key type and has no FK link"
                % (model.name, f.name, f.relation or "a model"),
            )
        else:
            declared = column_type(f, kind, b, table_id)
        if target is not None and (target[1].module.dotted, target[1].name) in domains:
            maps = "%s.%s" % (target[1].name, referenced_name(target[1], f))
        else:
            maps = "%s.%s" % (model.name, f.name) if aggregate is not None else ""
        columns.append(
            catalog.column(
                column,
                declared,
                keyword_bool(f.call, "null"),
                pk=keyword_bool(f.call, "primary_key"),
                fk=fk,
                maps=maps,
                doc=f.help(),
            )
        )
    block = "%s.%s" % (aggregate.id, slug(model.name)) if aggregate is not None else ""
    return catalog.table(
        table_id,
        name,
        columns,
        indexes(model, name, by_field),
        {"aggregate": aggregate.id, "block": block} if aggregate is not None else None,
        "aggregate-root" if aggregate is not None and model is aggregate.root else "child" if aggregate is not None and aggregate.root is not None else "",
        meta_str(model, "verbose_name"),
    )


def many_to_many_tables(
    model: ModelDef,
    names: ModelIndex,
    svc_id: str,
    store: str,
    kind: str,
    auto_field: str,
    b,
) -> List[Dict[str, object]]:
    """Implicit join tables created by Django for ManyToManyField values."""
    store_id = "%s.%s" % (svc_id, store)
    source_hit = names.find(model.app.label + "." + model.name, model)
    if source_hit is None:
        return []
    source_table, _ = source_hit
    out: List[Dict[str, object]] = []
    for field in model.fields:
        if field.kind != "ManyToManyField" or keyword(field.call, "through") is not None:
            continue
        target = target_of(field, model, names)
        if target is None:
            b.warn(model.module.where(field.node), "%s.%s is a many-to-many whose target %s cannot be resolved" % (model.name, field.name, field.relation or "model"))
            continue
        target_table, target_model = target
        relation_table = keyword_str(field.call, "db_table") or "%s_%s" % (source_table, field.name)
        table_id = "%s.%s" % (store_id, relation_table)
        if target_model is model:
            source_column = "from_%s_id" % model.name.lower()
            target_column = "to_%s_id" % model.name.lower()
        else:
            source_column = "%s_id" % model.name.lower()
            target_column = "%s_id" % target_model.name.lower()
        columns = [
            catalog.column("id", auto_column_type(auto_field, kind), False, pk=True),
            catalog.column(
                source_column,
                key_type(model, kind, auto_field, b, table_id),
                False,
                fk={"table": "%s.%s" % (store_id, source_table), "column": pk_name(model), "onDelete": "cascade"},
            ),
            catalog.column(
                target_column,
                key_type(target_model, kind, auto_field, b, table_id),
                False,
                fk={"table": "%s.%s" % (store_id, target_table), "column": pk_name(target_model), "onDelete": "cascade"},
            ),
        ]
        out.append(
            catalog.table(
                table_id,
                relation_table,
                columns,
                [{"name": "%s_%s_%s_key" % (relation_table, source_column, target_column), "columns": [source_column, target_column], "unique": True}],
                None,
                "",
                "Django-generated many-to-many table for %s.%s." % (model.name, field.name),
            )
        )
    return out


def read_all(
    models_by_app: Dict[str, List[ModelDef]],
    aggregates: List[Aggregate],
    svc_id: str,
    store: str,
    kind: str,
    auto_field: str,
    b,
) -> List[Dict[str, object]]:
    """The complete ORM schema, whether or not domain roots were inferred."""
    names = index_models(models_by_app)
    domains = aggregate_models(aggregates)
    out: List[Dict[str, object]] = []
    for models in models_by_app.values():
        for model in models:
            if not model.concrete:
                continue
            aggregate = domains.get((model.module.dotted, model.name))
            out.append(model_table(model, names, aggregate, domains, svc_id, store, kind, auto_field, b))
            out.extend(many_to_many_tables(model, names, svc_id, store, kind, auto_field, b))
    return out
