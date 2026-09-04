"""How a name in the source becomes an id in the catalog.

These are the rules `extract-go` lives by and `extract-ts` repeats, spelled the
same a third time, so a Django service and a Go service with the same aggregate
get the same id.
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


def pascal(name: str) -> str:
    """A directory name in PascalCase, which is what its root model is called."""
    return camel(name)


def singular(name: str) -> str:
    """invoices -> invoice: a Django app is named for many of the thing it holds."""
    if name.endswith("ies") and len(name) > 3:
        return name[:-3] + "y"
    if name.endswith("sses") or name.endswith("shes") or name.endswith("ches") or name.endswith("xes"):
        return name[:-2]
    if name.endswith("s") and not name.endswith("ss"):
        return name[:-1]
    return name


def service_id(context: str, service: str) -> str:
    return context + "." + service


def aggregate_id(service: str, aggregate: str) -> str:
    return service + "." + aggregate


def block_id(aggregate: str, block: str) -> str:
    return aggregate + "." + block


def event_id(aggregate: str, name: str) -> str:
    return aggregate + "." + name
