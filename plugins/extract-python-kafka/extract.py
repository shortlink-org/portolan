"""Python Kafka client calls in, generic message channels and flows out."""

from __future__ import annotations

import json
import os
from collections import defaultdict
from typing import Any, Dict, List

import catalog
import kafka
from names import slug, title
from options import Options
from protocol import Builder, File, Input
from source import Project

MESSAGE = "message"


def extract(input_: Input, opts: Options, b: Builder, cwd: str = "") -> None:
    cwd = cwd or os.getcwd()
    root = os.path.abspath(os.path.join(cwd, input_.root))

    def rel(path: str) -> str:
        return os.path.relpath(path, cwd).replace(os.sep, "/")

    source = os.path.normpath(os.path.join(root, opts.source or "."))
    context = opts.context or os.path.basename(root)
    service = opts.service or os.path.basename(root)
    svc_id = context + "." + service
    project = Project(root, source, rel)
    for path, message in project.broken:
        b.warn(path, "cannot be parsed, so nothing in it is read: %s" % message)

    found = kafka.scan(project, opts.settings)
    if not found.publishes and not found.subscriptions:
        b.warn(svc_id, "no supported Python Kafka producer or consumer calls under %s" % rel(source))
    for where, expr in sorted(set(found.dynamic_topics)):
        b.warn(where, "Kafka topic is dynamic%s, so no channel is invented" % ((": `%s`" % expr) if expr else ""))
    clients = [item.client for item in found.publishes] + [item.client for item in found.subscriptions]
    for source_line in sorted({client.source for client in clients if "brokers" not in client.config}):
        b.warn(source_line or svc_id, "Kafka broker endpoints are resolved at runtime, so none are claimed in the catalog")

    sends = defaultdict(list)
    receives = defaultdict(list)
    for item in found.publishes:
        sends[item.topic].append(item)
    for item in found.subscriptions:
        receives[item.topic].append(item)
    for topic in sorted(set(sends) - set(receives)):
        b.warn(svc_id, "publishes Kafka topic `%s`, but no consumer for it is proven in this source tree" % topic)

    channels = [channel(topic, sends[topic], receives[topic]) for topic in sorted(set(sends) | set(receives))]
    flows = []
    for topic in sorted(sends):
        for index, item in enumerate(sends[topic], 1):
            flows.append(publish_flow(context, service, svc_id, item, index))
    for topic in sorted(receives):
        received_message = sends[topic][0].message if len({item.message for item in sends[topic]}) == 1 else "message"
        for index, item in enumerate(receives[topic], 1):
            flows.append(receive_flow(context, service, svc_id, item, received_message, index))
    flows.sort(key=lambda flow: flow["slug"])

    fragment: Dict[str, Any] = {
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
                        "channels": channels,
                    }
                ],
            }
        ],
        "defs": {},
        "flows": flows,
        "adrs": [],
    }
    b.files.append(File(name=opts.out or "kafka.json", contents=json.dumps(fragment, indent=2, ensure_ascii=False) + "\n"))


def channel(topic: str, sends: List[kafka.Publish], receives: List[kafka.Subscription]) -> Dict[str, Any]:
    messages = []
    seen = set()
    for item in sends:
        key = (item.message, "send")
        if key not in seen:
            messages.append(catalog.message(item.message, title(item.message), message_doc(item), "send", item.encoding))
            seen.add(key)
    for item in receives:
        # Kafka subscriptions dispatch records, and source often does not prove
        # their schema. Match a single proven producer name; otherwise stay
        # honest and call the record a message.
        name = sends[0].message if len({sent.message for sent in sends}) == 1 else "message"
        key = (name, "receive")
        if key not in seen:
            messages.append(catalog.message(name, title(name), consumer_doc(item), "receive", item.client.encoding))
            seen.add(key)
    clients = []
    for item in list(sends) + list(receives):
        note = kafka.config_note(item.client)
        if note not in clients:
            clients.append(note)
    doc = "Kafka message stream. " + ". ".join(clients) + ". Broker-side partitions, replication and retention are not declared by client code."
    source = (sends[0].line if sends else receives[0].line) if sends or receives else ""
    return catalog.channel(topic, MESSAGE, "Kafka · " + topic, doc, messages, source)


def message_doc(item: kafka.Publish) -> str:
    bits = ["Published with %s" % item.client.library]
    if item.message_expression:
        bits.append("payload `%s`" % item.message_expression)
    if item.key:
        bits.append("key `%s`" % item.key)
    if item.headers:
        bits.append("headers `%s`" % item.headers)
    return "; ".join(bits) + "."


def consumer_doc(item: kafka.Subscription) -> str:
    group = item.client.config.get("consumer group")
    suffix = "; consumer group `%s`" % group if group else ""
    return "Subscribed with %s%s." % (item.client.library, suffix)


def handoff(topic: str, message: str, direction: str) -> Dict[str, str]:
    return {
        "kind": "message",
        "transport": "kafka",
        "channel": topic,
        "message": message,
        "direction": direction,
    }


def publish_flow(context: str, service: str, svc_id: str, item: kafka.Publish, index: int) -> Dict[str, Any]:
    flow_slug = slug("%s-kafka-publish-%s-%s-%d" % (service, item.topic, item.message, index))
    broker = "kafka-" + slug(item.topic)
    return catalog.flow(
        "flow." + flow_slug,
        flow_slug,
        "Publish %s" % title(item.message),
        "Publishes `%s` to Kafka topic `%s`." % (item.message, item.topic),
        item.module.rel,
        context,
        [
            catalog.participant(svc_id, "service", context),
            catalog.participant(broker, "broker", None, "Kafka · " + item.topic),
        ],
        [
            catalog.step(
                "publish",
                svc_id,
                broker,
                "call",
                "publish " + item.message,
                catalog.DECLARED,
                note=kafka.config_note(item.client),
                line=item.line,
                handoff=handoff(item.topic, item.message, "send"),
            )
        ],
        trigger={"kind": "unproven", "label": "source caller not proven", "confidence": "low"},
        entrypoint=item.entrypoint,
    )


def receive_flow(context: str, service: str, svc_id: str, item: kafka.Subscription, message: str, index: int) -> Dict[str, Any]:
    flow_slug = slug("%s-kafka-consume-%s-%d" % (service, item.topic, index))
    broker = "kafka-" + slug(item.topic)
    return catalog.flow(
        "flow." + flow_slug,
        flow_slug,
        "Consume from %s" % item.topic,
        "Consumes Kafka messages from `%s`." % item.topic,
        item.module.rel,
        context,
        [
            catalog.participant(broker, "broker", None, "Kafka · " + item.topic),
            catalog.participant(svc_id, "service", context),
        ],
        [
            catalog.step(
                "receive",
                broker,
                svc_id,
                "call",
                "receive message",
                catalog.DECLARED,
                note=consumer_doc(item),
                line=item.line,
                handoff=handoff(item.topic, message, "receive"),
            )
        ],
        trigger={"kind": "message", "label": "Kafka · " + item.topic, "confidence": "high"},
        entrypoint=item.entrypoint,
    )
