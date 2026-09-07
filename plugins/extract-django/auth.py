"""Who may call an endpoint, read off DRF's permission and authentication
classes and written into the inferred OpenAPI document as `security`.

DRF decides both per view, and the reader follows the same order the
framework does: the handler's own `@action(permission_classes=...)` or the
function's `@permission_classes(...)`, then a `get_permissions()` that a
`self.action` branch can decide, then the class attribute - its own or one a
local base class declares - and past all of those `REST_FRAMEWORK` in the
settings module, and past that DRF's own defaults, which are session or
basic authentication and `AllowAny`. `authentication_classes` is read the
same way.

What is written is OpenAPI's, not DRF's. An authentication class becomes a
security scheme - `SessionAuthentication` a cookie, `TokenAuthentication` an
`Authorization` header, `JWTAuthentication` a bearer token - and the
permission classes decide whether an operation requires one of them, accepts
one optionally, or takes nobody's name. A permission this reader does not
know - a project's own `IsOwner` - is not guessed at: the operation gets no
`security` of its own, its classes are still written under
`x-portolan-permissions`, and the diagnostic says which class it was.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from celery_conf import follow, settings_module_name
from serializers import resolve_symbol, selected_return
from source import Module, Project, assigned, const_str, dotted, keyword

# DRF's authentication classes and the common third-party ones, to the
# security scheme OpenAPI writes them as. The id is what the operations refer
# to, and it is the one drf-spectacular gives the same class, so a document a
# project generates at runtime and this one agree on the name.
AUTHENTICATION: Dict[str, Tuple[str, Dict[str, Any]]] = {
    "SessionAuthentication": ("cookieAuth", {"type": "apiKey", "in": "cookie", "name": "sessionid"}),
    "BasicAuthentication": ("basicAuth", {"type": "http", "scheme": "basic"}),
    "TokenAuthentication": (
        "tokenAuth",
        {"type": "apiKey", "in": "header", "name": "Authorization", "description": "Token-based authentication with required prefix \"Token\"."},
    ),
    "JWTAuthentication": ("jwtAuth", {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"}),
    "JWTStatelessUserAuthentication": ("jwtAuth", {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"}),
    "JSONWebTokenAuthentication": ("jwtAuth", {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"}),
    "OAuth2Authentication": (
        "oauth2",
        {"type": "oauth2", "flows": {}, "description": "OAuth 2.0 bearer token; the flows are configured at runtime and are not recoverable from source."},
    ),
}

# DRF's own permissions, by what they say about who may call.
PUBLIC = {"AllowAny"}
REQUIRED = {"IsAuthenticated", "IsAdminUser", "DjangoModelPermissions", "DjangoObjectPermissions"}
READ_OPTIONAL = {"IsAuthenticatedOrReadOnly", "DjangoModelPermissionsOrAnonReadOnly"}
SAFE_VERBS = {"GET", "HEAD", "OPTIONS"}

# What DRF applies when the settings say nothing.
DEFAULT_AUTHENTICATION = ["SessionAuthentication", "BasicAuthentication"]
DEFAULT_PERMISSION = ["AllowAny"]


@dataclass
class Security:
    """What one operation says about its caller."""

    # The OpenAPI `security` requirement, or None when it could not be decided.
    requirement: Optional[List[Dict[str, List[str]]]]
    # The permission classes as the code names them, for `x-portolan-permissions`.
    permissions: List[str] = field(default_factory=list)
    # The schemes the requirement refers to, for `components.securitySchemes`.
    schemes: Dict[str, Dict[str, Any]] = field(default_factory=dict)


class Registry:
    def __init__(self, project: Project, settings: str, b) -> None:
        self.project = project
        self.b = b
        self.default_authentication, self.default_permission = read_defaults(project, settings)
        self.schemes: Dict[str, Dict[str, Any]] = {}
        self._warned: set = set()

    # --- what the document says at the top ---------------------------------

    def default_security(self) -> Optional[List[Dict[str, List[str]]]]:
        """The document-level requirement: what an operation the settings
        alone decide would carry, for a POST."""
        decided = self.decide(self.default_authentication, self.default_permission, "POST", "")
        return decided.requirement

    # --- what one operation says -------------------------------------------

    def security_for(self, endpoint) -> Security:
        declared = declared_security(endpoint)
        if declared is not None:
            return self.schemes_of(declared)
        authentication = self.classes_for(endpoint, "authentication_classes", "get_authenticators")
        if authentication is None:
            authentication = list(self.default_authentication)
        permission = self.classes_for(endpoint, "permission_classes", "get_permissions")
        if permission is None:
            permission = list(self.default_permission)
        if UNRESOLVED in authentication or UNRESOLVED in permission:
            names = [name for name in permission if name is not UNRESOLVED]
            self.warn(endpoint.route_source or endpoint.module.rel, "%s builds its permission or authentication classes in a way this reader cannot follow; the operation carries no security of its own" % endpoint.id)
            return Security(None, names)
        return self.decide(authentication, permission, endpoint.verb.upper(), endpoint.route_source or endpoint.module.rel)

    def decide(self, authentication: List[str], permission: List[str], verb: str, where: str) -> Security:
        schemes: Dict[str, Dict[str, Any]] = {}
        for name in authentication:
            scheme_id, scheme = self.scheme_of(name, where)
            schemes[scheme_id] = scheme
        self.schemes.update(schemes)
        unknown = [name for name in permission if name not in PUBLIC and name not in REQUIRED and name not in READ_OPTIONAL]
        if unknown:
            for name in unknown:
                self.warn(where, "%s is not a DRF permission this reader knows, so whether the endpoint needs a caller is not said; the class is kept under x-portolan-permissions" % name)
            return Security(None, list(permission), schemes)
        # DRF's permission list is a conjunction, and its authentication list
        # is tried in order until one answers, so the requirement is one
        # alternative per scheme - and an empty one when nobody is needed.
        required = any(name in REQUIRED for name in permission) or (verb not in SAFE_VERBS and any(name in READ_OPTIONAL for name in permission))
        requirement = [{scheme_id: []} for scheme_id in schemes]
        if required and not requirement:
            self.warn(where, "the endpoint requires an authenticated caller but declares no authentication class: nobody can call it")
        if not required and requirement:
            requirement.append({})
        return Security(requirement, list(permission), schemes)

    def schemes_of(self, declared: List[Dict[str, List[str]]]) -> Security:
        """A requirement the schema decorator spelled out, in OpenAPI's own
        words; the schemes it names are the document's to declare."""
        known = {scheme_id: scheme for _, (scheme_id, scheme) in AUTHENTICATION.items()}
        schemes = {}
        for alternative in declared:
            for scheme_id in alternative:
                if scheme_id in known:
                    schemes[scheme_id] = known[scheme_id]
        self.schemes.update(schemes)
        return Security(declared, [], schemes)

    def scheme_of(self, name: str, where: str) -> Tuple[str, Dict[str, Any]]:
        if name in AUTHENTICATION:
            scheme_id, scheme = AUTHENTICATION[name]
            return scheme_id, dict(scheme)
        self.warn(where, "%s is not a DRF authentication class this reader knows; it is written as a security scheme of its own, and how the credential travels is not said" % name)
        scheme_id = name[0].lower() + name[1:] if name else "customAuth"
        return scheme_id, {
            "type": "http",
            "scheme": "unknown",
            "description": "%s: a custom authentication class. How the credential travels is not recoverable from source." % name,
            "x-portolan-inferred": True,
        }

    # --- where the classes come from ---------------------------------------

    def classes_for(self, endpoint, attribute: str, selector: str) -> Optional[List[Any]]:
        """The classes in force for this endpoint, in DRF's order of
        precedence, or None when nothing but the settings says."""
        node = endpoint.node
        module = endpoint.module
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for decorator in node.decorator_list:
                if not isinstance(decorator, ast.Call):
                    continue
                last = dotted(decorator.func).split(".")[-1]
                if last == attribute and decorator.args:
                    return class_names(decorator.args[0], module)
                if last == "action" and keyword(decorator, attribute) is not None:
                    return class_names(keyword(decorator, attribute), module)
        view = view_class(endpoint)
        if view is None:
            return None
        chosen = next((m for m in view.body if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)) and m.name == selector), None)
        if chosen is not None:
            selected = selected_return(chosen.body, endpoint.action)
            if selected is None:
                return [UNRESOLVED]
            return class_names(selected, module)
        found = self.class_attribute(module, view, attribute, 0)
        if found is None:
            return None
        value, owner = found
        return class_names(value, owner)

    def class_attribute(self, module: Module, node: ast.ClassDef, attribute: str, depth: int) -> Optional[Tuple[ast.AST, Module]]:
        """The attribute as this class or a local base of it assigns it."""
        for name, value, _ in assigned(node):
            if name == attribute:
                return value, module
        if depth > 5:
            return None
        for base in node.bases:
            name = dotted(base)
            if not name:
                continue
            target_module, target_name = resolve_symbol(self.project, module, name)
            target = self.project.module(target_module) if target_module else None
            if target is None:
                continue
            base_node = next((c for c in target.classes() if c.name == target_name.split(".")[-1]), None)
            if base_node is None:
                continue
            found = self.class_attribute(target, base_node, attribute, depth + 1)
            if found is not None:
                return found
        return None

    def warn(self, where: str, message: str) -> None:
        if (where, message) in self._warned:
            return
        self._warned.add((where, message))
        self.b.warn(where, message)


