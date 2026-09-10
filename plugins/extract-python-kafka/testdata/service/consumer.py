from aiokafka import AIOKafkaConsumer
from confluent_kafka import Consumer
from django.conf import settings
from kafka import KafkaConsumer
import msgpack

from producer import AUDIT_TOPIC, SNAPSHOT_TOPIC


def consume_orders():
    consumer = Consumer(
        {
            "bootstrap.servers": "kafka:9092",
            "group.id": "orders-indexer",
            "auto.offset.reset": "earliest",
        }
    )
    consumer.subscribe([settings.ORDERS_TOPIC])


def consume_audit():
    return KafkaConsumer(AUDIT_TOPIC, bootstrap_servers="kafka-a:9092", group_id="audit-archive")


async def consume_payments():
    return AIOKafkaConsumer(
        "payments.accepted",
        bootstrap_servers="async-kafka:9092",
        group_id="payment-ledger",
        enable_auto_commit=False,
    )


def consume_snapshots():
    return KafkaConsumer(
        SNAPSHOT_TOPIC,
        bootstrap_servers="kafka:9092",
        value_deserializer=msgpack.unpackb,
    )
