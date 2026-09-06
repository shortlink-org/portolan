"""How an event leaves for the wire when it is not a Django signal: one
producer, one topic, the event's name on the key so a subscriber dispatches
without parsing the payload."""

import json
from dataclasses import asdict

from kafka import KafkaProducer

INVOICE_TOPIC = "shop.billing.invoice"

producer = KafkaProducer(bootstrap_servers="kafka:9092")


def publish(event):
    """Puts an event on the invoice topic under the name it travels by."""
    producer.send(INVOICE_TOPIC, key=event.name.encode(), value=json.dumps(asdict(event)).encode())
