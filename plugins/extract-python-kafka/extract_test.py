"""Framework-neutral Kafka extraction contracts."""

import ast
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(1, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pyplugin"))

from extract import extract  # noqa: E402
import kafka  # noqa: E402
from options import Options  # noqa: E402
from protocol import Builder, Input  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))


class PythonKafka(unittest.TestCase):
    def setUp(self):
        fixture = os.path.join(HERE, "testdata", "service")
        builder = Builder()
        extract(
            Input(root=os.path.relpath(fixture, ROOT), commit="abc1234", generated_at="2026-09-08T00:00:00Z"),
            Options.of({"context": "shop", "service": "orders", "settings": "config.settings"}),
            builder,
            cwd=ROOT,
        )
        self.warnings = builder.warnings
        self.contents = builder.files[0].contents
        self.fragment = json.loads(self.contents)
        self.service = self.fragment["contexts"][0]["services"][0]

    def test_three_standard_clients_form_message_channels(self):
        channels = {item["address"]: item for item in self.service["channels"]}
        self.assertEqual(sorted(channels), ["audit.records", "inventory.snapshots", "orders.created", "payments.accepted"])
        self.assertTrue(all(item["kind"] == "message" for item in channels.values()))
        self.assertEqual(
            [message["direction"] for message in channels["orders.created"]["messages"]],
            ["send", "receive"],
        )
        self.assertIn("consumer group `orders-indexer`", channels["orders.created"]["messages"][1]["doc"])

    def test_client_configuration_is_kept_but_credentials_never_are(self):
        orders = next(item for item in self.service["channels"] if item["address"] == "orders.created")
        self.assertIn("brokers: kafka:9092", orders["doc"])
        self.assertIn("idempotence: enabled", orders["doc"])
        self.assertIn("security protocol: SASL_SSL", orders["doc"])
        self.assertNotIn("must-not-leak", self.contents)
        self.assertNotIn("sasl.password", self.contents)
        self.assertNotIn("sasl.username", self.contents)

    def test_messagepack_serializer_and_deserializer_are_machine_readable(self):
        snapshots = next(item for item in self.service["channels"] if item["address"] == "inventory.snapshots")
        self.assertEqual([message["encoding"] for message in snapshots["messages"]], ["msgpack", "msgpack"])
        self.assertIn("value serializer: lambda value: msgpack.packb(value)", snapshots["doc"])
        self.assertIn("value deserializer: msgpack.unpackb", snapshots["doc"])

    def test_direct_messagepack_call_keeps_the_payload_name(self):
        call = ast.parse("msgpack.packb(snapshot)", mode="eval").body
        self.assertEqual(kafka.payload_name(call), "snapshot")
        self.assertEqual(kafka.payload_encoding(call), "msgpack")
        packer = ast.parse("msgpack.Packer()", mode="eval").body
        method = ast.parse("packer.pack(snapshot)", mode="eval").body
        self.assertEqual(kafka.payload_encoding(method, {"packer": ("expr", packer)}), "msgpack")

    def test_publish_and_receive_flows_have_kafka_handoffs_and_source(self):
        steps = [step for flow in self.fragment["flows"] for step in flow["steps"]]
        handoffs = [step["handoff"] for step in steps]
        self.assertTrue(any(item == {"kind": "message", "transport": "kafka", "channel": "payments.accepted", "message": "payment", "direction": "send"} for item in handoffs))
        self.assertTrue(any(item == {"kind": "message", "transport": "kafka", "channel": "payments.accepted", "message": "payment", "direction": "receive"} for item in handoffs))
        self.assertTrue(any(item["channel"] == "orders.created" and item["direction"] == "receive" for item in handoffs))
        self.assertTrue(all(step["line"].endswith(tuple(str(n) for n in range(1, 100))) for step in steps))

    def test_a_dynamic_topic_is_reported_and_not_invented(self):
        self.assertEqual(len(self.warnings), 1)
        self.assertIn("Kafka topic is dynamic", self.warnings[0].message)
        self.assertIn("runtime_topic", self.warnings[0].message)


if __name__ == "__main__":
    unittest.main()
