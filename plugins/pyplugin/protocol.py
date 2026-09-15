"""The plugin protocol, as `plugin/protocol.go` spells it: one JSON request on
stdin, one JSON response on stdout, and a `describe` that answers with what the
plugin is and what it can be told. Shared by every Python plugin under
`plugins/`, the way `plugin/` is shared by the Go ones; each plugin keeps its
own options dataclass and hands it to `read_options`.

Nothing here reads the environment or the clock. Every fact about the estate
arrives in the request, which is what lets the same tree produce the same
fragment on any machine.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Dict, List


@dataclass
class Input:
    """Where the source is.

    `repository` is where the repository `root` belongs to begins, relative to
    the working directory like `root`: the directory a fetched copy was written
    to, when the root lies inside one, and empty when the workspace is the
    repository. The catalog spells a path from the repository the file lives
    in, because that is what a source link opens on the forge.
    """

    root: str = ""
    output: str = ""
    repository: str = ""

    @staticmethod
    def of(raw: Any) -> "Input":
        raw = raw or {}
        return Input(
            root=raw.get("root", ""),
            output=raw.get("output", ""),
            repository=raw.get("repository", ""),
        )

    def repository_path(self, path: str, cwd: str) -> str:
        """An absolute path as the catalog writes it: from the working
        directory, forward slashes, and from the fetched copy's repository when
        it lies inside one - `vendor/repos/acme/shop/geo/views.py` is
        `geo/views.py`, and the copy's own directory is ""."""
        workspace = os.path.relpath(path, cwd).replace(os.sep, "/")
        repository = self.repository.strip("/")
        if not repository or repository == ".":
            return workspace
        if workspace == repository:
            return ""
        if workspace.startswith(repository + "/"):
            return workspace[len(repository) + 1 :]
        return workspace


def read_options(opts: Any, keys: Dict[str, str], raw: Any) -> Any:
    """Fills an options dataclass from what the manifest sent: `keys` is the
    option as the manifest spells it against the field that holds it. A key
    that is not there is refused rather than dropped, the way
    `deny_unknown_fields` refuses one in the Rust extractor: an option nobody
    reads is a page that comes out blank with nothing saying why."""
    raw = raw or {}
    for key, value in raw.items():
        attr = keys.get(key)
        if attr is None:
            raise ValueError("unknown option %r" % key)
        setattr(opts, attr, value)
    return opts


@dataclass
class File:
    name: str
    contents: str


@dataclass
class Warning:
    severity: str
    message: str
    ref: str


class Builder:
    """Collects output files and internal extraction warnings."""

    def __init__(self) -> None:
        self.files: List[File] = []
        self.warnings: List[Warning] = []

    def warn(self, ref: str, message: str) -> None:
        self.warnings.append(Warning("warning", message, ref))

    def response(self) -> Dict[str, Any]:
        return {
            "files": [{"name": f.name, "contents": f.contents} for f in self.files],
        }
