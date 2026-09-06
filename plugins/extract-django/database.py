"""Which database the models are the schema of, read off the settings.

`DATABASES["default"]["ENGINE"]` is the one line a Django project always
has that says what it runs on, and it is read the way the Celery settings are:
a literal, the default of an environment lookup, a module constant followed
once. A project configured through `dj_database_url` or `env.db()` says it in
a URL the tree does not hold, and that is "" rather than a guess.
"""

from __future__ import annotations

import ast
from typing import Optional, Tuple

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
    "clickhouse_backend": "clickhouse",
    "djongo": "mongodb",
}


def engine_of(project: Project, settings: str) -> str:
    """The engine string of the default database, or "" when the settings
    module is not in the tree or does not spell it as syntax."""
    module = project.module(settings or settings_module_name(project))
    if module is None:
        return ""
    databases: Optional[ast.AST] = None
    for name, value, _ in assigned(module.tree):
        if name == "DATABASES":
            databases = follow(value, module)
    if not isinstance(databases, ast.Dict):
        return ""
    default: Optional[ast.AST] = None
    for key, value in zip(databases.keys, databases.values):
        if key is not None and const_str(key) == "default":
            default = follow(value, module)
    if not isinstance(default, ast.Dict):
        return ""
    for key, value in zip(default.keys, default.values):
        if key is not None and const_str(key) == "ENGINE":
            return str_value(value, module)
    return ""


def store_kind(project: Project, settings: str, declared: str) -> Tuple[str, str, str]:
    """(kind, engine, mismatch): the kind the fragment uses, the engine the
    settings named, and the kind the settings imply when the manifest says
    something else - the manifest wins, and the disagreement is reported."""
    engine = engine_of(project, settings)
    implied = ENGINES.get(engine, "other" if engine else "")
    if declared:
        return declared, engine, implied if implied and implied != declared else ""
    return implied or "postgres", engine, ""
