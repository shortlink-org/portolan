"""The tree, read as syntax.

The project is never imported: `django.setup()` runs the code it finds, reads
the environment and opens sockets, and an extractor that does any of those is
no longer a pure function of the tree. Everything here is `ast`, and names are
resolved by import and by file, the way `extract-ts` resolves them without a
type checker.
"""

from __future__ import annotations

import ast
import os
from dataclasses import dataclass, field
from typing import Dict, Iterator, List, Optional, Tuple

# Directories that hold no claim about the model: someone else's code, a build,
# a history of the schema rather than the schema, and the tests.
SKIP = {
    ".git",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".tox",
    ".venv",
    "__pycache__",
    "build",
    "dist",
    "env",
    "migrations",
    "node_modules",
    "site-packages",
    "static",
    "templates",
    "tests",
    "venv",
}


@dataclass
class Import:
    """A name a module can see, and where it came from."""

    module: str  # dotted, as the project spells it: "invoices.events"
    name: str  # the name in that module, "*" for `import x`
    line: int = 0


@dataclass
class Module:
    path: str  # absolute
    rel: str  # relative to the working directory, forward slashes
    dotted: str  # "invoices.models"
    tree: ast.Module
    imports: Dict[str, Import] = field(default_factory=dict)

    @property
    def package(self) -> str:
        return self.dotted.rsplit(".", 1)[0] if "." in self.dotted else ""

    def where(self, node: ast.AST) -> str:
        return "%s:%d" % (self.rel, getattr(node, "lineno", 0))

    def classes(self) -> List[ast.ClassDef]:
        return [n for n in self.tree.body if isinstance(n, ast.ClassDef)]

    def functions(self) -> List[ast.FunctionDef]:
        return [n for n in self.tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]


class Project:
    """Every module under the source root, by its dotted name."""

    def __init__(self, root: str, source: str, rel):
        self.root = root
        self.source = source
        self.rel = rel
        self.modules: Dict[str, Module] = {}
        self.broken: List[Tuple[str, str]] = []
        self._load()

    def _load(self) -> None:
        for path in walk(self.source):
            dotted = dotted_name(self.source, path)
            try:
                tree = ast.parse(read(path), filename=path)
            except SyntaxError as err:
                self.broken.append((self.rel(path), str(err)))
                continue
            module = Module(path=path, rel=self.rel(path), dotted=dotted, tree=tree)
            module.imports = read_imports(module)
            self.modules[dotted] = module

    def module(self, dotted: str) -> Optional[Module]:
        hit = self.modules.get(dotted)
        if hit is not None:
            return hit
        return self.modules.get(dotted + ".__init__")

    def under(self, package: str) -> List[Module]:
        """Every module of a package, the package's own `__init__` included, in
        path order so the fragment does not move when a directory is re-read."""
        prefix = package + "."
        out = [m for name, m in self.modules.items() if name == package or name.startswith(prefix)]
        return sorted(out, key=lambda m: m.rel)

    def resolve(self, module: Module, name: str) -> Optional[Tuple[Module, str]]:
        """The module a name in this one came from, and what it is called
        there. A name defined here resolves to here."""
        imported = module.imports.get(name)
        if imported is None:
            if any(node_name(n) == name for n in module.tree.body):
                return module, name
            return None
        target = self.module(imported.module)
        if target is None:
            return None
        if imported.name == "*":
            return target, name
        return target, imported.name


def walk(root: str) -> Iterator[str]:
    """Every .py file under a directory, in a stable order."""
    for base, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in SKIP and not d.startswith("."))
        for name in sorted(files):
            if name.endswith(".py"):
                yield os.path.join(base, name)


def read(path: str) -> str:
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def dotted_name(source: str, path: str) -> str:
    rel = os.path.relpath(path, source)
    rel = rel.replace(os.sep, "/")
    if rel.endswith(".py"):
        rel = rel[: -len(".py")]
    return rel.replace("/", ".")