# A class expression syntax does not name, kept apart from every real name.
UNRESOLVED = object()


def view_class(endpoint) -> Optional[ast.ClassDef]:
    if not endpoint.view:
        return None
    name = endpoint.view.split(".", 1)[0]
    return next((node for node in endpoint.module.classes() if node.name == name), None)


def class_names(value: Optional[ast.AST], module: Module) -> List[Any]:
    """`[IsAuthenticated, perms.IsOwner()]` as the class names it lists; an
    element that is not a name - `IsAuthenticated | ReadOnly` - is UNRESOLVED."""
    value = follow(value, module)
    if not isinstance(value, (ast.List, ast.Tuple)):
        return [UNRESOLVED]
    out: List[Any] = []
    for element in value.elts:
        target = element.func if isinstance(element, ast.Call) else element
        name = dotted(target).split(".")[-1]
        out.append(name if name else UNRESOLVED)
    return out


def declared_security(endpoint) -> Optional[List[Dict[str, List[str]]]]:
    """`extend_schema(auth=[...])` or `swagger_auto_schema(security=[...])`
    on the handler: the requirement as the author wrote it, when it is
    written as literals."""
    node = endpoint.node
    if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        return None
    for decorator in node.decorator_list:
        if not isinstance(decorator, ast.Call):
            continue
        last = dotted(decorator.func).split(".")[-1]
        value = keyword(decorator, "auth") if last == "extend_schema" else keyword(decorator, "security") if last == "swagger_auto_schema" else None
        if value is None:
            continue
        if not isinstance(value, (ast.List, ast.Tuple)):
            return None
        out: List[Dict[str, List[str]]] = []
        for element in value.elts:
            if isinstance(element, ast.Dict):
                alternative: Dict[str, List[str]] = {}
                for key, scopes in zip(element.keys, element.values):
                    scheme_id = const_str(key)
                    if not scheme_id or not isinstance(scopes, (ast.List, ast.Tuple)):
                        return None
                    alternative[scheme_id] = [const_str(scope) for scope in scopes.elts]
                out.append(alternative)
            elif const_str(element):
                out.append({const_str(element): []})
            else:
                return None
        return out
    return None


def read_defaults(project: Project, settings: str) -> Tuple[List[str], List[str]]:
    """`REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"]` and
    `["DEFAULT_PERMISSION_CLASSES"]` off the settings module, as class names;
    DRF's own defaults where the settings say nothing."""
    authentication = list(DEFAULT_AUTHENTICATION)
    permission = list(DEFAULT_PERMISSION)
    module = project.module(settings or settings_module_name(project))
    if module is None:
        return authentication, permission
    config: Optional[ast.AST] = None
    for name, value, _ in assigned(module.tree):
        if name == "REST_FRAMEWORK":
            config = follow(value, module)
    if not isinstance(config, ast.Dict):
        return authentication, permission
    for key, value in zip(config.keys, config.values):
        setting = const_str(key) if key is not None else ""
        value = follow(value, module)
        if setting not in ("DEFAULT_AUTHENTICATION_CLASSES", "DEFAULT_PERMISSION_CLASSES") or not isinstance(value, (ast.List, ast.Tuple)):
            continue
        names = [const_str(element).split(".")[-1] for element in value.elts if const_str(element)]
        if setting == "DEFAULT_AUTHENTICATION_CLASSES":
            authentication = names
        else:
            permission = names
    return authentication, permission
