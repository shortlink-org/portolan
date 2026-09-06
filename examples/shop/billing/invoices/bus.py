"""How an event leaves for JetStream: the subject invoices/bus/asyncapi.yaml
declares, the event's name in the message headers so a subscriber dispatches
without parsing the payload. The catalog reads the subject here and holds it
against the document."""

import asyncio
import json
from dataclasses import asdict

import nats
from django.conf import settings

INVOICE_SUBJECT = "shop.billing.invoice"


def publish(event):
    """Puts an event on the invoice subject under the name it travels by."""
    asyncio.run(_publish(event))


async def _publish(event):
    nc = await nats.connect(settings.NATS_URL)
    try:
        await nc.publish(INVOICE_SUBJECT, json.dumps(asdict(event)).encode(), headers={"name": event.name})
    finally:
        await nc.drain()
