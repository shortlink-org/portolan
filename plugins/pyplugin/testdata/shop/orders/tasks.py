import json
from celery import shared_task

from config.celery import app as celery_app
from .events import OrderPlaced


@shared_task(name="orders.place", queue="orders.slow")
def place_order(order_id):
    """Places the order.

    Then says more, which the page does not.
    """
    return json.dumps(OrderPlaced(order_id, None).__dict__)


@celery_app.task
def notify():
    pass


@celery_app.task(bind=True, max_retries=3)
def retry_later(self):
    pass


def helper():
    pass
