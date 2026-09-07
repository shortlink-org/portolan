"""DRF serializers as conservative OpenAPI schemas.

Nothing is imported.  Serializer declarations, their Meta model/fields and a
view's serializer_class are enough to recover the common DRF contract while
leaving custom runtime behaviour unknown.
"""

from __future__ import annotations

import ast
from collections import Counter
from dataclasses import dataclass, field as dc_field
from typing import Any, Dict, List, Optional, Set, Tuple

import domain
from apps import App
from ids import pascal
from source import Module, Project, assigned, bases, const_str, dotted, inner_class, keyword, keyword_bool, keyword_int, methods


@dataclass
class SerializerDef:
    name: str
    node: ast.ClassDef
    module: Module
    app: App
    component: str = ""


class Registry:
    def __init__(self, project: Project, apps: List[App], serializers: List[SerializerDef], models: List[domain.ModelDef]):
        self.project = project
        self.apps = apps
        self.serializers = serializers
        self.models = models
        counts = Counter(item.name for item in serializers)
        for item in serializers:
            item.component = item.name if counts[item.name] == 1 else pascal(item.app.label) + item.name
        self.by_symbol = {(item.module.dotted, item.name): item for item in serializers}
        self.by_name: Dict[str, List[SerializerDef]] = {}
        for item in serializers:
            self.by_name.setdefault(item.name, []).append(item)
        self._schemas: Dict[str, Dict[str, Any]] = {}

    def resolve(self, module: Module, expression: ast.AST) -> Optional[SerializerDef]:
        name = dotted(expression)
        if not name:
            return None
        target = resolve_symbol(self.project, module, name)
        if target in self.by_symbol:
            return self.by_symbol[target]
        candidates = self.by_name.get(name.split(".")[-1], [])
        if len(candidates) == 1:
            return candidates[0]
        same_app = [item for item in candidates if module.dotted == item.app.dotted or module.dotted.startswith(item.app.dotted + ".")]
        return same_app[0] if len(same_app) == 1 else None

    def components(self) -> Dict[str, Dict[str, Any]]:
        for serializer in self.serializers:
            self.schema(serializer, set())
        return {name: self._schemas[name] for name in sorted(self._schemas)}

    def schema(self, serializer: SerializerDef, stack: Set[Tuple[str, str]]) -> Dict[str, Any]:
        if serializer.component in self._schemas:
            return self._schemas[serializer.component]
        key = (serializer.module.dotted, serializer.name)
        if key in stack:
            return {"type": "object"}
        fields = self.fields(serializer, stack | {key})
        schema: Dict[str, Any] = {"type": "object", "properties": {name: value[0] for name, value in fields.items()}}
        required = [name for name, (_, is_required) in fields.items() if is_required]
        if required:
            schema["required"] = required
        description = ast.get_docstring(serializer.node, clean=True) or ""
        if description:
            schema["description"] = description.strip()
        schema["x-portolan-inferred"] = True
        schema["x-portolan-source"] = serializer.module.where(serializer.node)
        self._schemas[serializer.component] = schema
        return schema

    def fields(self, serializer: SerializerDef, stack: Set[Tuple[str, str]]) -> Dict[str, Tuple[Dict[str, Any], bool]]:
        out: Dict[str, Tuple[Dict[str, Any], bool]] = {}
        for base in serializer.node.bases:
            parent = self.resolve(serializer.module, base)
            parent_key = (parent.module.dotted, parent.name) if parent is not None else None
            if parent is not None and parent_key not in stack:
                out.update(self.fields(parent, stack | {parent_key}))

        meta = inner_class(serializer.node, "Meta")
        meta_fields: Optional[List[str]] = None
        read_only: Set[str] = set()
        model = None
        if meta is not None:
            values = {name: value for name, value, _ in assigned(meta)}
            if "fields" in values:
                meta_fields = string_list(values["fields"])
                if const_str(values["fields"]) == "__all__":
                    meta_fields = []
            read_only = set(string_list(values.get("read_only_fields")))
            if "model" in values:
                model = self.model_for(serializer, values["model"])

        if model is not None:
            model_fields = self.model_fields(model, set())
            selected = list(model_fields) if meta_fields == [] else (meta_fields or [])
            for name in selected:
                model_field = model_fields.get(name)
                if model_field is None:
                    schema, required = fallback_model_field(name)
                else:
                    schema, required = model_schema(model_field)
                if name in read_only:
                    schema["readOnly"] = True
                    required = False
                out[name] = (schema, required)

        for name, value, _ in assigned(serializer.node):
            if not isinstance(value, ast.Call):
                continue
            nested = self.resolve(serializer.module, value.func)
            if nested is not None:
                schema: Dict[str, Any] = {"$ref": "#/components/schemas/%s" % nested.component}
                self.schema(nested, stack)
                if keyword_bool(value, "many"):
                    schema = {"type": "array", "items": schema}
            else:
                schema = serializer_field_schema(value, self, serializer.module, stack)
            required = serializer_field_required(value)
            if keyword_bool(value, "read_only"):
                schema["readOnly"] = True
                required = False
            if keyword_bool(value, "write_only"):
                schema["writeOnly"] = True
            out[name] = (schema, required)

        if meta_fields is not None:
            out = {name: out[name] if name in out else fallback_model_field(name) for name in meta_fields if name in out or model is not None}
        return out

    def model_for(self, serializer: SerializerDef, expression: ast.AST) -> Optional[domain.ModelDef]:
        return self.resolve_model(serializer.module, expression, serializer.app)

    def resolve_model(self, module: Module, expression: ast.AST, preferred_app: Optional[App] = None) -> Optional[domain.ModelDef]:
        """Resolve a model expression without importing the Django project."""
        name = dotted(expression)
        if not name:
            return None
        short = name.split(".")[-1]
        candidates = [model for model in self.models if model.name == short]
        target = resolve_symbol(self.project, module, name)
        exact = [model for model in candidates if (model.module.dotted, model.name) == target]
        if len(exact) == 1:
            return exact[0]
        same_app = [model for model in candidates if preferred_app is not None and model.app.dotted == preferred_app.dotted]
        if len(same_app) == 1:
            return same_app[0]
        return candidates[0] if len(candidates) == 1 else None

    def serializer_model(self, serializer: Optional[SerializerDef]) -> Optional[domain.ModelDef]:
        if serializer is None:
            return None
        meta = inner_class(serializer.node, "Meta")
        if meta is None:
            return None
        values = {name: value for name, value, _ in assigned(meta)}
        return self.model_for(serializer, values["model"]) if "model" in values else None

    def model_for_endpoint(self, endpoint) -> Optional[domain.ModelDef]:
        """The row an inherited DRF action operates on, when syntax proves it.

        ``queryset`` and ``get_queryset`` are the strongest evidence. The
        selected serializer's ``Meta.model`` is next; finally, a single model
        named by any serializer declaration on the view is an unambiguous
        fallback for action-specific plain serializers.
        """
        view_name = endpoint.view.split(".", 1)[0]
        view = next((node for node in endpoint.module.classes() if node.name == view_name), None)
        if view is None:
            return None

        values = {name: value for name, value, _ in assigned(view)}
        queryset = values.get("queryset")
        if queryset is not None:
            found = self.model_in_queryset(endpoint.module, queryset)
            if found is not None:
                return found
        selector = next((node for node in methods(view) if node.name == "get_queryset"), None)
        if selector is not None:
            found = self.model_in_queryset(endpoint.module, selector)
            if found is not None:
                return found

        selected = self.for_endpoint(endpoint)
        found = self.serializer_model(selected)
        if found is not None:
            return found

        candidates: List[domain.ModelDef] = []
        expressions: List[ast.AST] = []
        if "serializer_class" in values:
            expressions.append(values["serializer_class"])
        serializer_selector = next((node for node in methods(view) if node.name == "get_serializer_class"), None)
        if serializer_selector is not None:
            expressions += [node.value for node in ast.walk(serializer_selector) if isinstance(node, ast.Return) and node.value is not None]
        for expression in expressions:
            model = self.serializer_model(self.resolve(endpoint.module, expression))
            if model is not None and model not in candidates:
                candidates.append(model)
        return candidates[0] if len(candidates) == 1 else None

    def model_in_queryset(self, module: Module, node: ast.AST) -> Optional[domain.ModelDef]:
        for child in ast.walk(node):
            name = dotted(child.func) if isinstance(child, ast.Call) else dotted(child)
            parts = name.split(".")
            if "objects" not in parts:
                continue
            index = parts.index("objects")
            if index == 0:
                continue
            expression = ast.parse(".".join(parts[:index]), mode="eval").body
            model = self.resolve_model(module, expression)
            if model is not None:
                return model
        return None

    def model_fields(self, model: domain.ModelDef, stack: Set[str]) -> Dict[str, domain.FieldDef]:
        if model.name in stack:
            return {}
        out: Dict[str, domain.FieldDef] = {}
        for base in bases(model.node):
            candidates = [item for item in self.models if item.app is model.app and item.name == base.split(".")[-1]]
            if len(candidates) == 1:
                out.update(self.model_fields(candidates[0], stack | {model.name}))
        out.update({item.name: item for item in model.fields})
        return out

    def for_endpoint(self, endpoint) -> Optional[SerializerDef]:
        view_name = endpoint.view.split(".", 1)[0]
        view = next((node for node in endpoint.module.classes() if node.name == view_name), None)
        if view is None:
            return None
        handler = next((node for node in view.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == endpoint.action), None)
        if handler is not None:
            for decorator in handler.decorator_list:
                if not isinstance(decorator, ast.Call):
                    continue
                value = keyword(decorator, "serializer_class")
                if value is not None:
                    found = self.resolve(endpoint.module, value)
                    if found is not None:
                        return found
        selector = next((node for node in view.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "get_serializer_class"), None)
        if selector is not None:
            selected = selected_return(selector.body, endpoint.action)
            if selected is not None:
                found = self.resolve(endpoint.module, selected)
                if found is not None:
                    return found
            choices = []
            for node in ast.walk(selector):
                if isinstance(node, ast.Return) and node.value is not None:
                    found = self.resolve(endpoint.module, node.value)
                    if found is not None and found not in choices:
                        choices.append(found)
            if len(choices) == 1:
                return choices[0]
        values = {name: value for name, value, _ in assigned(view)}
        if "serializer_class" in values:
            found = self.resolve(endpoint.module, values["serializer_class"])
            if found is not None:
                return found
        return None

    def is_list(self, endpoint) -> bool:
        return endpoint.action == "list"

    def describes_contract(self, endpoint) -> bool:
        # A class node means DRF supplied the inherited CRUD implementation,
        # whose serializer semantics are fixed by the framework. A custom
        # handler can wrap or ignore serializer_class, so only its own action
        # decorator is strong enough evidence until its expressions are read.
        if isinstance(endpoint.node, ast.ClassDef):
            return True
        for decorator in getattr(endpoint.node, "decorator_list", []):
            if isinstance(decorator, ast.Call) and keyword(decorator, "serializer_class") is not None:
                return True
        return False


