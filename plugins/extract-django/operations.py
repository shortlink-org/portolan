"""What somebody can ask the service to do.

`<app>/services.py` - the module a Django project keeps its use cases in once
they outgrow the view - holds one function per scenario, and each is an
operation of the application's aggregate. It is a command when it writes and a
query when it does not, which is read off the calls it makes rather than off
its name.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from typing import Dict, List, Optional

import catalog
from apps import App
from domain import Aggregate
from ids import camel
from source import Module, doc, dotted

# The same core port-write vocabulary as the Go, TS, Rust and Java extractors.
PORT_WRITES = {
    "save",
    "delete",
    "create",
    "update",
    "publish",
    "remove",
    "insert",
    "upsert",
}

# Django adds explicit ORM and signal mutations; these are framework syntax,
# not a competing definition of command/query.
FRAMEWORK_WRITES = {
    "get_or_create",
    "update_or_create",
    "bulk_create",
    "bulk_update",
    "add",
    "set",
    "send",
    "send_robust",
}
WRITES = PORT_WRITES | FRAMEWORK_WRITES


@dataclass
class UseCase:
    name: str  # issue_invoice
    id: str  # IssueInvoice
    node: ast.AST
    module: Module
    app: App
    doc: str
    kind: str

    @property
    def key(self) -> str:
        return self.module.dotted + "." + self.name


def writes(node: ast.AST) -> bool:
    for child in ast.walk(node):
        if isinstance(child, ast.Call):
            name = dotted(child.func)
            if name.split(".")[-1] in WRITES:
                return True
    return False


def read_use_cases(agg: Aggregate, b) -> List[UseCase]:
    out = []
    for module in agg.app.package("services"):
        for node in module.functions():
            if node.name.startswith("_"):
                continue
            out.append(
                UseCase(
                    name=node.name,
                    id=camel(node.name),
                    node=node,
                    module=module,
                    app=agg.app,
                    doc=doc(node),
                    kind="command" if writes(node) else "query",
                )
            )
    if not out:
        b.warn(agg.id, "no services module under %s: the aggregate has no operations, only whatever the views do inline" % agg.app.rel)
    return sorted(out, key=lambda u: u.id)


def operation(use_case: UseCase, exposed_by: Optional[List[str]] = None) -> Dict[str, object]:
    return catalog.operation(use_case.id, use_case.kind, use_case.doc, exposed_by)