def read_imports(module: Module) -> Dict[str, Import]:
    """What each name in a module refers to. A relative import is resolved
    against the module's own package, which is how `from .events import X`
    finds the file beside it."""
    out: Dict[str, Import] = {}
    for node in ast.walk(module.tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                out[alias.asname or alias.name.split(".")[0]] = Import(alias.name, "*", node.lineno)
        elif isinstance(node, ast.ImportFrom):
            base = node.module or ""
            if node.level:
                parts = module.dotted.split(".")
                # A package's __init__ is one level shallower than its path says.
                if parts and parts[-1] == "__init__":
                    parts = parts[:-1]
                parts = parts[: len(parts) - node.level]
                base = ".".join([p for p in parts if p] + ([base] if base else []))
            for alias in node.names:
                out[alias.asname or alias.name] = Import(base, alias.name, node.lineno)
    return out


def node_name(node: ast.AST) -> str:
    if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
        return node.name
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        return node.targets[0].id
    if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
        return node.target.id
    return ""


def dotted(node: ast.AST) -> str:
    """`models.CharField` for an attribute chain, `Invoice` for a name, "" for
    anything else."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = dotted(node.value)
        return base + "." + node.attr if base else node.attr
    if isinstance(node, ast.Call):
        return dotted(node.func)
    return ""


def const_str(node: Optional[ast.AST]) -> str:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return ""


def keyword(call: ast.Call, name: str) -> Optional[ast.AST]:
    for kw in call.keywords:
        if kw.arg == name:
            return kw.value
    return None


def keyword_str(call: ast.Call, name: str) -> str:
    return const_str(keyword(call, name))


def keyword_bool(call: ast.Call, name: str) -> bool:
    value = keyword(call, name)
    return isinstance(value, ast.Constant) and value.value is True


def keyword_int(call: ast.Call, name: str) -> Optional[int]:
    value = keyword(call, name)
    if isinstance(value, ast.Constant) and isinstance(value.value, int) and not isinstance(value.value, bool):
        return value.value
    return None


def doc(node: ast.AST) -> str:
    """The docstring, first paragraph only: the rest is for whoever opens the
    file, and a page wants the sentence."""
    if not isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
        return ""
    text = ast.get_docstring(node, clean=True) or ""
    return text.split("\n\n")[0].strip().replace("\n", " ")


def type_of(node: Optional[ast.AST]) -> str:
    """An annotation as written. `Optional[Money]` stays `Optional[Money]`: the
    catalog keeps types the way the author declared them."""
    if node is None:
        return ""
    try:
        return ast.unparse(node)  # type: ignore[attr-defined]
    except Exception:
        return dotted(node)


def bases(node: ast.ClassDef) -> List[str]:
    return [dotted(b) for b in node.bases]


def decorators(node: ast.AST) -> List[ast.AST]:
    return list(getattr(node, "decorator_list", []) or [])


def decorator_named(node: ast.AST, *names: str) -> Optional[ast.AST]:
    """The decorator whose last segment is one of these: `@action`, `@receiver`,
    `@transition`, however it was imported."""
    for dec in decorators(node):
        if dotted(dec).split(".")[-1] in names:
            return dec
    return None


def assigned(node: ast.AST) -> List[Tuple[str, ast.AST, ast.AST]]:
    """(name, value, node) for each simple assignment in a class or module body."""
    out = []
    for stmt in getattr(node, "body", []) or []:
        if isinstance(stmt, ast.Assign):
            for target in stmt.targets:
                if isinstance(target, ast.Name):
                    out.append((target.id, stmt.value, stmt))
        elif isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name) and stmt.value is not None:
            out.append((stmt.target.id, stmt.value, stmt))
    return out


def methods(node: ast.ClassDef) -> List[ast.AST]:
    return [n for n in node.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]


def method(node: ast.ClassDef, name: str) -> Optional[ast.AST]:
    for m in methods(node):
        if m.name == name:
            return m
    return None


def inner_class(node: ast.ClassDef, name: str) -> Optional[ast.ClassDef]:
    for stmt in node.body:
        if isinstance(stmt, ast.ClassDef) and stmt.name == name:
            return stmt
    return None
