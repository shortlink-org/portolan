"""Which database the models are the schema of, read off the settings.

`DATABASES["default"]["ENGINE"]` is the one line a Django project always
has that says what it runs on, and it is read the way the Celery settings are:
a literal, the default of an environment lookup, a module constant followed
once. A project configured through `dj_database_url` or `env.db()` says it in
a URL the tree does not hold, and that is "" rather than a guess.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from typing import List, Optional, Tuple

from celery_conf import follow, settings_module_name, str_value
from source import Project, assigned, const_str

# Django's own backends and the common third-party ones, to the catalog's kinds.
ENGINES = {
    "django.db.backends.postgresql": "postgres",
    "django.db.backends.postgresql_psycopg2": "postgres",
    "django.contrib.gis.db.backends.postgis": "postgres",
    "django.db.backends.mysql": "mysql",
    "mysql.connector.django": "mysql",
    "django.db.backends.sqlite3": "sqlite",
    "django.contrib.gis.db.backends.spatialite": "sqlite",
    "django.db.backends.oracle": "other",
    "django_cockroachdb": "postgres",
    "psqlextra.backend": "postgres",
    "clickhouse_backend": "clickhouse",
    "djongo": "mongodb",
}


@dataclass(frozen=True)
class Database:
    """One statically readable entry in Django's ``DATABASES`` setting."""

    alias: str
    engine: str
    name: str
    kind: str


def databases_of(project: Project, settings: str) -> List[Database]:
    """Every database alias whose configuration is a dictionary in source.

    Values are deliberately limited to strings the existing static settings
    reader can prove: literals, module constants and environment lookups with
    literal defaults. No Django code is imported or executed.
    """
    module = project.module(settings or settings_module_name(project))
    if module is None:
        return []
    databases: Optional[ast.AST] = None
    for name, value, _ in assigned(module.tree):
        if name == "DATABASES":
            databases = follow(value, module)
    if not isinstance(databases, ast.Dict):
        return []

    out: List[Database] = []
    for key, value in zip(databases.keys, databases.values):
        alias = const_str(key) if key is not None else ""
        config = follow(value, module)
        if not alias or not isinstance(config, ast.Dict):
            continue
        engine = ""
        database_name = ""
        for item_key, item_value in zip(config.keys, config.values):
            option = const_str(item_key) if item_key is not None else ""
            if option == "ENGINE":
                engine = str_value(item_value, module)
            elif option == "NAME":
                database_name = str_value(item_value, module)
        kind = ENGINES.get(engine, "other" if engine else "")
        out.append(Database(alias=alias, engine=engine, name=database_name, kind=kind))
    return out


def default_database(project: Project, settings: str) -> Optional[Database]:
    return next((database for database in databases_of(project, settings) if database.alias == "default"), None)


def store_slug(kind: str) -> str:
    """The stable short id used when no manifest store id overrides it."""
    return {"postgres": "pg", "sqlite": "sqlite", "mysql": "mysql"}.get(kind, "db")


def default_auto_field(project: Project, settings: str) -> str:
    """The implicit primary-key field configured by Django settings."""
    module = project.module(settings or settings_module_name(project))
    if module is None:
        return "BigAutoField"
    for name, value, _ in assigned(module.tree):
        if name == "DEFAULT_AUTO_FIELD":
            declared = str_value(value, module).split(".")[-1]
            if declared in ("AutoField", "BigAutoField", "SmallAutoField"):
                return declared
    return "BigAutoField"


def engine_of(project: Project, settings: str) -> str:
    """The engine string of the default database, or "" when the settings
    module is not in the tree or does not spell it as syntax."""
    default = default_database(project, settings)
    return default.engine if default is not None else ""


def store_kind(project: Project, settings: str, declared: str) -> Tuple[str, str, str]:
    """(kind, engine, mismatch): the kind the fragment uses, the engine the
    settings named, and the kind the settings imply when the manifest says
    something else - the manifest wins, and the disagreement is reported."""
    engine = engine_of(project, settings)
    implied = ENGINES.get(engine, "other" if engine else "")
    if declared:
        return declared, engine, implied if implied and implied != declared else ""
    return implied or "postgres", engine, ""
