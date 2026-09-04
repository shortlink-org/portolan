"""The plugin protocol, as `plugin/protocol.go` spells it: one JSON request on
stdin, one JSON response on stdout, and a `describe` that answers with what the
plugin is and what it can be told.

Nothing here reads the environment or the clock. Every fact about the estate
arrives in the request, which is what lets the same tree produce the same
fragment on any machine.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List


@dataclass
class Input:
    """Where the source is, and the stamp the host put on this run."""

    root: str = ""
    commit: str = ""
    generated_at: str = ""

    @staticmethod
    def of(raw: Any) -> "Input":
        raw = raw or {}
        return Input(root=raw.get("root", ""), commit=raw.get("commit", ""), generated_at=raw.get("generatedAt", ""))


@dataclass
class Options:
    """What the manifest tells the extractor: the things a Django project does
    not say about the estate it belongs to."""

    context: str = ""
    context_name: str = ""
    context_summary: str = ""
    classification: str = ""
    service: str = ""
    service_name: str = ""
    repo: str = ""
    store: str = ""
    store_name: str = ""
    store_kind: str = "postgres"
    apps: List[str] = field(default_factory=list)
    aggregates: Dict[str, str] = field(default_factory=dict)
    peers: Dict[str, str] = field(default_factory=dict)
    events: Dict[str, str] = field(default_factory=dict)
    source: str = "."
    out: str = "domain.json"
    stores_out: str = "stores.json"

    # The option as the manifest spells it, against the field that holds it. A
    # key that is not here is refused rather than dropped, the way
    # `deny_unknown_fields` refuses one in the Rust extractor: an option nobody
    # reads is a page that comes out blank with nothing saying why.
    KEYS = {
        "context": "context",
        "contextName": "context_name",
        "contextSummary": "context_summary",
        "classification": "classification",
        "service": "service",
        "serviceName": "service_name",
        "repo": "repo",
        "store": "store",
        "storeName": "store_name",
        "storeKind": "store_kind",
        "apps": "apps",
        "aggregates": "aggregates",
        "peers": "peers",
        "events": "events",
        "source": "source",
        "out": "out",
        "storesOut": "stores_out",
    }

    @staticmethod
    def of(raw: Any) -> "Options":
        raw = raw or {}
        opts = Options()
        for key, value in raw.items():
            attr = Options.KEYS.get(key)
            if attr is None:
                raise ValueError("unknown option %r" % key)
            setattr(opts, attr, value)
        return opts


@dataclass
class File:
    name: str
    contents: str


@dataclass
class Diagnostic:
    severity: str
    message: str
    ref: str


class Builder:
    """Collects what the run produces: the fragments, and every diagnostic
    beside them. Reported, never papered over inside the output."""

    def __init__(self) -> None:
        self.files: List[File] = []
        self.diagnostics: List[Diagnostic] = []

    def warn(self, ref: str, message: str) -> None:
        self.diagnostics.append(Diagnostic("warning", message, ref))

    def response(self) -> Dict[str, Any]:
        return {
            "files": [{"name": f.name, "contents": f.contents} for f in self.files],
            "diagnostics": [{"severity": d.severity, "message": d.message, "ref": d.ref} for d in self.diagnostics],
        }
