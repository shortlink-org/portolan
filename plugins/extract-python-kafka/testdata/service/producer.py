import json
import os
import msgpack

from aiokafka import AIOKafkaProducer
from confluent_kafka import Producer
from django.conf import settings
from kafka import KafkaProducer

AUDIT_TOPIC = "audit.records"
SNAPSHOT_TOPIC = "inventory.snapshots"


class ClientFactory:
    @classmethod
    def build(cls):
        config = {
            "bootstrap.servers": os.environ.get("KAFKA_BROKERS", "kafka:9092"),
            "security.protocol": "SASL_SSL",
            "sasl.username": "reader",
            "sasl.password": "must-not-leak",
            "enable.idempotence": True,
            "compression.type": "gzip",
            "client.id": "orders-api",
        }
        return Producer(config)


def publish_order(order_id, runtime_topic):
    producer = ClientFactory.build()
    body = {"order_id": order_id}
    producer.produce(
        topic=settings.ORDERS_TOPIC,
        value=json.dumps(body).encode(),
        key=str(order_id),
        headers=[("schema", b"v1")],
    )
    producer.produce(topic=runtime_topic, value=b"opaque")


def publish_audit():
    producer = KafkaProducer(
        bootstrap_servers=["kafka-a:9092", "kafka-b:9092"],
        retries=4,
        compression_type="snappy",
        value_serializer=lambda value: json.dumps(value).encode(),
    )
    producer.send(AUDIT_TOPIC, {"kind": "checked"})


async def publish_payment(payment):
    producer = AIOKafkaProducer(bootstrap_servers="async-kafka:9092")
    await producer.send_and_wait("payments.accepted", payment)


def publish_snapshot(snapshot):
    producer = KafkaProducer(
        bootstrap_servers="kafka:9092",
        value_serializer=lambda value: msgpack.packb(value),
    )
    producer.send(SNAPSHOT_TOPIC, snapshot)
