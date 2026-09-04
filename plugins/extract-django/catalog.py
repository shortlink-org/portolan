"""The shapes of a fragment, in the order `catalog/model.go` declares them.

A mirror, not a second definition: `src/catalog.ts` is where the shape is
decided. Building the JSON here rather than at each call site is what keeps the
key order - and so the diff of a regenerated fragment - stable.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

DECLARED = "declared"
UNRESOLVED = "unresolved"


def field(name: str, type_: str, doc: str = "", ref: str = "") -> Dict[str, Any]:
    out = {"name": name, "type": type_, "doc": doc}
    if ref:
        out["ref"] = ref
    return out


def block(id_: str, slug: str, name: str, doc: str, fields: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {"id": id_, "slug": slug, "name": name, "doc": doc, "fields": fields}


def event(id_: str, slug: str, name: str, versions: List[Dict[str, Any]], wire: Optional[Dict[str, str]]) -> Dict[str, Any]:
    out: Dict[str, Any] = {"id": id_, "slug": slug, "name": name, "versions": versions, "consumers": []}
    if wire:
        out["wire"] = wire
    return out


def version(doc: str, source: str, fields: List[Dict[str, Any]], name: str = "v1") -> Dict[str, Any]:
    return {"version": name, "doc": doc, "source": source, "fields": fields}


def operation(id_: str, kind: str, doc: str = "", exposed_by: Optional[List[str]] = None) -> Dict[str, Any]:
    out: Dict[str, Any] = {"id": id_, "kind": kind}
    if doc:
        out["doc"] = doc
    if exposed_by:
        out["exposedBy"] = sorted(exposed_by)
    return out


def aggregate(id_: str, slug: str, name: str, readme: str, root: str) -> Dict[str, Any]:
    return {
        "id": id_,
        "slug": slug,
        "name": name,
        "readme": readme,
        "root": root,
        "entities": [],
        "valueObjects": [],
        "operations": [],
        "events": [],
    }


def transition(from_: str, to: str, on: str, emits: str, source: str) -> Dict[str, Any]:
    out = {"from": from_, "to": to, "on": on}
    if emits:
        out["emits"] = emits
    if source:
        out["source"] = source
    return out


def rpc_call(id_: str, peer: str, status: str, source: str, note: str = "") -> Dict[str, Any]:
    out = {"id": id_, "peer": peer, "status": status, "source": source}
    if note:
        out["note"] = note
    return out


def participant(id_: str, kind: str, context: Optional[str], label: str = "") -> Dict[str, Any]:
    out: Dict[str, Any] = {"id": id_, "kind": kind, "context": context}
    if label:
        out["label"] = label
    return out


def step(id_: str, from_: str, to: str, kind: str, label: str, status: str, ref: str = "", note: str = "", line: str = "") -> Dict[str, Any]:
    out: Dict[str, Any] = {"type": "step", "id": id_, "from": from_, "to": to, "kind": kind}
    if label:
        out["label"] = label
    out["status"] = status
    if ref:
        out["ref"] = ref
    if note:
        out["note"] = note
    if line:
        out["line"] = line
    return out


def alt(id_: str, branches: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {"type": "alt", "id": id_, "branches": branches}


def branch(title: str, steps: List[Dict[str, Any]], terminal: bool = False) -> Dict[str, Any]:
    out: Dict[str, Any] = {"title": title, "steps": steps}
    if terminal:
        out["terminal"] = True
    return out


def flow(id_: str, slug: str, name: str, summary: str, source: str, owner: str, participants: List[Dict[str, Any]], steps: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "id": id_,
        "slug": slug,
        "name": name,
        "summary": summary,
        "source": source,
        "owner": owner,
        "participants": participants,
        "steps": steps,
    }


def column(name: str, type_: str, nullable: bool, pk: bool = False, fk: Optional[Dict[str, str]] = None, maps: str = "", doc: str = "") -> Dict[str, Any]:
    out: Dict[str, Any] = {"name": name, "type": type_, "nullable": nullable}
    if pk:
        out["pk"] = True
    if fk:
        out["fk"] = fk
    if maps:
        out["maps"] = maps
    if doc:
        out["doc"] = doc
    return out


def table(id_: str, name: str, columns: List[Dict[str, Any]], indexes: List[Dict[str, Any]], persists: Optional[Dict[str, str]], role: str, doc: str = "") -> Dict[str, Any]:
    out: Dict[str, Any] = {"id": id_, "name": name}
    if doc:
        out["doc"] = doc
    out["columns"] = columns
    if indexes:
        out["indexes"] = indexes
    if persists:
        out["persists"] = persists
    if role:
        out["role"] = role
    return out


def store(id_: str, slug: str, name: str, kind: str, owner: str, tables: List[Dict[str, Any]], source: str) -> Dict[str, Any]:
    out = {"id": id_, "slug": slug, "name": name, "kind": kind, "owner": owner, "tables": tables}
    if source:
        out["source"] = source
    return out