def read(project: Project, apps: List[App]) -> Registry:
    models = []
    for app in apps:
        app_models = domain.read_models(app)
        known_models = {(model.module.dotted, model.name) for model in app_models}
        # A project-specific model base is still a model when the class body
        # declares Django fields. Domain boundary discovery stays stricter;
        # serializers only need the shape explicitly named by Meta.model.
        for module in app.models:
            for node in module.classes():
                key = (module.dotted, node.name)
                fields = domain.read_fields(node)
                if key not in known_models and fields:
                    app_models.append(domain.ModelDef(node.name, node, module, app, fields=fields))
                    known_models.add(key)
        models += app_models
    found: List[SerializerDef] = []
    known: Set[Tuple[str, str]] = set()
    changed = True
    while changed:
        changed = False
        for app in apps:
            for module in app.package("serializers"):
                for node in module.classes():
                    key = (module.dotted, node.name)
                    if key in known:
                        continue
                    parents = [base.split(".")[-1] for base in bases(node)]
                    if not any(parent in ("Serializer", "ModelSerializer") or any(item.name == parent for item in found) for parent in parents):
                        continue
                    found.append(SerializerDef(node.name, node, module, app))
                    known.add(key)
                    changed = True
    return Registry(project, apps, found, models)


def resolve_symbol(project: Project, module: Module, name: str) -> Tuple[str, str]:
    parts = name.split(".")
    imported = module.imports.get(parts[0])
    if imported is None:
        return module.dotted, name
    combined = imported.module.split(".")
    if imported.name != "*":
        combined.append(imported.name)
    combined += parts[1:]
    for end in range(len(combined), 0, -1):
        candidate = ".".join(combined[:end])
        if project.module(candidate) is not None:
            return candidate, ".".join(combined[end:])
    return "", combined[-1] if combined else ""


