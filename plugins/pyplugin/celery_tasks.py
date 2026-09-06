"""The tasks: every function the tree hands to Celery.

A task is a module-level function decorated `@shared_task`, `@app.task` or
`@<anything>.task`, with or without arguments. Its wire name is the `name=` it
was given, or what Celery composes when it was not: the module's dotted path
and the function's name, `invoices.tasks.send_invoice_email`. A `queue=` on
the decorator is where it goes unless a call says otherwise; the docstring is
what the page says about it. A class-based task is not read.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from typing import Dict, List, Tuple

from source import Module, Project, decorator_named, doc, keyword_str

DECORATORS = ("task", "shared_task")


def package_of(module: Module) -> str:
    """The module as an import spells it: a package's `__init__` is the package."""
    return module.dotted[: -len(".__init__")] if module.dotted.endswith(".__init__") else module.dotted


@dataclass
class Task:
    module: Module
    node: ast.AST
    name: str  # the wire name
    queue: str  # the decorator's, "" when it has none

    @property
    def short(self) -> str:
        return self.node.name  # type: ignore[attr-defined]

    @property
    def key(self) -> Tuple[str, str]:
        return package_of(self.module), self.short

    @property
    def line(self) -> str:
        return self.module.where(self.node)

    @property
    def doc(self) -> str:
        return doc(self.node)


def read_tasks(project: Project) -> List[Task]:
    out = []
    for module in sorted(project.modules.values(), key=lambda m: m.rel):
        for fn in module.functions():
            dec = decorator_named(fn, *DECORATORS)
            if dec is None:
                continue
            name = queue = ""
            if isinstance(dec, ast.Call):
                name = keyword_str(dec, "name")
                queue = keyword_str(dec, "queue")
            out.append(Task(module, fn, name or package_of(module) + "." + fn.name, queue))
    return out


def index(tasks: List[Task]) -> Tuple[Dict[Tuple[str, str], Task], Dict[str, Task]]:
    """By where the function is, for a call on it; by wire name, for
    `send_task`."""
    by_key = {task.key: task for task in tasks}
    by_name = {task.name: task for task in tasks}
    return by_key, by_name
