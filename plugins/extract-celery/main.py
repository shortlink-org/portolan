"""portolan-extract-celery: a tree with Celery in it in, work queues and job
flows out.

The same protocol as every other extractor: one JSON request on stdin, one
JSON response on stdout, and a `describe` that answers with what the plugin is
and what it can be told. Python 3.9 or newer, and nothing but the standard
library: the project is never imported, and neither is Celery.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(1, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pyplugin"))

from extract import extract  # noqa: E402
from options import Options  # noqa: E402
from protocol import Builder, Input  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))

DESCRIPTOR = {
    "name": "extract-celery",
    "summary": "Reads Celery task declarations, the calls that enqueue them and the routes that place them into work queues and source-backed job flows.",
    "category": "messaging",
    "phases": ["extract"],
}


def descriptor():
    with open(os.path.join(HERE, "options.schema.json"), "r", encoding="utf-8") as handle:
        out = dict(DESCRIPTOR)
        out["options"] = json.load(handle)
        return out


def serve(raw: str) -> str:
    request = json.loads(raw)
    version = request.get("portolanVersion", "")
    if version and version != "0.1.0":
        raise ValueError("unsupported portolan protocol %r (plugin supports 0.1.0)" % version)
    if request.get("kind") == "describe":
        return json.dumps({"files": [], "describe": descriptor()})
    input_ = Input.of(request.get("input"))
    if not input_.root:
        raise ValueError("no input root: an extractor has nothing to read")
    builder = Builder()
    extract(input_, Options.of(request.get("options")), builder)
    for warning in builder.warnings:
        sys.stderr.write("warning: %s%s\n" % ((warning.ref + ": ") if warning.ref else "", warning.message))
    return json.dumps(builder.response(), indent=2)


def main() -> int:
    try:
        sys.stdout.write(serve(sys.stdin.read()))
    except Exception as err:  # the host reads a non-zero exit and the message
        sys.stderr.write("portolan-extract-celery: %s\n" % err)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
