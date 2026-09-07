"""HTTP contract details Django and DRF expose in handler syntax.

The URL reader proves that an operation exists.  This module adds the payload
facts that are local to the handler: schema decorators, response expressions
and query-parameter reads.  It deliberately never imports application code.
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from source import assigned, const_str, dotted, keyword


@dataclass
class Contract:
    summary: str = ""
    description: str = ""
    operation_id: str = ""
    tags: List[str] = field(default_factory=list)
    parameters: List[Dict[str, Any]] = field(default_factory=list)
    request_schema: Optional[Dict[str, Any]] = None
    responses: Dict[str, Dict[str, Any]] = field(default_factory=dict)


def read(endpoint, registry) -> Contract:
    contract = Contract()
    handler = endpoint.node if isinstance(endpoint.node, (ast.FunctionDef, ast.AsyncFunctionDef)) else None
    view = view_node(endpoint)
    contract.parameters = query_parameters(handler, view)
    if handler is not None:
        contract.responses = response_contracts(handler, endpoint, registry)
        for decorator in handler.decorator_list:
            name = dotted(decorator).split(".")[-1]
            if isinstance(decorator, ast.Call) and name in ("swagger_auto_schema", "extend_schema"):
                apply_decorator(contract, decorator, endpoint, registry, name)
    return contract


def view_node(endpoint) -> Optional[ast.ClassDef]:
    view_name = endpoint.view.split(".", 1)[0]
    return next((node for node in endpoint.module.classes() if node.name == view_name), None)


def apply_decorator(contract: Contract, call: ast.Call, endpoint, registry, kind: str) -> None:
    contract.operation_id = const_str(keyword(call, "operation_id")) or contract.operation_id
    contract.summary = const_str(keyword(call, "operation_summary" if kind == "swagger_auto_schema" else "summary")) or contract.summary
    contract.description = const_str(keyword(call, "operation_description" if kind == "swagger_auto_schema" else "description")) or contract.description
    tags = string_list(keyword(call, "tags"))
    if tags:
        contract.tags = tags

    request = keyword(call, "request_body" if kind == "swagger_auto_schema" else "request")
    schema = schema_expression(request, endpoint, registry)
    if schema is not None:
        contract.request_schema = schema

    response_node = keyword(call, "responses")
    annotated = annotated_responses(response_node, endpoint, registry)
    if annotated:
        contract.responses.update(annotated)

    parameters = keyword(call, "manual_parameters" if kind == "swagger_auto_schema" else "parameters")
    for parameter in parameter_expressions(parameters, endpoint, registry):
        upsert_parameter(contract.parameters, parameter)


def annotated_responses(node: Optional[ast.AST], endpoint, registry) -> Dict[str, Dict[str, Any]]:
    if node is None:
        return {}
    if not isinstance(node, ast.Dict):
        schema = schema_expression(node, endpoint, registry)
        return {"200": response("Documented response.", schema)} if schema is not None else {}
    out = {}
    for key, value in zip(node.keys, node.values):
        status = status_code(key)
        if not status:
            continue
        description = "Documented response."
        schema_node = value
        if isinstance(value, ast.Call) and dotted(value.func).split(".")[-1] in ("Response", "OpenApiResponse"):
            description = const_str(keyword(value, "description")) or (const_str(value.args[0]) if value.args else "") or description
            schema_node = keyword(value, "schema") or keyword(value, "response")
            if schema_node is None and len(value.args) > 1:
                schema_node = value.args[1]
        schema = schema_expression(schema_node, endpoint, registry)
        out[status] = response(description, schema)
    return out


def parameter_expressions(node: Optional[ast.AST], endpoint, registry) -> List[Dict[str, Any]]:
    if not isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        return []
    out = []
    for item in node.elts:
        if not isinstance(item, ast.Call) or dotted(item.func).split(".")[-1] not in ("Parameter", "OpenApiParameter"):
            continue
        name = const_str(keyword(item, "name")) or (const_str(item.args[0]) if item.args else "")
        if not name:
            continue
        location_node = keyword(item, "in_") or keyword(item, "location")
        location = constant_name(location_node).lower()
        location = {"in_query": "query", "query": "query", "in_header": "header", "header": "header", "in_path": "path", "path": "path"}.get(location, "query")
        schema_node = keyword(item, "type") or keyword(item, "schema")
        schema = schema_expression(schema_node, endpoint, registry) or primitive_schema(schema_node) or {"type": "string"}
        parameter: Dict[str, Any] = {
            "name": name,
            "in": location,
            "required": bool_value(keyword(item, "required")),
            "schema": schema,
            "x-portolan-inferred": True,
        }
        description = const_str(keyword(item, "description"))
        if description:
            parameter["description"] = description
        out.append(parameter)
    return out


def response_contracts(handler: ast.AST, endpoint, registry) -> Dict[str, Dict[str, Any]]:
    assignments = local_assignments(handler)
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    descriptions: Dict[str, str] = {}
    for node in ast.walk(handler):
        if not isinstance(node, ast.Return) or not isinstance(node.value, ast.Call):
            continue
        call = node.value
        kind = dotted(call.func).split(".")[-1]
        if kind not in ("Response", "JsonResponse"):
            continue
        code = response_status(call)
        data = call.args[0] if call.args else keyword(call, "data")
        schema = value_schema(data, endpoint, registry, assignments, set())
        descriptions[code] = "No content response read from the Django handler." if code == "204" else "Response shape inferred from the Django handler."
        if schema is not None and code != "204":
            grouped.setdefault(code, []).append(schema)
        else:
            grouped.setdefault(code, [])
    out = {}
    for code in sorted(grouped):
        schemas = unique_schemas(grouped[code])
        schema = schemas[0] if len(schemas) == 1 else ({"anyOf": schemas} if schemas else None)
        out[code] = response(descriptions[code], schema)
    return out


def value_schema(node: Optional[ast.AST], endpoint, registry, assignments: Dict[str, ast.AST], seen: set) -> Optional[Dict[str, Any]]:
    if node is None:
        return None
    if isinstance(node, ast.Name) and node.id in assignments and node.id not in seen:
        return value_schema(assignments[node.id], endpoint, registry, assignments, seen | {node.id})
    if isinstance(node, ast.Attribute) and node.attr == "data":
        serializer = serializer_value(node.value, endpoint, registry, assignments, seen)
        if serializer is not None:
            return serializer
    if isinstance(node, ast.Dict):
        properties = {}
        for key, value in zip(node.keys, node.values):
            name = const_str(key)
            if not name:
                return {"type": "object"}
            properties[name] = value_schema(value, endpoint, registry, assignments, seen) or {}
        schema: Dict[str, Any] = {"type": "object", "properties": properties}
        if properties:
            schema["required"] = list(properties)
        return schema
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        schemas = unique_schemas([value_schema(item, endpoint, registry, assignments, seen) or {} for item in node.elts])
        items: Dict[str, Any] = schemas[0] if len(schemas) == 1 else ({"anyOf": schemas} if schemas else {})
        return {"type": "array", "items": items}
    if isinstance(node, ast.Constant):
        if node.value is None:
            return {"type": "null"}
        if isinstance(node.value, bool):
            return {"type": "boolean"}
        if isinstance(node.value, int):
            return {"type": "integer"}
        if isinstance(node.value, float):
            return {"type": "number"}
        if isinstance(node.value, str):
            return {"type": "string"}
    if isinstance(node, ast.JoinedStr):
        return {"type": "string"}
    if isinstance(node, ast.Call):
        serializer = serializer_call_schema(node, endpoint, registry)
        if serializer is not None:
            return serializer
        kind = dotted(node.func).split(".")[-1]
        if kind in ("str", "repr"):
            return {"type": "string"}
        if kind == "int":
            return {"type": "integer"}
        if kind == "float":
            return {"type": "number"}
        if kind in ("bool",):
            return {"type": "boolean"}
        if kind in ("list", "tuple", "set"):
            return {"type": "array", "items": {}}
        if kind in ("dict",):
            return {"type": "object"}
    return None


def serializer_value(node: ast.AST, endpoint, registry, assignments: Dict[str, ast.AST], seen: set) -> Optional[Dict[str, Any]]:
    if isinstance(node, ast.Name) and node.id in assignments and node.id not in seen:
        value = assignments[node.id]
        if isinstance(value, ast.Call):
            return serializer_call_schema(value, endpoint, registry)
    if isinstance(node, ast.Call):
        return serializer_call_schema(node, endpoint, registry)
    return None


def serializer_call_schema(call: ast.Call, endpoint, registry) -> Optional[Dict[str, Any]]:
    serializer = registry.resolve(endpoint.module, call.func)
    if serializer is None and dotted(call.func).endswith(("self.get_serializer", "self.get_serializer_class")):
        serializer = registry.for_endpoint(endpoint)
    if serializer is None:
        return None
    reference: Dict[str, Any] = {"$ref": "#/components/schemas/%s" % serializer.component}
    many = bool_value(keyword(call, "many"))
    return {"type": "array", "items": reference} if many else reference


def schema_expression(node: Optional[ast.AST], endpoint, registry) -> Optional[Dict[str, Any]]:
    if node is None:
        return None
    if isinstance(node, ast.Call):
        kind = dotted(node.func).split(".")[-1]
        if kind in ("Schema", "OpenApiSchema"):
            schema: Dict[str, Any] = primitive_schema(keyword(node, "type")) or {}
            properties = keyword(node, "properties")
            if isinstance(properties, ast.Dict):
                schema.setdefault("type", "object")
                schema["properties"] = {
                    const_str(key): schema_expression(value, endpoint, registry) or {}
                    for key, value in zip(properties.keys, properties.values)
                    if const_str(key)
                }
            items = schema_expression(keyword(node, "items"), endpoint, registry)
            if items is not None:
                schema["items"] = items
            required = string_list(keyword(node, "required"))
            if required:
                schema["required"] = required
            description = const_str(keyword(node, "description"))
            if description:
                schema["description"] = description
            example = literal_value(keyword(node, "example"))
            if example is not None:
                schema["example"] = example
            return schema
        serializer = serializer_call_schema(node, endpoint, registry)
        if serializer is not None:
            return serializer
    serializer = registry.resolve(endpoint.module, node)
    if serializer is not None:
        return {"$ref": "#/components/schemas/%s" % serializer.component}
    return primitive_schema(node)


def query_parameters(handler: Optional[ast.AST], view: Optional[ast.ClassDef]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    if handler is not None:
        required_names = required_query_names(handler)
        for call in ast.walk(handler):
            if not isinstance(call, ast.Call) or not query_get(call):
                continue
            name = const_str(call.args[0]) if call.args else const_str(keyword(call, "key"))
            if not name:
                continue
            default_node = call.args[1] if len(call.args) > 1 else keyword(call, "default")
            schema = query_value_schema(call, handler) or {"type": "string"}
            default = literal_value(default_node)
            if default is not None:
                schema["default"] = default
            upsert_parameter(out, {
                "name": name,
                "in": "query",
                "required": name in required_names,
                "schema": schema,
                "description": "Read from request query parameters by the Django handler.",
                "x-portolan-inferred": True,
            })
    if view is not None:
        values = {name: value for name, value, _ in assigned(view)}
        for name in string_list(values.get("filterset_fields")):
            upsert_parameter(out, declared_query(name, "Declared by DRF filterset_fields."))
        if string_list(values.get("search_fields")):
            upsert_parameter(out, declared_query("search", "Declared by DRF search_fields."))
        if string_list(values.get("ordering_fields")):
            upsert_parameter(out, declared_query("ordering", "Declared by DRF ordering_fields."))
        pagination = values.get("pagination_class")
        if pagination is not None and not (isinstance(pagination, ast.Constant) and pagination.value is None):
            upsert_parameter(out, declared_query("page", "Inferred from the DRF pagination class.", {"type": "integer", "minimum": 1}))
    return out


def query_get(call: ast.Call) -> bool:
    name = dotted(call.func)
    return name.endswith(("request.GET.get", "request.query_params.get"))


def query_value_schema(call: ast.Call, handler: ast.AST) -> Optional[Dict[str, Any]]:
    for parent in ast.walk(handler):
        if not isinstance(parent, ast.Call) or not parent.args or parent.args[0] is not call:
            continue
        kind = dotted(parent.func).split(".")[-1]
        if kind == "int":
            return {"type": "integer"}
        if kind == "float":
            return {"type": "number"}
        if kind == "bool":
            return {"type": "boolean"}
    default = call.args[1] if len(call.args) > 1 else keyword(call, "default")
    if isinstance(default, ast.Constant):
        if isinstance(default.value, bool):
            return {"type": "boolean"}
        if isinstance(default.value, int):
            return {"type": "integer"}
        if isinstance(default.value, float):
            return {"type": "number"}
    return None


def required_query_names(handler: ast.AST) -> set:
    assignments = local_assignments(handler)
    out = set()
    for node in ast.walk(handler):
        if not isinstance(node, ast.If) or not contains_raise(node.body):
            continue
        names = compared_to_none(node.test)
        for name in names:
            value = assignments.get(name)
            if isinstance(value, ast.Call) and query_get(value) and value.args:
                out.add(const_str(value.args[0]))
    return out


def compared_to_none(node: ast.AST) -> List[str]:
    if isinstance(node, ast.BoolOp):
        out = []
        for value in node.values:
            out += compared_to_none(value)
        return out
    if not isinstance(node, ast.Compare):
        return []
    values = [node.left] + node.comparators
    if not any(isinstance(value, ast.Constant) and value.value is None for value in values):
        return []
    return [value.id for value in values if isinstance(value, ast.Name)]


def contains_raise(statements: List[ast.stmt]) -> bool:
    return any(isinstance(node, ast.Raise) for statement in statements for node in ast.walk(statement))


def local_assignments(node: ast.AST) -> Dict[str, ast.AST]:
    out = {}
    ambiguous = set()
    for item in ast.walk(node):
        name = ""
        value = None
        if isinstance(item, ast.Assign) and len(item.targets) == 1 and isinstance(item.targets[0], ast.Name):
            name, value = item.targets[0].id, item.value
        elif isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name) and item.value is not None:
            name, value = item.target.id, item.value
        if not name or value is None or name in ambiguous:
            continue
        if name in out and ast.dump(out[name]) != ast.dump(value):
            del out[name]
            ambiguous.add(name)
        else:
            out[name] = value
    return out


def response_status(call: ast.Call) -> str:
    value = keyword(call, "status")
    if value is None and dotted(call.func).split(".")[-1] == "Response" and len(call.args) > 1:
        value = call.args[1]
    return status_code(value) or "200"


def status_code(node: Optional[ast.AST]) -> str:
    if isinstance(node, ast.Constant) and isinstance(node.value, int):
        return str(node.value)
    if isinstance(node, ast.Constant) and isinstance(node.value, str) and re.fullmatch(r"[1-5]\d\d|default", node.value):
        return node.value
    match = re.search(r"HTTP_(\d{3})_", dotted(node))
    return match.group(1) if match else ""


def primitive_schema(node: Optional[ast.AST]) -> Optional[Dict[str, Any]]:
    name = constant_name(node).lower()
    kind = {
        "type_object": "object", "object": "object", "obj": "object",
        "type_array": "array", "array": "array",
        "type_string": "string", "string": "string", "str": "string",
        "type_integer": "integer", "integer": "integer", "int": "integer",
        "type_number": "number", "number": "number", "float": "number", "double": "number",
        "type_boolean": "boolean", "boolean": "boolean", "bool": "boolean",
    }.get(name)
    return {"type": kind} if kind else None


def constant_name(node: Optional[ast.AST]) -> str:
    return const_str(node) or dotted(node).split(".")[-1]


def literal_value(node: Optional[ast.AST]) -> Any:
    if node is None:
        return None
    try:
        return ast.literal_eval(node)
    except (ValueError, TypeError):
        return None


def bool_value(node: Optional[ast.AST]) -> bool:
    return isinstance(node, ast.Constant) and node.value is True


def string_list(node: Optional[ast.AST]) -> List[str]:
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        return [value for value in (const_str(item) for item in node.elts) if value]
    return []


def declared_query(name: str, description: str, schema: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    return {"name": name, "in": "query", "required": False, "schema": schema or {"type": "string"}, "description": description, "x-portolan-inferred": True}


def upsert_parameter(parameters: List[Dict[str, Any]], parameter: Dict[str, Any]) -> None:
    key = (parameter.get("name"), parameter.get("in"))
    for index, existing in enumerate(parameters):
        if (existing.get("name"), existing.get("in")) == key:
            parameters[index] = parameter
            return
    parameters.append(parameter)


def response(description: str, schema: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    out: Dict[str, Any] = {"description": description}
    if schema is not None:
        out["content"] = {"application/json": {"schema": schema}}
    return out


def unique_schemas(schemas: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for schema in schemas:
        if schema not in out:
            out.append(schema)
    return out
