"""portolan-extract-django: a Django service in, a catalog fragment out.

The same protocol as every other extractor: one JSON request on stdin, one JSON
response on stdout, and a `describe` that answers with what the plugin is and
what it can be told. Python 3.9 or newer, and nothing but the standard library:
a plugin that needed the project's own dependencies installed could not be run
over somebody else's checkout.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from extract import extract  # noqa: E402
from protocol import Builder, Input, Options  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))

DESCRIPTOR = {
    "name": "extract-django",
    "summary": "Reads a Django service by its applications - models, events, services, DRF views, receivers, clients - into a catalog fragment, and its models into the store they are the schema of.",
    "phases": ["extract"],
}


def descriptor():
    with open(os.path.join(HERE, "options.schema.json"), "r", encoding="utf-8") as handle:
        out = dict(DESCRIPTOR)
        out["options"] = json.load(handle)
        return out


def serve(raw: str) -> str:
    request = json.loads(raw)
    if request.get("kind") == "describe":
        return json.dumps({"files": [], "diagnostics": [], "describe": descriptor()})
    input_ = Input.of(request.get("input"))
    if not input_.root:
        raise ValueError("no input root: an extractor has nothing to read")
    builder = Builder()
    extract(input_, Options.of(request.get("options")), builder)
    return json.dumps(builder.response(), indent=2)


def main() -> int:
    try:
        sys.stdout.write(serve(sys.stdin.read()))
    except Exception as err:  # the host reads a non-zero exit and the message
        sys.stderr.write("portolan-extract-django: %s\n" % err)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
