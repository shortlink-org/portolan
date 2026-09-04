"""Which directories are Django applications.

An application is a package holding `models.py` (or a `models/` package): that
is what Django itself looks for, and it is the smallest claim a project makes
about where one part of the model ends and the next begins. `apps` in the
manifest names them outright for a project that keeps its applications
somewhere this would not look.
"""

from __future__ import annotations

import ast
import os
from dataclasses import dataclass, field
from typing import List, Optional

from source import Module, Project, bases, dotted, read


@dataclass
class App:
    label: str  # the directory's name: "invoices"
    dotted: str  # the package, as an import spells it: "billing.invoices"
    dir: str  # absolute
    rel: str
    models: List[Module] = field(default_factory=list)
    modules: List[Module] = field(default_factory=list)
    readme: str = ""

    def module(self, name: str) -> Optional[Module]:
        """`<app>/<name>.py`, or the `__init__` of `<app>/<name>/`."""
        for m in self.modules:
            if m.dotted in (self.dotted + "." + name, self.dotted + "." + name + ".__init__"):
                return m
        return None

    def package(self, name: str) -> List[Module]:
        """Every module of `<app>/<name>.py` or `<app>/<name>/`."""
        prefix = self.dotted + "." + name
        return [m for m in self.modules if m.dotted == prefix or m.dotted.startswith(prefix + ".")]


def discover(project: Project, named: List[str]) -> List[App]:
    """The applications, in path order. A name in `apps` is a package, so
    `billing.invoices` and `invoices` are both accepted."""
    packages = []
    if named:
        for name in named:
            packages.append(name)
    else:
        for dotted_name in sorted(project.modules):
            if dotted_name.endswith(".models"):
                packages.append(dotted_name[: -len(".models")])
            elif dotted_name.endswith(".models.__init__"):
                packages.append(dotted_name[: -len(".models.__init__")])
    out = []
    seen = set()
    for package in packages:
        if package in seen or not package:
            continue
        seen.add(package)
        app = build(project, package)
        if app is not None:
            out.append(app)
    return sorted(out, key=lambda a: a.rel)


def build(project: Project, package: str) -> Optional[App]:
    directory = os.path.join(project.source, *package.split("."))
    if not os.path.isdir(directory):
        return None
    app = App(label=package.split(".")[-1], dotted=package, dir=directory, rel=project.rel(directory))
    app.modules = project.under(package)
    app.models = [m for m in app.modules if m.dotted in (package + ".models", package + ".models.__init__") or m.dotted.startswith(package + ".models.")]
    readme = os.path.join(directory, "README.md")
    if os.path.isfile(readme):
        app.readme = read(readme).strip()
    return app


def is_config(node) -> bool:
    """A class in `apps.py` deriving from AppConfig."""
    return any(base.split(".")[-1] == "AppConfig" for base in bases(node))


def label_of(app: App) -> str:
    """The label Django would use for the application: `AppConfig.label` when
    one is set, the package's last segment otherwise. It is half of every
    default table name, which is why it is read rather than assumed."""
    module = app.module("apps")
    if module is not None:
        for node in module.classes():
            if not is_config(node):
                continue
            for stmt in node.body:
                if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and dotted(stmt.targets[0]) == "label":
                    value = stmt.value
                    if isinstance(value, ast.Constant) and isinstance(value.value, str):
                        return value.value
    return app.label
