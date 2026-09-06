"""How a name in the source becomes an id in the catalog.

The spelling itself lives in `pyplugin/names.py`, shared with every Python
plugin; what is here is the Django half - the plural an application is named
in, and the ids the fragment composes.
"""

from __future__ import annotations

from names import camel, slug, title  # noqa: F401


def pascal(name: str) -> str:
    """A directory name in PascalCase, which is what its root model is called."""
    return camel(name)


def singular(name: str) -> str:
    """invoices -> invoice: a Django app is named for many of the thing it holds."""
    if name.endswith("ies") and len(name) > 3:
        return name[:-3] + "y"
    if name.endswith("sses") or name.endswith("shes") or name.endswith("ches") or name.endswith("xes"):
        return name[:-2]
    if name.endswith("s") and not name.endswith("ss"):
        return name[:-1]
    return name


def service_id(context: str, service: str) -> str:
    return context + "." + service


def aggregate_id(service: str, aggregate: str) -> str:
    return service + "." + aggregate


def block_id(aggregate: str, block: str) -> str:
    return aggregate + "." + block


def event_id(aggregate: str, name: str) -> str:
    return aggregate + "." + name
