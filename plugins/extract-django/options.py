"""What the manifest tells the extractor: the things a Django project does
not say about the estate it belongs to."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List

from protocol import read_options


@dataclass
class Options:
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

    # The option as the manifest spells it, against the field that holds it.
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
        return read_options(Options(), Options.KEYS, raw)
