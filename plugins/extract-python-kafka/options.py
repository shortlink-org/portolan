"""Manifest facts for the framework-independent Python Kafka extractor."""

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
    out: str = "kafka.json"

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