def selected_return(statements: List[ast.stmt], action: str) -> Optional[ast.AST]:
    """The serializer returned for a statically decidable self.action branch."""
    for statement in statements:
        if isinstance(statement, ast.Return):
            return statement.value
        if not isinstance(statement, ast.If):
            continue
        matches = action_condition(statement.test, action)
        if matches is True:
            return selected_return(statement.body, action)
        if matches is False and statement.orelse:
            chosen = selected_return(statement.orelse, action)
            if chosen is not None:
                return chosen
        if matches is None:
            return None
    return None


def action_condition(node: ast.AST, action: str) -> Optional[bool]:
    if isinstance(node, ast.BoolOp):
        values = [action_condition(value, action) for value in node.values]
        if any(value is None for value in values):
            return None
        return all(values) if isinstance(node.op, ast.And) else any(values)
    if not isinstance(node, ast.Compare) or len(node.ops) != 1 or len(node.comparators) != 1:
        return None
    left, right = node.left, node.comparators[0]
    if dotted(left) == "self.action":
        expected = right
    elif dotted(right) == "self.action":
        expected = left
    else:
        return None
    op = node.ops[0]
    if isinstance(op, (ast.Eq, ast.NotEq)):
        value = const_str(expected)
        if not value:
            return None
        equal = action == value
        return not equal if isinstance(op, ast.NotEq) else equal
    if isinstance(op, (ast.In, ast.NotIn)):
        values = string_list(expected)
        if not values:
            return None
        included = action in values
        return not included if isinstance(op, ast.NotIn) else included
    return None


