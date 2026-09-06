"""What the manifest tells the extractor: the things a tree with Celery in it
does not say about the estate it belongs to."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from protocol import read_options


@dataclass
class Options:
    context: str = ""
    service: str = ""
    source: str = "."
    settings: str = ""
    out: str = "celery.json"

    # The option as the manifest spells it, against the field that holds it.
    KEYS = {
        "context": "context",
        "service": "service",
        "source": "source",
        "settings": "settings",
        "out": "out",
    }

    @staticmethod
    def of(raw: Any) -> "Options":
        return read_options(Options(), Options.KEYS, raw)
