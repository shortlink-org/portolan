"""The document a client is vendored beside, and the names it gives.

The same rules as `plugins/openapi/ids.go`, spelled a second time so that a
Django caller and the service that answers spell one call the same way:
`auth.v1.Sessions/validateSession` on both sides, or the call would never
resolve to the method.

The reader underneath is a small one. A document is a mapping of mappings with
the odd sequence, and the parts read here - the title, the version, the paths,
each operation's id and first tag - need no more than that. Anything it cannot
make sense of is left out rather than guessed at, and a client whose document
answers nothing is reported.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

VERBS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"]


def api_id(title: str, version: str) -> str:
    """The document's title and major version: `auth` 1.0.0 gives `auth.v1`."""
    name = (title or "api").lower().replace(" ", "-")
    major = version.split(".")[0] if version else ""
    return name + ".v" + major if major else name


def title_of(name: str) -> str:
    """users becomes Users, price_list becomes PriceList: it sits in an id
    beside a proto-shaped service name."""
    out = ""
    for word in re.split(r"[_\-\s]+", name):
        if word:
            out += word[0].upper() + word[1:]
    return out


def interface_id(api: str, tag: str) -> str:
    return api + "." + title_of(tag) if tag else api


@dataclass
class Operation:
    id: str
    tag: str
    verb: str
    path: str

    def interface(self, api: str) -> str:
        return interface_id(api, self.tag)

    def call_id(self, api: str) -> str:
        return self.interface(api) + "/" + self.id


@dataclass
class Spec:
    api: str
    path: str
    operations: List[Operation] = field(default_factory=list)

    def find(self, verb: str, route: str) -> Optional[Operation]:
        """Both sides may spell a parameter differently - `{invoiceId}` in the
        document, `{id}` or an f-string hole in the code - so parameters are
        compared by position, not by name."""
        want = verb.upper() + " " + shape(route)
        for op in self.operations:
            if op.verb + " " + shape(op.path) == want:
                return op
        return None


def shape(path: str) -> str:
    out = ""
    for segment in path.rstrip("/").split("/"):
        if segment.startswith("{") or segment in ("%s", "%v", "%d", "*"):
            out += "/*"
        else:
            out += "/" + segment
    return out


def read(path: str) -> Optional[Spec]:
    with open(path, "r", encoding="utf-8") as handle:
        text = handle.read()
    if path.endswith(".json"):
        try:
            doc = json.loads(text)
        except ValueError:
            return None
    else:
        doc = parse(text)
    if not isinstance(doc, dict):
        return None
    info = doc.get("info") or {}
    spec = Spec(api=api_id(str(info.get("title", "")), str(info.get("version", ""))), path=path)
    paths = doc.get("paths") or {}
    if not isinstance(paths, dict):
        return spec
    for route, entry in paths.items():
        if not isinstance(entry, dict):
            continue
        for verb in VERBS:
            operation = entry.get(verb)
            if not isinstance(operation, dict):
                continue
            tags = operation.get("tags") or []
            tag = str(tags[0]) if isinstance(tags, list) and tags else ""
            spec.operations.append(
                Operation(id=str(operation.get("operationId") or (verb.upper() + " " + route)), tag=tag, verb=verb.upper(), path=route)
            )
    return spec


def beside(directory: str) -> Optional[str]:
    """The document vendored next to a client: any .yaml, .yml or .json in the
    directory, the first by name so two of them do not make the fragment move."""
    if not os.path.isdir(directory):
        return None
    for name in sorted(os.listdir(directory)):
        if name.endswith((".yaml", ".yml", ".json")) and os.path.isfile(os.path.join(directory, name)):
            return os.path.join(directory, name)
    return None


# --- the small reader -------------------------------------------------------


def parse(text: str) -> Any:
    lines = []
    for raw in text.split("\n"):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        lines.append((len(raw) - len(raw.lstrip(" ")), raw.strip()))
    return Reader(lines).block(lines[0][0] if lines else 0)


class Reader:
    """A cursor over (indent, text) lines. Every branch advances it, so a
    document it cannot make sense of ends the read rather than hanging it."""

    def __init__(self, lines):
        self.lines = lines
        self.at = 0

    def peek(self):
        return self.lines[self.at] if self.at < len(self.lines) else None

    def block(self, indent: int) -> Any:
        node = self.peek()
        if node is None or node[0] < indent:
            return ""
        return self.sequence(indent) if node[1].startswith("- ") else self.mapping(indent)

    def mapping(self, indent: int) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        while True:
            node = self.peek()
            if node is None or node[0] < indent:
                break
            own, line = node
            if own > indent:  # deeper than anything here claims: not ours to read
                self.at += 1
                continue
            if line.startswith("- "):
                break
            key, sep, rest = line.partition(":")
            self.at += 1
            if not sep:
                continue
            key = str(scalar(key.strip()))
            rest = rest.strip()
            if rest in ("|", ">", "|-", ">-", "|+", ">+"):
                self.skip(own)
                out[key] = ""
            elif rest:
                out[key] = scalar(rest)
            else:
                nxt = self.peek()
                if nxt is not None and nxt[0] > own:
                    out[key] = self.block(nxt[0])
                elif nxt is not None and nxt[0] == own and nxt[1].startswith("- "):
                    out[key] = self.sequence(own)
                else:
                    out[key] = ""
        return out

    def sequence(self, indent: int) -> List[Any]:
        out: List[Any] = []
        while True:
            node = self.peek()
            if node is None or node[0] != indent or not node[1].startswith("- "):
                break
            self.at += 1
            rest = node[1][2:].strip()
            if ":" in rest and not rest.startswith(("[", "{", chr(34), "'")):
                key, _, value = rest.partition(":")
                out.append({str(scalar(key.strip())): scalar(value.strip())})
                self.skip(indent)
            elif rest:
                out.append(scalar(rest))
            else:
                nxt = self.peek()
                out.append(self.block(nxt[0]) if nxt is not None and nxt[0] > indent else "")
        return out

    def skip(self, indent: int) -> None:
        """Everything nested under the line just read."""
        while True:
            node = self.peek()
            if node is None or node[0] <= indent:
                return
            self.at += 1


def scalar(text: str) -> Any:
    text = text.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        return text[1:-1]
    if text.startswith("[") and text.endswith("]"):
        return [scalar(item) for item in text[1:-1].split(",") if item.strip()]
    if text.startswith("{") and text.endswith("}"):
        return {}
    return text