def string_list(node: Optional[ast.AST]) -> List[str]:
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        return [value for value in (const_str(item) for item in node.elts) if value]
    return []


def constant(node: Optional[ast.AST]) -> Any:
    if isinstance(node, ast.Constant) and isinstance(node.value, (str, int, float, bool)):
        return node.value
    return None


def serializer_field_required(call: ast.Call) -> bool:
    required = keyword(call, "required")
    if isinstance(required, ast.Constant) and isinstance(required.value, bool):
        return required.value
    return not keyword_bool(call, "read_only") and keyword(call, "default") is None


def nullable(schema: Dict[str, Any], call: ast.Call) -> Dict[str, Any]:
    if not keyword_bool(call, "allow_null"):
        return schema
    if isinstance(schema.get("type"), str):
        schema["type"] = [schema["type"], "null"]
    else:
        schema = {"anyOf": [schema, {"type": "null"}]}
    return schema


def serializer_field_schema(call: ast.Call, registry: Registry, module: Module, stack: Set[Tuple[str, str]]) -> Dict[str, Any]:
    kind = dotted(call.func).split(".")[-1]
    if kind in ("IntegerField",):
        schema: Dict[str, Any] = {"type": "integer"}
    elif kind in ("FloatField",):
        schema = {"type": "number", "format": "float"}
    elif kind in ("DecimalField",):
        schema = {"type": "number"}
    elif kind in ("BooleanField", "NullBooleanField"):
        schema = {"type": "boolean"}
    elif kind == "DateTimeField":
        schema = {"type": "string", "format": "date-time"}
    elif kind == "DateField":
        schema = {"type": "string", "format": "date"}
    elif kind == "TimeField":
        schema = {"type": "string", "format": "time"}
    elif kind == "UUIDField":
        schema = {"type": "string", "format": "uuid"}
    elif kind == "EmailField":
        schema = {"type": "string", "format": "email"}
    elif kind == "URLField":
        schema = {"type": "string", "format": "uri"}
    elif kind == "SlugField":
        schema = {"type": "string", "pattern": "^[-a-zA-Z0-9_]+$"}
    elif kind in ("JSONField", "DictField"):
        schema = {"type": "object"}
    elif kind in ("ListField", "ListSerializer", "ManyRelatedField"):
        child = keyword(call, "child") or (call.args[0] if call.args else None)
        item_schema: Dict[str, Any] = {}
        if isinstance(child, ast.Call):
            nested = registry.resolve(module, child.func)
            item_schema = {"$ref": "#/components/schemas/%s" % nested.component} if nested else serializer_field_schema(child, registry, module, stack)
        schema = {"type": "array", "items": item_schema}
    elif kind in ("PrimaryKeyRelatedField", "HyperlinkedRelatedField"):
        schema = {"type": "integer"}
        if keyword_bool(call, "many"):
            schema = {"type": "array", "items": schema}
    elif kind == "ChoiceField":
        schema = {"type": "string"}
        choices = keyword(call, "choices") or (call.args[0] if call.args else None)
        values = literal_choices(choices)
        if values:
            schema["enum"] = values
    elif kind in ("CharField", "RegexField", "FilePathField", "IPField"):
        schema = {"type": "string"}
    else:
        schema = {}
    maximum = keyword_int(call, "max_length")
    minimum = keyword_int(call, "min_length")
    if maximum is not None and schema.get("type") == "string":
        schema["maxLength"] = maximum
    if minimum is not None and schema.get("type") == "string":
        schema["minLength"] = minimum
    help_text = const_str(keyword(call, "help_text"))
    if help_text:
        schema["description"] = help_text
    default = constant(keyword(call, "default"))
    if default is not None:
        schema["default"] = default
    return nullable(schema, call)


