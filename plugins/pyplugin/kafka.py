"""Kafka clients in Python source, read without importing the project.

The module deliberately knows client APIs, not framework or repository
conventions.  It is shared by the standalone Kafka extractor and framework
extractors that want to add a proven publish to a larger source-backed flow.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from source import Module, Project, assigned, dotted, keyword, methods


@dataclass(frozen=True)
class Spec:
    library: str
    role: str


CONSTRUCTORS = {
    "confluent_kafka.Producer": Spec("confluent-kafka", "producer"),
    "confluent_kafka.Consumer": Spec("confluent-kafka", "consumer"),
    "confluent_kafka.SerializingProducer": Spec("confluent-kafka", "producer"),
    "confluent_kafka.DeserializingConsumer": Spec("confluent-kafka", "consumer"),
    "kafka.KafkaProducer": Spec("kafka-python", "producer"),
    "kafka.KafkaConsumer": Spec("kafka-python", "consumer"),
    "aiokafka.AIOKafkaProducer": Spec("aiokafka", "producer"),
    "aiokafka.AIOKafkaConsumer": Spec("aiokafka", "consumer"),
}

PUBLISH_METHODS = {
    "confluent-kafka": {"produce"},
    "kafka-python": {"send"},
    "aiokafka": {"send", "send_and_wait"},
}

# Only operational facts safe and useful in generated documentation.  Auth
# values are intentionally absent: recognizing a constructor must never turn
# source credentials into generated output.
CONFIG_KEYS = {
    "bootstrap.servers": "brokers",
    "bootstrap_servers": "brokers",
    "security.protocol": "security protocol",
    "security_protocol": "security protocol",
    "sasl.mechanism": "SASL mechanism",
    "sasl_mechanism": "SASL mechanism",
    "enable.idempotence": "idempotence",
    "enable_idempotence": "idempotence",
    "retries": "retries",
    "compression.type": "compression",
    "compression_type": "compression",
    "compression.level": "compression level",
    "compression_level": "compression level",
    "client.id": "client id",
    "client_id": "client id",
    "group.id": "consumer group",
    "group_id": "consumer group",
    "auto.offset.reset": "offset reset",
    "auto_offset_reset": "offset reset",
    "enable.auto.commit": "auto commit",
    "enable_auto_commit": "auto commit",
    "key_serializer": "key serializer",
    "value_serializer": "value serializer",
    "key_deserializer": "key deserializer",
    "value_deserializer": "value deserializer",
    "key.serializer": "key serializer",
    "value.serializer": "value serializer",
    "key.deserializer": "key deserializer",
    "value.deserializer": "value deserializer",
}

SERDE_KEYS = {
    "key_serializer",
    "value_serializer",
    "key_deserializer",
    "value_deserializer",
    "key.serializer",
    "value.serializer",
    "key.deserializer",
    "value.deserializer",
}


@dataclass
class Client:
    library: str
    role: str
    config: Dict[str, Any] = field(default_factory=dict)
    source: str = ""
    constructor_topics: List[str] = field(default_factory=list)

    @property
    def encoding(self) -> str:
        return encoding_of_text(" ".join(str(self.config.get(key, "")) for key in ("value serializer", "value deserializer")))


@dataclass
class Publish:
    module: Module
    node: ast.Call
    entrypoint: str
    client: Client
    topic: str
    topic_expression: str
    message: str
    message_expression: str
    key: str = ""
    headers: str = ""
    encoding: str = ""

    @property
    def line(self) -> str:
        return self.module.where(self.node)


@dataclass
class Subscription:
    module: Module
    node: ast.AST
    entrypoint: str
    client: Client
    topic: str
    topic_expression: str

    @property
    def line(self) -> str:
        return self.module.where(self.node)


@dataclass
class Result:
    publishes: List[Publish] = field(default_factory=list)
    subscriptions: List[Subscription] = field(default_factory=list)
    dynamic_topics: List[Tuple[str, str]] = field(default_factory=list)


def external_name(module: Module, name: str) -> str:
    """Resolve the imported first segment of a dotted expression."""
    if not name:
        return ""
    parts = name.split(".")
    imported = module.imports.get(parts[0])
    if imported is None:
        return name
    base = imported.module if imported.name == "*" else imported.module + "." + imported.name
    return ".".join([base] + parts[1:])


def expression(node: Optional[ast.AST]) -> str:
    if node is None:
        return ""
    try:
        return " ".join(ast.unparse(node).split())  # type: ignore[attr-defined]
    except Exception:
        return dotted(node)


def _module_assignment(module: Module, name: str) -> Optional[ast.AST]:
    return next((value for candidate, value, _ in assigned(module.tree) if candidate == name), None)


def value(
    project: Project,
    module: Module,
    node: Optional[ast.AST],
    settings: str = "",
    variables: Optional[Dict[str, Tuple[str, object]]] = None,
    depth: int = 0,
) -> Any:
    """Resolve safe scalar/list/dict values as far as syntax proves them."""
    if node is None or depth > 8:
        return None
    variables = variables or {}
    if isinstance(node, ast.Constant) and isinstance(node.value, (str, int, float, bool)):
        return node.value
    if isinstance(node, ast.Name):
        bound = variables.get(node.id)
        if bound is not None and bound[0] == "value":
            return bound[1]
        assigned_node = _module_assignment(module, node.id)
        if assigned_node is not None and assigned_node is not node:
            return value(project, module, assigned_node, settings, variables, depth + 1)
        hit = project.resolve(module, node.id)
        if hit is not None and hit[0] is not module:
            return value(project, hit[0], ast.Name(id=hit[1]), settings, variables, depth + 1)
        return None
    if isinstance(node, ast.Attribute):
        name = dotted(node)
        bound = variables.get(name)
        if bound is not None and bound[0] == "value":
            return bound[1]
        if name.startswith("settings.") and name.count(".") == 1:
            settings_module = project.module(settings) if settings else None
            if settings_module is not None:
                return value(project, settings_module, ast.Name(id=name.split(".")[1]), settings, {}, depth + 1)
        return None
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        items = [value(project, module, item, settings, variables, depth + 1) for item in node.elts]
        return items if all(item is not None for item in items) else None
    if isinstance(node, ast.Dict):
        out: Dict[str, Any] = {}
        for key_node, val_node in zip(node.keys, node.values):
            key = value(project, module, key_node, settings, variables, depth + 1)
            val = value(project, module, val_node, settings, variables, depth + 1)
            if val is None and isinstance(key, str) and key in SERDE_KEYS:
                val = serialization_expression(module, val_node, variables)
            if not isinstance(key, str) or val is None:
                continue
            out[key] = val
        return out
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left = value(project, module, node.left, settings, variables, depth + 1)
        right = value(project, module, node.right, settings, variables, depth + 1)
        if isinstance(left, str) and isinstance(right, str):
            return left + right
        return None
    if isinstance(node, ast.JoinedStr):
        chunks: List[str] = []
        for item in node.values:
            if isinstance(item, ast.Constant) and isinstance(item.value, str):
                chunks.append(item.value)
            elif isinstance(item, ast.FormattedValue):
                inner = value(project, module, item.value, settings, variables, depth + 1)
                if inner is None:
                    return None
                chunks.append(str(inner))
        return "".join(chunks)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        inner = value(project, module, node.operand, settings, variables, depth + 1)
        return -inner if isinstance(inner, (int, float)) else None
    if isinstance(node, ast.IfExp):
        condition = value(project, module, node.test, settings, variables, depth + 1)
        if isinstance(condition, bool):
            branch = node.body if condition else node.orelse
            return value(project, module, branch, settings, variables, depth + 1)
        left = value(project, module, node.body, settings, variables, depth + 1)
        right = value(project, module, node.orelse, settings, variables, depth + 1)
        return left if left == right else None
    if isinstance(node, ast.Call):
        name = external_name(module, dotted(node.func))
        last = name.split(".")[-1]
        if last in ("get", "getenv") and (name.startswith("os.environ") or name == "os.getenv"):
            default = node.args[1] if len(node.args) > 1 else keyword(node, "default")
            return value(project, module, default, settings, variables, depth + 1)
        if last in ("env", "str", "bool", "int") and dotted(node.func).split(".")[0] in ("env", "environ", "config"):
            default = node.args[1] if len(node.args) > 1 else keyword(node, "default")
            return value(project, module, default, settings, variables, depth + 1)
        if name in ("str", "int", "float", "bool") and node.args:
            inner = value(project, module, node.args[0], settings, variables, depth + 1)
            if inner is None:
                return None
            try:
                return {"str": str, "int": int, "float": float, "bool": bool}[name](inner)
            except (TypeError, ValueError):
                return None
    return None


def _config_values(project: Project, module: Module, call: ast.Call, settings: str, variables) -> Dict[str, Any]:
    raw: Dict[str, Any] = {}
    if call.args:
        first = value(project, module, call.args[0], settings, variables)
        if isinstance(first, dict):
            raw.update(first)
        # Callable serializer values are not safe scalar values, but their
        # syntax is still the evidence needed to identify MessagePack.
        if isinstance(call.args[0], ast.Dict):
            for key_node, val_node in zip(call.args[0].keys, call.args[0].values):
                key = value(project, module, key_node, settings, variables)
                if isinstance(key, str) and key in SERDE_KEYS and key not in raw:
                    raw[key] = serialization_expression(module, val_node, variables)
    for kw in call.keywords:
        if not kw.arg:
            continue
        resolved = value(project, module, kw.value, settings, variables)
        if resolved is not None:
            raw[kw.arg] = resolved
        elif kw.arg in SERDE_KEYS:
            raw[kw.arg] = serialization_expression(module, kw.value, variables)
    out: Dict[str, Any] = {}
    for key, val in raw.items():
        normalized = CONFIG_KEYS.get(key)
        if normalized:
            out[normalized] = val
    return out


def constructed(
    project: Project,
    module: Module,
    node: ast.AST,
    settings: str = "",
    variables: Optional[Dict[str, Tuple[str, object]]] = None,
    depth: int = 0,
) -> Optional[Client]:
    """A supported Kafka constructor, including a local zero-cost factory."""
    if not isinstance(node, ast.Call) or depth > 5:
        return None
    spec = CONSTRUCTORS.get(external_name(module, dotted(node.func)))
    if spec is not None:
        topics: List[str] = []
        if spec.role == "consumer" and spec.library in ("kafka-python", "aiokafka"):
            for arg in node.args:
                resolved = value(project, module, arg, settings, variables)
                if isinstance(resolved, str):
                    topics.append(resolved)
                elif isinstance(resolved, list):
                    topics.extend(str(item) for item in resolved if isinstance(item, str))
        return Client(
            spec.library,
            spec.role,
            _config_values(project, module, node, settings, variables or {}),
            module.where(node),
            topics,
        )

    # A project factory is still proof of the library when one supported
    # constructor is reachable in its return path.  This catches singleton
    # factories without attaching meaning to their class or method names.
    target = _callable(project, module, node.func)
    if target is None:
        return None
    target_module, fn = target
    local: Dict[str, Tuple[str, object]] = {}
    parameters = list(getattr(fn.args, "posonlyargs", [])) + list(fn.args.args)
    if parameters and parameters[0].arg in ("self", "cls"):
        parameters = parameters[1:]
    for parameter, arg in zip(parameters, node.args):
        resolved = value(project, module, arg, settings, variables)
        if resolved is not None:
            local[parameter.arg] = ("value", resolved)
    for child in ast.walk(fn):
        if isinstance(child, ast.Assign):
            resolved = value(project, target_module, child.value, settings, local)
            if resolved is not None:
                for assignment_target in child.targets:
                    assignment_name = dotted(assignment_target)
                    if assignment_name:
                        local[assignment_name] = ("value", resolved)
        elif isinstance(child, ast.AnnAssign) and child.value is not None:
            resolved = value(project, target_module, child.value, settings, local)
            assignment_name = dotted(child.target)
            if resolved is not None and assignment_name:
                local[assignment_name] = ("value", resolved)
        if isinstance(child, ast.Call):
            found = constructed(project, target_module, child, settings, local, depth + 1)
            if found is not None:
                return found
    return None


def _callable(project: Project, module: Module, func: ast.AST) -> Optional[Tuple[Module, ast.AST]]:
    name = dotted(func)
    parts = name.split(".") if name else []
    if not parts:
        return None
    if len(parts) == 1:
        hit = project.resolve(module, name)
        if hit is None:
            return None
        fn = next((item for item in hit[0].functions() if item.name == hit[1]), None)
        return (hit[0], fn) if fn is not None else None
    # Local/imported class method.
    class_name, method_name = parts[-2], parts[-1]
    class_module = module
    resolved_class = class_name
    imported = module.imports.get(parts[0])
    if imported is not None:
        if len(parts) == 2 and imported.name != "*":
            class_module = project.module(imported.module) or module
            resolved_class = imported.name
        else:
            base = imported.module if imported.name == "*" else imported.module + "." + imported.name
            class_module = project.module(".".join([base] + parts[1:-2])) or module
    cls = next((item for item in class_module.classes() if item.name == resolved_class), None)
    if cls is not None:
        fn = next((item for item in methods(cls) if item.name == method_name), None)
        return (class_module, fn) if fn is not None else None
    # Imported module function: pkg.helper(...).
    if imported is not None:
        base = imported.module if imported.name == "*" else imported.module + "." + imported.name
        target_module = project.module(".".join([base] + parts[1:-1]))
        if target_module is not None:
            fn = next((item for item in target_module.functions() if item.name == method_name), None)
            return (target_module, fn) if fn is not None else None
    return None


def topic_node(call: ast.Call) -> Optional[ast.AST]:
    return keyword(call, "topic") or (call.args[0] if call.args else None)


def payload_node(call: ast.Call) -> Optional[ast.AST]:
    return keyword(call, "value") or (call.args[1] if len(call.args) > 1 else None)


def payload_name(node: Optional[ast.AST], variables: Optional[Dict[str, Tuple[str, object]]] = None, depth: int = 0) -> str:
    if node is None or depth > 6:
        return "message"
    variables = variables or {}
    if isinstance(node, ast.Name):
        bound = variables.get(node.id)
        if bound is not None and bound[0] == "expr" and isinstance(bound[1], ast.AST):
            return payload_name(bound[1], variables, depth + 1)
        if bound is not None and bound[0] == "event":
            return str(bound[1]).rsplit(".", 1)[-1]
        return node.id
    if isinstance(node, ast.Call):
        last = dotted(node.func).split(".")[-1]
        if last in ("dumps", "dump", "encode", "serialize", "SerializeToString", "asdict", "dict", "model_dump", "pack", "packb") and node.args:
            return payload_name(node.args[0], variables, depth + 1)
        return last or "message"
    if isinstance(node, ast.Attribute):
        return node.attr
    if isinstance(node, ast.Dict):
        return "message"
    return "message"


def encoding_of_text(text: str) -> str:
    lowered = text.lower()
    if "msgpack" in lowered or "messagepack" in lowered:
        return "msgpack"
    return ""


def serialization_expression(module: Optional[Module], node: Optional[ast.AST], variables: Optional[Dict[str, Tuple[str, object]]] = None) -> str:
    if node is None:
        return ""
    parts = [expression(node)]
    if module is not None:
        parts.append(external_name(module, dotted(node.func) if isinstance(node, ast.Call) else dotted(node)))
    owner = node.func.value if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) else (node.value if isinstance(node, ast.Attribute) else None)
    if isinstance(owner, ast.Name):
        bound = (variables or {}).get(owner.id)
        if bound is not None and bound[0] == "expr" and isinstance(bound[1], ast.AST):
            parts.append(expression(bound[1]))
    return " ".join(filter(None, parts))


def payload_encoding(
    node: Optional[ast.AST],
    variables: Optional[Dict[str, Tuple[str, object]]] = None,
    depth: int = 0,
    module: Optional[Module] = None,
) -> str:
    if node is None or depth > 6:
        return ""
    variables = variables or {}
    if isinstance(node, ast.Name):
        bound = variables.get(node.id)
        if bound is not None and bound[0] == "expr" and isinstance(bound[1], ast.AST):
            return payload_encoding(bound[1], variables, depth + 1, module)
    return encoding_of_text(serialization_expression(module, node, variables))


def _text(node: Optional[ast.AST]) -> str:
    text = expression(node)
    return text if len(text) <= 100 else text[:97] + "..."


class Scanner:
    def __init__(self, project: Project, settings: str = ""):
        self.project = project
        self.settings = settings
        self.result = Result()
        self._seen_publish: Set[Tuple[str, int, str]] = set()
        self._seen_subscription: Set[Tuple[str, int, str]] = set()

    def scan(self) -> Result:
        for module in sorted(self.project.modules.values(), key=lambda item: item.rel):
            module_env = self._initial(module, module.tree)
            self._walk(module, module.tree.body, module_env, "python:%s" % module.dotted)
            for fn in module.functions():
                self._walk(module, fn.body, dict(module_env), "python:%s:%s" % (module.dotted, fn.name))
            for cls in module.classes():
                class_env = dict(module_env)
                class_env.update(self._initial(module, cls))
                for fn in methods(cls):
                    self._walk(module, fn.body, dict(class_env), "python:%s:%s.%s" % (module.dotted, cls.name, fn.name))
        self.result.publishes.sort(key=lambda item: (item.module.rel, item.node.lineno, item.topic))
        self.result.subscriptions.sort(key=lambda item: (item.module.rel, getattr(item.node, "lineno", 0), item.topic))
        return self.result

    def _initial(self, module: Module, owner: ast.AST) -> Dict[str, Tuple[str, object]]:
        env: Dict[str, Tuple[str, object]] = {}
        for name, node, _ in assigned(owner):
            client = constructed(self.project, module, node, self.settings, env)
            if client is not None:
                env[name] = ("kafka", client)
                if isinstance(owner, ast.ClassDef):
                    env["self." + name] = ("kafka", client)
                    env["cls." + name] = ("kafka", client)
                continue
            resolved = value(self.project, module, node, self.settings, env)
            env[name] = ("value", resolved) if resolved is not None else ("expr", node)
        return env

    def _bind(self, env: Dict[str, Tuple[str, object]], target: ast.AST, binding: Optional[Tuple[str, object]]) -> None:
        if binding is None:
            return
        name = dotted(target)
        if name:
            env[name] = binding

    def _binding(self, module: Module, node: ast.AST, env) -> Optional[Tuple[str, object]]:
        if isinstance(node, ast.Await):
            return self._binding(module, node.value, env)
        if isinstance(node, (ast.Name, ast.Attribute)):
            name = dotted(node)
            return env.get(name) or env.get(name.split(".")[0])
        client = constructed(self.project, module, node, self.settings, env)
        if client is not None:
            return ("kafka", client)
        resolved = value(self.project, module, node, self.settings, env)
        return ("value", resolved) if resolved is not None else ("expr", node)

    def _walk(self, module: Module, body: Iterable[ast.AST], env, entrypoint: str) -> None:
        for stmt in body:
            if isinstance(stmt, ast.Assign):
                binding = self._binding(module, stmt.value, env)
                for target in stmt.targets:
                    self._bind(env, target, binding)
                self._call(module, stmt.value, env, entrypoint)
            elif isinstance(stmt, ast.AnnAssign) and stmt.value is not None:
                self._bind(env, stmt.target, self._binding(module, stmt.value, env))
                self._call(module, stmt.value, env, entrypoint)
            elif isinstance(stmt, ast.Expr):
                self._call(module, stmt.value, env, entrypoint)
            elif isinstance(stmt, ast.Return) and stmt.value is not None:
                self._call(module, stmt.value, env, entrypoint)
            elif isinstance(stmt, (ast.If, ast.While, ast.For, ast.AsyncFor)):
                if isinstance(stmt, ast.If):
                    self._call(module, stmt.test, env, entrypoint)
                elif isinstance(stmt, ast.While):
                    self._call(module, stmt.test, env, entrypoint)
                else:
                    self._call(module, stmt.iter, env, entrypoint)
                self._walk(module, stmt.body, dict(env), entrypoint)
                self._walk(module, stmt.orelse, dict(env), entrypoint)
            elif isinstance(stmt, (ast.With, ast.AsyncWith)):
                for item in stmt.items:
                    self._call(module, item.context_expr, env, entrypoint)
                self._walk(module, stmt.body, dict(env), entrypoint)
            elif isinstance(stmt, ast.Try):
                self._walk(module, stmt.body, dict(env), entrypoint)
                self._walk(module, stmt.orelse, dict(env), entrypoint)
                self._walk(module, stmt.finalbody, dict(env), entrypoint)
                for handler in stmt.handlers:
                    self._walk(module, handler.body, dict(env), entrypoint)

    def _call(self, module: Module, node: ast.AST, env, entrypoint: str) -> None:
        if isinstance(node, ast.Await):
            self._call(module, node.value, env, entrypoint)
            return
        if not isinstance(node, ast.Call):
            return
        holder = self._binding(module, node.func.value, env) if isinstance(node.func, ast.Attribute) else None
        if holder is not None and holder[0] == "kafka":
            client: Client = holder[1]  # type: ignore[assignment]
            method = node.func.attr
            if client.role == "producer" and method in PUBLISH_METHODS.get(client.library, set()):
                self._publish(module, node, env, entrypoint, client)
            elif client.role == "consumer" and method == "subscribe":
                topics_node = node.args[0] if node.args else keyword(node, "topics")
                topics = value(self.project, module, topics_node, self.settings, env)
                if isinstance(topics, str):
                    topics = [topics]
                if isinstance(topics, list):
                    for topic in topics:
                        if isinstance(topic, str):
                            self._subscription(module, node, entrypoint, client, topic, _text(topics_node))
                else:
                    self.result.dynamic_topics.append((module.where(node), _text(topics_node)))
        client = constructed(self.project, module, node, self.settings, env)
        if client is not None and client.role == "consumer":
            for topic in client.constructor_topics:
                self._subscription(module, node, entrypoint, client, topic, topic)
        # Calls nested in chains and arguments can themselves construct or use
        # a client; visit them without interpreting arbitrary project code.
        if isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Call):
            self._call(module, node.func.value, env, entrypoint)
        for arg in node.args:
            self._call(module, arg, env, entrypoint)
        for kw in node.keywords:
            self._call(module, kw.value, env, entrypoint)

    def _publish(self, module: Module, call: ast.Call, env, entrypoint: str, client: Client) -> None:
        topic_ast = topic_node(call)
        resolved = value(self.project, module, topic_ast, self.settings, env)
        if not isinstance(resolved, str) or not resolved:
            self.result.dynamic_topics.append((module.where(call), _text(topic_ast)))
            return
        key = (module.rel, call.lineno, resolved)
        if key in self._seen_publish:
            return
        self._seen_publish.add(key)
        payload = payload_node(call)
        self.result.publishes.append(
            Publish(
                module,
                call,
                entrypoint,
                client,
                resolved,
                _text(topic_ast),
                payload_name(payload, env),
                _text(payload),
                _text(keyword(call, "key")),
                _text(keyword(call, "headers")),
                payload_encoding(payload, env, module=module) or client.encoding,
            )
        )

    def _subscription(self, module: Module, node: ast.AST, entrypoint: str, client: Client, topic: str, topic_expr: str) -> None:
        key = (module.rel, getattr(node, "lineno", 0), topic)
        if key in self._seen_subscription:
            return
        self._seen_subscription.add(key)
        self.result.subscriptions.append(Subscription(module, node, entrypoint, client, topic, topic_expr))


def scan(project: Project, settings: str = "") -> Result:
    return Scanner(project, settings).scan()


def config_note(client: Client) -> str:
    parts = ["client: %s" % client.library]
    for key in sorted(client.config):
        val = client.config[key]
        if isinstance(val, list):
            text = ", ".join(str(item) for item in val)
        elif isinstance(val, bool):
            text = "enabled" if val else "disabled"
        else:
            text = str(val)
        parts.append("%s: %s" % (key, text))
    return "; ".join(parts)
