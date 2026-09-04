"""One Django service in, one fragment out - two, when it keeps a database.

A fragment, not a catalog: it carries one context and one service, names peers
it does not own, and is merged with everything else before anything validates
it.
"""

from __future__ import annotations

import os
import re
from typing import Any, Dict, List

import apps as apps_module
import catalog
import clients as clients_module
import domain
import events as events_module
import flows
import lifecycle
import operations
import store as store_module
import transport
from ids import service_id, title
from protocol import Builder, Input, Options
from source import Project, read


def extract(input_: Input, opts: Options, b: Builder, cwd: str = "") -> None:
    cwd = cwd or os.getcwd()
    root = os.path.abspath(os.path.join(cwd, input_.root))

    def rel(path: str) -> str:
        return os.path.relpath(path, cwd).replace(os.sep, "/")

    source = os.path.normpath(os.path.join(root, opts.source or "."))
    context = opts.context or os.path.basename(root)
    service = opts.service or os.path.basename(root)
    svc_id = service_id(context, service)

    project = Project(root, source, rel)
    for path, message in project.broken:
        b.warn(path, "cannot be parsed, so nothing in it is read: %s" % message)

    applications = apps_module.discover(project, list(opts.apps))
    if not applications:
        b.warn(svc_id, "no Django application under %s: a directory with a models module is what this reads" % rel(source))

    aggregates = domain.read_aggregates(project, applications, svc_id, dict(opts.aggregates), b)

    known_events: Dict[str, Any] = {}
    use_cases: List[operations.UseCase] = []
    endpoints = []
    clients: List[clients_module.Client] = []
    for agg in aggregates:
        found, registry = events_module.read_events(agg, service, b)
        agg.aggregate["events"] = found
        known_events.update(registry)
        use_cases += operations.read_use_cases(agg, b)
        endpoints += [(agg, endpoint) for endpoint in transport.read_endpoints(agg.app, b)]
        clients += clients_module.read_clients(agg.app, dict(opts.peers), rel, b)

    reader = flows.FlowReader(
        flows.Options(context=context, svc_id=svc_id, service=service, store=opts.store, peers=dict(opts.peers), events=dict(opts.events)),
        project,
        aggregates,
        use_cases,
        clients,
        known_events,
        rel,
        b,
    )

    found_flows = []
    exposed: Dict[str, List[str]] = {}
    for agg, endpoint in endpoints:
        flow = reader.endpoint_flow(agg, endpoint)
        if flow is not None:
            found_flows.append(flow)
        for key in endpoint.use_cases:
            exposed.setdefault(key, []).append(endpoint.id)
    for agg in aggregates:
        for module, node, decorator in transport.receivers(agg.app):
            flow = reader.policy_flow(agg, module, node, decorator)
            if flow is not None:
                found_flows.append(flow)

    for agg in aggregates:
        life = lifecycle.read(agg, known_events, b)
        if life is not None:
            agg.aggregate["lifecycle"] = life
        for use_case in use_cases:
            if use_case.app is not agg.app:
                continue
            agg.aggregate["operations"].append(operations.operation(use_case, exposed.get(use_case.key)))
        agg.aggregate["operations"].sort(key=lambda o: o["id"])
        for event in agg.aggregate["events"]:
            if event["id"] not in reader.referenced:
                b.warn(event["id"], "no flow reaches this event: nothing this extractor could follow publishes it")

    readme_path = os.path.join(root, "README.md")
    readme = read(readme_path).strip() if os.path.isfile(readme_path) else ""

    service_obj = {
        "id": svc_id,
        "slug": service,
        "name": opts.service_name or readme_title(readme) or title(service),
        "repo": opts.repo or project_repo(root),
        "path": rel(root),
        "readme": readme,
        "provides": [],
        "consumes": reader.consumes(),
        "aggregates": [agg.aggregate for agg in aggregates],
    }

    fragment = {
        "generatedAt": input_.generated_at,
        "commit": input_.commit,
        "contexts": [
            {
                "id": context,
                "slug": context,
                "name": opts.context_name or title(context),
                "summary": opts.context_summary or "",
                "services": [service_obj],
            }
        ],
        "defs": {},
        "flows": found_flows,
        "adrs": [],
    }
    if opts.classification:
        fragment["contexts"][0]["classification"] = opts.classification
    b.files.append(dump(opts.out or "domain.json", fragment))

    if not opts.store:
        b.warn(svc_id, "no store named in the options, so the models describe no database: `store` is what says which one they are the schema of")
        return
    tables = []
    names = store_module.index(aggregates)
    for agg in aggregates:
        tables += store_module.read(agg, names, svc_id, opts.store, opts.store_kind or "postgres", b)
    store_id = "%s.%s" % (svc_id, opts.store)
    stores_fragment = {
        "generatedAt": input_.generated_at,
        "commit": input_.commit,
        "contexts": [
            {
                "id": context,
                "slug": context,
                "name": "",
                "summary": "",
                "services": [
                    {
                        "id": svc_id,
                        "slug": service,
                        "name": "",
                        "repo": "",
                        "path": "",
                        "readme": "",
                        "provides": [],
                        "consumes": [],
                        "aggregates": [],
                        "stores": [store_id],
                    }
                ],
            }
        ],
        "defs": {},
        "flows": [],
        "adrs": [],
        "stores": [
            catalog.store(
                store_id,
                opts.store,
                opts.store_name or title(service) + " database",
                opts.store_kind or "postgres",
                svc_id,
                tables,
                rel(source),
            )
        ],
    }
    b.files.append(dump(opts.stores_out or "stores.json", stores_fragment))


def dump(name: str, fragment: Dict[str, Any]):
    import json

    from protocol import File

    return File(name=name, contents=json.dumps(fragment, indent=2, ensure_ascii=False) + "\n")


def readme_title(markdown: str) -> str:
    for line in markdown.split("\n"):
        text = line.strip()
        if text.startswith("# "):
            return text[2:].strip()
    return ""


def project_repo(root: str) -> str:
    """`pyproject.toml`'s repository url, spelled the way go.mod spells a
    module: host/owner/name."""
    path = os.path.join(root, "pyproject.toml")
    if not os.path.isfile(path):
        return ""
    match = re.search(r"(?im)^\s*(?:repository|Repository|Source)\s*=\s*[\"']([^\"']+)[\"']", read(path))
    if not match:
        return ""
    url = match.group(1)
    url = re.sub(r"^git\+", "", url)
    url = re.sub(r"^(https?|ssh)://", "", url)
    url = re.sub(r"^git@", "", url).replace(":", "/", 1)
    return re.sub(r"\.git$", "", url).rstrip("/")
