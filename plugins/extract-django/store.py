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
from typing import Dict, List, Optional, Tuple

import catalog
from apps import label_of
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


def column_type(f: FieldDef, kind: str, b, ref: str) -> str:
    if kind != "postgres":
        return f.kind
    base = POSTGRES.get(f.kind)
    if base is None:
        b.warn(ref, "%s is not a field this reader has a column type for; the column keeps the field's own name" % f.kind)
        return f.kind
    if f.kind == "CharField":
        length = keyword_int(f.call, "max_length")
        return "varchar(%d)" % length if length else "varchar"
    if f.kind == "DecimalField":
        digits, places = keyword_int(f.call, "max_digits"), keyword_int(f.call, "decimal_places")
        if digits is not None and places is not None:
            return "numeric(%d,%d)" % (digits, places)
        return "numeric"
    return base


SERIAL = {"serial": "integer", "bigserial": "bigint", "smallserial": "smallint"}


def target_of(f: FieldDef, model: ModelDef, tables: Dict[str, Tuple[str, ModelDef]]) -> Optional[Tuple[str, ModelDef]]:
    """The model a relational field points at, wherever in the service it is."""
    if f.kind not in ("ForeignKey", "OneToOneField"):
        return None
    name = f.relation.split(".")[-1]
    if name in ("self", ""):
        name = model.name
    return tables.get(name)


def key_type(model: ModelDef, kind: str, b, ref: str) -> str:
    """What a foreign key pointing at this model holds. A key into a bigserial
    column is a bigint: the sequence belongs to the row, not to the reference."""
    f = pk_field(model)
    if f is None:
        return "bigint"
    declared = column_type(f, kind, b, ref)
    return SERIAL.get(declared, declared)


def fk_of(f: FieldDef, model: ModelDef, tables: Dict[str, Tuple[str, ModelDef]], store_id: str) -> Optional[Dict[str, str]]:
    hit = target_of(f, model, tables)
    if hit is None:
        return None
    name, target_model = hit
    on_delete = dotted(keyword(f.call, "on_delete")).split(".")[-1]
    out = {"table": "%s.%s" % (store_id, name), "column": pk_name(target_model)}
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


def index(aggregates: List[Aggregate]) -> Dict[str, Tuple[str, ModelDef]]:
    """Every model of the service by name, with the table it is kept in. A
    foreign key crosses an application boundary as easily as it crosses a
    module one, so the lookup cannot be per aggregate."""
    out: Dict[str, Tuple[str, ModelDef]] = {}
    for agg in aggregates:
        label = label_of(agg.app)
        for model in agg.models:
            out[model.name] = (table_name(model, label), model)
    return out


def read(agg: Aggregate, names: Dict[str, Tuple[str, ModelDef]], svc_id: str, store: str, kind: str, b) -> List[Dict[str, object]]:
    """The tables one aggregate keeps."""
    store_id = "%s.%s" % (svc_id, store)
    out = []
    for model in agg.models:
        name, _ = names[model.name]
        table_id = "%s.%s" % (store_id, name)
        columns: List[Dict[str, object]] = []
        by_field: Dict[str, str] = {}
        if pk_field(model) is None:
            columns.append(catalog.column("id", "bigserial", False, pk=True))
            by_field["id"] = "id"
        for f in model.fields:
            if f.kind == "ManyToManyField":
                b.warn(table_id, "%s is a many-to-many: the table Django makes for it is not named here" % f.name)
                continue
            column = column_name(f)
            by_field[f.name] = column
            fk = fk_of(f, model, names, store_id)
            target = target_of(f, model, names)
            if fk is not None and target is not None:
                maps = "%s.%s" % (target[1].name, pk_name(target[1]))
                declared = key_type(target[1], kind, b, table_id)
            else:
                maps = "%s.%s" % (model.name, f.name)
                declared = column_type(f, kind, b, table_id)
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
        block = "%s.%s" % (agg.id, slug(model.name))
        out.append(
            catalog.table(
                table_id,
                name,
                columns,
                indexes(model, name, by_field),
                {"aggregate": agg.id, "block": block},
                "aggregate-root" if model is agg.root else "child",
                meta_str(model, "verbose_name"),
            )
        )
    return out
