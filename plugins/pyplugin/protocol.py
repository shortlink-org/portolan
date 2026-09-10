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

from dataclasses import dataclass
from typing import Any, Dict, List


@dataclass
class Input:
    """Where the source is."""

    root: str = ""
    output: str = ""

    @staticmethod
    def of(raw: Any) -> "Input":
        raw = raw or {}
        return Input(
            root=raw.get("root", ""),
            output=raw.get("output", ""),
        )


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
