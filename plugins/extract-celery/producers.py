"""The calls that put a task on a queue.

`t.delay(...)` and `t.apply_async(...)` are the two ways a task is enqueued,
and `t.s(...).apply_async()` is the same call through a signature. A
`chain`, `group` or `chord` holds several signatures, each of which is an
enqueue and is recorded as one, noted with the canvas it sits in; the order
the canvas imposes is not drawn. `app.send_task("name")` enqueues by wire
name, for a task that may live in another tree. `transaction.on_commit(lambda:
t.delay(...))` - and the `partial` form - is the same enqueue with a note that
it waits for the commit, which is the one fact about *when* a message leaves
that the code states plainly.

Names are resolved by import and by file, so `tasks.send_invoice_email.delay`
and `send_invoice_email.delay` after `from .tasks import send_invoice_email`
land on the same function.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from typing import List, Optional, Tuple

from source import Module, Project, const_str, dotted, keyword, keyword_str
from celery_tasks import package_of

ENQUEUE = ("delay", "apply_async")
SIGNATURE = ("s", "si", "signature", "subtask")
CANVAS = {"chain": "in a chain", "group": "in a group", "chord": "in a chord"}
AFTER_COMMIT = "after the transaction commits"
LATER = "for later, with a countdown or an eta"


@dataclass
class Producer:
    module: Module
    node: ast.Call
    key: Optional[Tuple[str, str]]  # the task's, when the call resolves to one
    wire: str  # the name `send_task` was given, "" otherwise
    label: str  # the callee as written, last segment
    queue: str  # `queue=` at the call, "" when none
    notes: List[str]

    @property
    def line(self) -> str:
        return self.module.where(self.node)


def read_producers(project: Project) -> List[Producer]:
    out: List[Producer] = []
    for module in sorted(project.modules.values(), key=lambda m: m.rel):
        Visitor(project, module, out).visit(module.tree)
    return out


class Visitor(ast.NodeVisitor):
    def __init__(self, project: Project, module: Module, out: List[Producer]):
        self.project = project
        self.module = module
        self.out = out
        self.pending: List[str] = []  # notes the enclosing calls add

    def visit_Call(self, node: ast.Call) -> None:
        name = dotted(node.func)
        last = name.split(".")[-1]
        if last == "on_commit":
            self.pending.append(AFTER_COMMIT)
            self.generic_visit(node)
            self.pending.pop()
            return
        if last == "partial" and node.args and isinstance(node.args[0], ast.Attribute) and node.args[0].attr in ENQUEUE:
            self.enqueue(node.args[0].value, node)
            for arg in node.args[1:]:
                self.visit(arg)
            for kw in node.keywords:
                self.visit(kw.value)
            return
        if last in ENQUEUE and isinstance(node.func, ast.Attribute):
            self.enqueue(node.func.value, node)
            self.generic_visit(node)
            return
        if last == "send_task" and node.args and const_str(node.args[0]):
            wire = const_str(node.args[0])
            self.out.append(Producer(self.module, node, None, wire, wire, keyword_str(node, "queue"), self.notes(node)))
            self.generic_visit(node)
            return
        # A canvas called outright: `chain(a.s(), b.s())()`.
        if isinstance(node.func, ast.Call) and dotted(node.func.func).split(".")[-1] in CANVAS:
            self.enqueue(node.func, node)
            return
        self.generic_visit(node)

    def enqueue(self, receiver: ast.AST, call: ast.Call, extra: str = "") -> None:
        """`receiver` is what `.delay` or `.apply_async` was called on: the task,
        a signature of it, or a canvas of signatures."""
        if isinstance(receiver, ast.Call) and isinstance(receiver.func, ast.Attribute) and receiver.func.attr in SIGNATURE:
            self.record(receiver.func.value, call, extra)
            return
        if isinstance(receiver, ast.Call) and dotted(receiver.func).split(".")[-1] in CANVAS:
            how = CANVAS[dotted(receiver.func).split(".")[-1]]
            for arg in flatten(receiver.args):
                if isinstance(arg, ast.Call):
                    self.enqueue(arg, call, how)
            return
        self.record(receiver, call, extra)

    def record(self, target: ast.AST, call: ast.Call, extra: str) -> None:
        name = dotted(target)
        if not name:
            return
        key = resolve(self.project, self.module, name)
        self.out.append(Producer(self.module, call, key, "", name.split(".")[-1], keyword_str(call, "queue"), self.notes(call, extra)))

    def notes(self, call: ast.Call, extra: str = "") -> List[str]:
        out = list(self.pending)
        if extra:
            out.append(extra)
        if keyword(call, "countdown") is not None or keyword(call, "eta") is not None:
            out.append(LATER)
        return out


def flatten(args: List[ast.AST]) -> List[ast.AST]:
    out: List[ast.AST] = []
    for arg in args:
        if isinstance(arg, ast.Starred):
            arg = arg.value
        if isinstance(arg, (ast.List, ast.Tuple)):
            out += arg.elts
        else:
            out.append(arg)
    return out


def resolve(project: Project, module: Module, name: str) -> Optional[Tuple[str, str]]:
    """`send_invoice_email` through the import that brought it here,
    `tasks.send_invoice_email` through the module import, to (module, function).
    None when the head of the name is nothing this module imported or defined."""
    parts = name.split(".")
    if len(parts) == 1:
        hit = project.resolve(module, name)
        if hit is None:
            return None
        target, local = hit
        return package_of(target), local
    head, rest = parts[0], parts[1:]
    imported = module.imports.get(head)
    if imported is None:
        return None
    if imported.name == "*":
        # `import a.b` binds `a` and is used as `a.b.fn`; `import a.b as z` is `z.fn`.
        base = [head] if imported.module == head or imported.module.startswith(head + ".") else imported.module.split(".")
    else:
        base = imported.module.split(".") + [imported.name]
    full = base + rest
    return ".".join(full[:-1]), full[-1]