def literal_choices(node: Optional[ast.AST]) -> List[Any]:
    if not isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        return []
    out = []
    for item in node.elts:
        if isinstance(item, (ast.List, ast.Tuple)) and item.elts:
            item = item.elts[0]
        value = constant(item)
        if value is not None:
            out.append(value)
    return out


def model_schema(field: domain.FieldDef) -> Tuple[Dict[str, Any], bool]:
    kind = field.kind
    if kind in ("AutoField", "BigAutoField", "IntegerField", "SmallIntegerField", "PositiveIntegerField", "PositiveSmallIntegerField"):
        schema: Dict[str, Any] = {"type": "integer"}
        if kind == "BigAutoField":
            schema["format"] = "int64"
    elif kind == "BigIntegerField":
        schema = {"type": "integer", "format": "int64"}
    elif kind in ("FloatField",):
        schema = {"type": "number", "format": "float"}
    elif kind in ("DecimalField",):
        schema = {"type": "number"}
    elif kind in ("BooleanField", "NullBooleanField"):
        schema = {"type": "boolean"}
    elif kind == "DateTimeField":
        schema = {"type": "string", "format": "date-time"}
    elif kind == "DateField":
        schema = {"type": "string", "format": "date"}
    elif kind == "TimeField":
        schema = {"type": "string", "format": "time"}
    elif kind == "UUIDField":
        schema = {"type": "string", "format": "uuid"}
    elif kind == "EmailField":
        schema = {"type": "string", "format": "email"}
    elif kind == "URLField":
        schema = {"type": "string", "format": "uri"}
    elif kind == "SlugField":
        schema = {"type": "string", "pattern": "^[-a-zA-Z0-9_]+$"}
    elif kind in ("JSONField",):
        schema = {"type": "object"}
    elif kind == "ManyToManyField":
        schema = {"type": "array", "items": {"type": "integer"}}
    elif kind in ("ForeignKey", "OneToOneField"):
        schema = {"type": "integer"}
    else:
        schema = {"type": "string"}
    maximum = keyword_int(field.call, "max_length")
    if maximum is not None and schema.get("type") == "string":
        schema["maxLength"] = maximum
    if field.help():
        schema["description"] = field.help()
    choices = literal_choices(keyword(field.call, "choices"))
    if choices:
        schema["enum"] = choices
    null = keyword_bool(field.call, "null")
    if null:
        if isinstance(schema.get("type"), str):
            schema["type"] = [schema["type"], "null"]
        else:
            schema = {"anyOf": [schema, {"type": "null"}]}
    auto = kind in ("AutoField", "BigAutoField") or keyword_bool(field.call, "primary_key") and keyword(field.call, "default") is not None
    if auto:
        schema["readOnly"] = True
    required = not null and not keyword_bool(field.call, "blank") and keyword(field.call, "default") is None and not auto
    return schema, required


def fallback_model_field(name: str) -> Tuple[Dict[str, Any], bool]:
    if name == "id":
        return {"type": "integer", "readOnly": True}, False
    return {}, False
