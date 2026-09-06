"""How a name in the source becomes an id in the catalog.

These are the rules `extract-go` lives by and `extract-ts` repeats, spelled
once for every Python plugin, so a Django service and a Go service with the
same aggregate get the same id.
"""

from __future__ import annotations

import re


def slug(name: str) -> str:
    """PriceList -> price-list, Address -> address, ID -> id, email.Address -> email-address."""
    out = []
    chars = list(name)
    for i, c in enumerate(chars):
        upper = "A" <= c <= "Z"
        if upper and i > 0:
            prev = chars[i - 1]
            nxt = chars[i + 1] if i + 1 < len(chars) else ""
            if ("a" <= prev <= "z") or ("a" <= nxt <= "z"):
                out.append("-")
        r = c.lower() if upper else c
        if r in ("_", "."):
            r = "-"
        out.append(r)
    return re.sub("-+", "-", "".join(out)).strip("-")


def camel(name: str) -> str:
    """issue_invoice -> IssueInvoice: the operation id a function name becomes."""
    return "".join(w[0].upper() + w[1:] for w in re.split(r"[_\-]+", name) if w)


def title(name: str) -> str:
    """price_list -> Price List: the human name for a directory."""
    return " ".join(w[0].upper() + w[1:] for w in re.split(r"[_\-]+", name) if w)
