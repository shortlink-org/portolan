"""One Django service in, one fragment out - two, when it keeps a database.

A fragment, not a catalog: it carries one context and one service, names peers
it does not own, and is merged with everything else before anything validates
it.
"""

from __future__ import annotations

import ast
import os
import re
from typing import Any, Dict, List

import apps as apps_module
import auth as auth_module
import catalog
import clients as clients_module
import contracts
import database
import domain
import events as events_module
import flows
import lifecycle
import operations
import routing
import serializers as serializers_module
import store as store_module
import transport
from ids import service_id, slug, title
from options import Options
from protocol import Builder, Input
from source import Project, const_str, dotted, keyword, read


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

    models_by_app = {app.dotted: domain.read_models(app) for app in applications}
    concrete_models = [model for models in models_by_app.values() for model in models if model.concrete]
    configured_databases = database.databases_of(project, opts.settings)
    primary_database = next((item for item in configured_databases if item.alias == "default"), None)
    effective_store = opts.store
    if not effective_store and concrete_models and primary_database is not None and primary_database.kind:
        effective_store = database.store_slug(primary_database.kind)
    store_aliases = {item.alias: (effective_store if item.alias == "default" else slug(item.alias)) for item in configured_databases}

    aggregates = domain.read_aggregates(
        project,
        applications,
        svc_id,
        dict(opts.aggregates),
        b,
        models_by_app,
    )
    route_table = routing.read(project, opts.settings)
    endpoint_apps = routed_applications(project, applications, route_table)
    endpoints = []
    for app in endpoint_apps:
        endpoints += [(app, endpoint) for endpoint in transport.read_endpoints(app, b, route_table)]
    serializer_registry = serializers_module.read(project, endpoint_apps)
    auth_registry = auth_module.Registry(project, opts.settings, b)

    known_events: Dict[str, Any] = {}
    use_cases: List[operations.UseCase] = []
    clients: List[clients_module.Client] = []
    for agg in aggregates:
        found, registry = events_module.read_events(agg, service, b)
        agg.aggregate["events"] = found
        known_events.update(registry)
        use_cases += operations.read_use_cases(agg, b)
        clients += clients_module.read_clients(agg.app, dict(opts.peers), rel, b)

    reader = flows.FlowReader(
        flows.Options(
            context=context,
            svc_id=svc_id,
            service=service,
            store=effective_store,
            stores=store_aliases,
            peers=dict(opts.peers),
            events=dict(opts.events),
            flow_wrappers=dict(opts.flow_wrappers),
            settings=opts.settings,
        ),
        project,
        aggregates,
        concrete_models + serializer_registry.models,
        use_cases,
        clients,
        known_events,
        rel,
        b,
    )

    found_flows = []
    exposed: Dict[str, List[str]] = {}
    for _app, endpoint in endpoints:
        serializer = serializer_registry.for_endpoint(endpoint)
        model = serializer_registry.model_for_endpoint(endpoint) if isinstance(endpoint.node, ast.ClassDef) else None
        flow = reader.endpoint_flow(endpoint, serializer, model)
        if flow is not None:
            found_flows.append(flow)
        for key in endpoint.use_cases:
            exposed.setdefault(key, []).append(endpoint.id)
    for agg in aggregates:
        for module, node, decorator in transport.receivers(agg.app):
            flow = reader.policy_flow(agg, module, node, decorator)
            if flow is not None:
                found_flows.append(flow)
    found_flows.extend(reader.task_flows())

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
            # Where the code puts the event on the wire is its channel, when
            # the dataclass did not say; when both say and disagree, one of
            # the two is stale, and the dataclass's claim stays on the page.
            for address, line in reader.produced.get(event["id"], []):
                declared = event.get("wire", {}).get("channel", "")
                if not declared:
                    event.setdefault("wire", {})["channel"] = address
                elif declared != address:
                    b.warn(event["id"], "declares channel %s but is put on %s at %s" % (declared, address, line))

    readme_path = os.path.join(root, "README.md")
    readme = read(readme_path).strip() if os.path.isfile(readme_path) else ""
    schema_name = schema_title(route_table)
    display_name = opts.service_name or service_name_from_schema(schema_name) or readme_title(readme) or title(service)

    openapi_name = opts.openapi_out or "openapi.inferred.yaml"
    openapi_source = generated_source(input_, root, rel, openapi_name)
    service_obj = {
        "id": svc_id,
        "slug": service,
        "name": display_name,
        "repo": opts.repo or project_repo(root),
        "path": rel(root),
        "readme": readme,
        "provides": http_contracts(endpoints, svc_id, openapi_source),
        "consumes": reader.consumes(),
        "aggregates": [agg.aggregate for agg in aggregates],
    }

    fragment = {
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
    if service_obj["provides"]:
        b.files.append(dump(openapi_name, openapi_document(
            endpoints,
            display_name,
            b,
            serializer_registry,
            "" if opts.service_name else schema_name,
            auth_registry,
        )))

    if route_table.runtime_schema and service_obj["provides"]:
        b.warn(
            route_table.runtime_schema,
            "OpenAPI/Swagger is generated at runtime; the emitted OpenAPI document is inferred from URLConf, DRF declarations, schema decorators and handler expressions, so details assembled only at runtime remain unavailable without a checked-in document",
        )

    if not effective_store:
        b.warn(
            svc_id,
            "the project has ORM models, but DATABASES['default'] cannot be read and no `store` option names their database",
        )
        return
    kind, engine, implied = database.store_kind(project, opts.settings, opts.store_kind)
    if implied:
        b.warn(svc_id, "the manifest says storeKind %s but the settings' DATABASES engine is %s, which is %s; the manifest's kind is used" % (kind, engine, implied))
    tables = store_module.read_all(
        models_by_app,
        aggregates,
        svc_id,
        effective_store,
        kind,
        database.default_auto_field(project, opts.settings),
        b,
    )
    store_id = "%s.%s" % (svc_id, effective_store)
    stores_fragment = {
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
                effective_store,
                opts.store_name or title(service) + " database",
                kind,
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


def generated_source(input_: Input, root: str, rel, name: str) -> str:
    """Repository-relative location at which the host writes ``name``.

    New hosts tell plugins the exact output directory. The conventional
    ``<service>/portolan`` fallback keeps direct and older hosts useful.
    """
    output = input_.output.strip("/")
    if output:
        return "%s/%s" % (output, name)
    return rel(os.path.join(root, "portolan", name))


def http_contracts(endpoints, svc_id: str, source: str) -> List[Dict[str, Any]]:
    """Interfaces the service answers on, grouped by Django application.

    A runtime Swagger generator proves that a document can be served, not that
    a static document exists for this process to read.  URLConf plus the view
    declarations still prove the operation and its route, which is enough for
    a useful partial contract and is labelled as inferred by its Python source.
    """
    grouped: Dict[str, List[Any]] = {}
    apps: Dict[str, Any] = {}
    for app, endpoint in endpoints:
        if not endpoint.verb or not endpoint.path:
            continue
        grouped.setdefault(app.dotted, []).append(endpoint)
        apps[app.dotted] = app
    out = []
    for dotted_name in sorted(grouped):
        app = apps[dotted_name]
        methods = []
        seen = set()
        for endpoint in sorted(grouped[dotted_name], key=lambda item: (item.id, item.verb, item.path)):
            name = endpoint.id
            if name in seen:
                name = "%s_%s" % (name, slug(endpoint.path))
            seen.add(name)
            method = {"name": name}
            if endpoint.doc:
                method["doc"] = endpoint.doc
            method["http"] = {"method": endpoint.verb, "path": endpoint.path}
            methods.append(method)
        if not methods:
            continue
        out.append({"id": "%s.%s" % (svc_id, slug(app.label)), "methods": methods, "source": source})
    return out


def openapi_document(endpoints, service_name: str, b: Builder, serializer_registry=None, api_title: str = "", auth_registry=None) -> Dict[str, Any]:
    """A conservative OpenAPI view over facts Django declares statically.

    Routes and verbs are evidence. A bound DRF serializer and generic view add
    the payload and framework response semantics; other operations retain an
    explicitly unknown default response.
    """
    paths: Dict[str, Dict[str, Any]] = {}
    tags = set()
    operation_ids = set()
    for app, endpoint in sorted(endpoints, key=lambda item: (item[1].path, item[1].verb, item[0].label, item[1].id)):
        if not endpoint.path or not endpoint.verb:
            continue
        method = endpoint.verb.lower()
        path_item = paths.setdefault(endpoint.path, {})
        if method in path_item:
            b.warn(endpoint.route_source, "%s %s is declared more than once; the first route is kept in inferred OpenAPI" % (endpoint.verb, endpoint.path))
            continue
        tag = app.label
        tags.add(tag)
        operation_id = slug("%s-%s" % (tag, endpoint.id)).replace("-", "_")
        base = operation_id
        suffix = 2
        while operation_id in operation_ids:
            operation_id = "%s_%d" % (base, suffix)
            suffix += 1
        operation_ids.add(operation_id)
        summary = endpoint.doc.strip().splitlines()[0] if endpoint.doc.strip() else title(endpoint.action)
        operation: Dict[str, Any] = {
            "operationId": operation_id,
            "summary": summary,
            "tags": [tag],
            "responses": {
                "default": {
                    "description": "Response schema and status are not available from static Django route analysis."
                }
            },
            "x-portolan-inferred": True,
            "x-portolan-source": endpoint.route_source,
        }
        if endpoint.doc.strip() and "\n" in endpoint.doc.strip():
            operation["description"] = endpoint.doc.strip()
        parameters = []
        for name in dict.fromkeys(re.findall(r"\{([A-Za-z_][A-Za-z0-9_]*)\}", endpoint.path)):
            converter = endpoint.path_parameters.get(name, "str")
            schema: Dict[str, Any] = {"type": "integer"} if converter == "int" else {"type": "string"}
            if converter == "uuid":
                schema["format"] = "uuid"
            elif converter == "slug":
                schema["pattern"] = "^[-a-zA-Z0-9_]+$"
            parameters.append(
                {
                    "name": name,
                    "in": "path",
                    "required": True,
                    "description": "Inferred from Django's %s path converter." % converter if name in endpoint.path_parameters else "Type was not recoverable from the resolved Django route.",
                    "schema": schema,
                    "x-portolan-inferred": True,
                }
            )
        if parameters:
            operation["parameters"] = parameters
        statuses = response_statuses(endpoint.node)
        serializer = serializer_registry.for_endpoint(endpoint) if serializer_registry is not None else None
        if serializer is not None and serializer_registry.describes_contract(endpoint):
            attach_serializer_contract(operation, endpoint, serializer, serializer_registry, statuses)
        elif statuses:
            operation["responses"] = {
                status: {
                    "description": "No content response read from the Django handler."
                    if status == "204"
                    else "Error response status read from the Django handler; its schema is unknown."
                    if not status.startswith("2")
                    else "Response status read from the Django handler; its schema is unknown."
                }
                for status in statuses
            }
        if serializer_registry is not None:
            detail = contracts.read(endpoint, serializer_registry)
            if detail.summary:
                operation["summary"] = detail.summary
            if detail.description:
                operation["description"] = detail.description
            if detail.operation_id:
                operation_ids.discard(operation["operationId"])
                operation["operationId"] = unique_operation_id(detail.operation_id, operation_ids)
            if detail.tags:
                operation["tags"] = detail.tags
                tags.update(detail.tags)
            if detail.parameters:
                operation.setdefault("parameters", [])
                for parameter in detail.parameters:
                    contracts.upsert_parameter(operation["parameters"], parameter)
            if detail.request_schema is not None:
                operation["requestBody"] = {
                    "required": True,
                    "content": {"application/json": {"schema": detail.request_schema}},
                }
            if detail.responses:
                operation["responses"] = detail.responses
        if auth_registry is not None:
            security = auth_registry.security_for(endpoint)
            if security.requirement is not None:
                operation["security"] = security.requirement
            if security.permissions:
                operation["x-portolan-permissions"] = security.permissions
        path_item[method] = operation

    document = {
        "openapi": "3.1.0",
        "info": {
            "title": api_title or "%s HTTP API" % service_name,
            "version": "inferred",
            "description": "Generated statically from Django URLConf, DRF declarations, schema decorators and handler expressions. Unknown details are left unspecified.",
        },
        "tags": [{"name": name} for name in sorted(tags)],
        "paths": paths,
        "x-portolan-inferred": True,
        "x-portolan-generator": "extract-django",
    }
    components = serializer_registry.components() if serializer_registry is not None else {}
    if components:
        document["components"] = {"schemas": components}
    if auth_registry is not None:
        # The document-level requirement is what the settings alone decide,
        # and the schemes are every one an operation or that default named.
        default = auth_registry.default_security()
        if default is not None:
            document["security"] = default
        if auth_registry.schemes:
            document.setdefault("components", {})["securitySchemes"] = {name: auth_registry.schemes[name] for name in sorted(auth_registry.schemes)}
    return document


def unique_operation_id(preferred: str, used: set) -> str:
    candidate = slug(preferred).replace("-", "_")
    if candidate in used:
        suffix = 2
        while "%s_%d" % (candidate, suffix) in used:
            suffix += 1
        candidate = "%s_%d" % (candidate, suffix)
    used.add(candidate)
    return candidate


def attach_serializer_contract(operation: Dict[str, Any], endpoint, serializer, registry, statuses: List[str]) -> None:
    reference: Dict[str, Any] = {"$ref": "#/components/schemas/%s" % serializer.component}
    verb = endpoint.verb.upper()
    if verb in ("POST", "PUT", "PATCH"):
        request_schema: Dict[str, Any] = dict(reference)
        if verb == "PATCH":
            request_schema = {"allOf": [reference], "x-portolan-partial": True}
        operation["requestBody"] = {
            "required": True,
            "content": {"application/json": {"schema": request_schema}},
        }

    if not statuses and (verb == "DELETE" or endpoint.action == "destroy"):
        operation["responses"] = {"204": {"description": "Deleted successfully."}}
        return

    response_schema: Dict[str, Any] = reference
    if registry.is_list(endpoint):
        response_schema = {"type": "array", "items": reference}
    statuses = statuses or (["201"] if endpoint.action == "create" else ["200"])
    operation["responses"] = {}
    for status in statuses:
        success = status.startswith("2")
        response: Dict[str, Any] = {
            "description": (
                "No content response read from the Django handler."
                if status == "204"
                else "Serialized response inferred from DRF view configuration."
                if success
                else "Error response status read from the Django handler; its schema is unknown."
            ),
        }
        if success and status != "204":
            response["content"] = {"application/json": {"schema": response_schema}}
        operation["responses"][status] = response


def response_statuses(node: ast.AST) -> List[str]:
    if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        return []
    out = set()
    for call in ast.walk(node):
        if not isinstance(call, ast.Call) or dotted(call.func).split(".")[-1] not in ("Response", "JsonResponse"):
            continue
        value = next((kw.value for kw in call.keywords if kw.arg == "status"), None)
        if value is None and dotted(call.func).split(".")[-1] == "Response" and len(call.args) > 1:
            value = call.args[1]
        if isinstance(value, ast.Constant) and isinstance(value.value, int):
            out.add(str(value.value))
            continue
        symbolic = dotted(value)
        match = re.search(r"HTTP_(\d{3})_", symbolic)
        out.add(match.group(1) if match else "200")
    return sorted(out)


def routed_applications(project: Project, model_apps, routes: routing.Routes):
    """Django applications that expose routes, including stateless ones.

    ``apps.discover`` intentionally uses a models module as the application
    boundary for domain extraction.  HTTP is a different concern: health,
    proxy and mailer applications often own URLConf and views but no model.
    Their routes remain part of the service contract.
    """
    out = {app.dotted: app for app in model_apps}
    for route in routes.entries:
        marker = ".views"
        package = route.module.split(marker, 1)[0] if marker in route.module else route.module.rsplit(".", 1)[0]
        if not package or package in out:
            continue
        app = apps_module.build(project, package)
        if app is not None:
            out[package] = app
    return [out[name] for name in sorted(out, key=lambda name: out[name].rel)]


def readme_title(markdown: str) -> str:
    fence = ""
    for line in markdown.split("\n"):
        text = line.strip()
        marker = "```" if text.startswith("```") else "~~~" if text.startswith("~~~") else ""
        if marker:
            if not fence:
                fence = marker
            elif fence == marker:
                fence = ""
            continue
        if fence:
            continue
        if text.startswith("# "):
            return text[2:].strip()
    return ""


def schema_title(routes: routing.Routes) -> str:
    """The human API title declared by drf-yasg in the root URLConf.

    This is read from the AST only: importing a Django URLConf would execute
    application code merely to name its documentation.
    """
    if routes.root is None:
        return ""
    for node in ast.walk(routes.root.tree):
        if not isinstance(node, ast.Call) or dotted(node.func).split(".")[-1] != "Info":
            continue
        value = const_str(keyword(node, "title"))
        if not value and node.args:
            value = const_str(node.args[0])
        if value:
            return value.strip()
    return ""


def service_name_from_schema(value: str) -> str:
    """Turn an API document title into the component name shown in catalog."""
    without_suffix = re.sub(r"\s+(?:HTTP\s+)?API\s*$", "", value, flags=re.IGNORECASE).strip()
    return without_suffix or value.strip()


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
