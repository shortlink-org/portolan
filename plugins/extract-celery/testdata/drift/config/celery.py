"""An app configured in place rather than from settings: the broker on the
constructor, the routes and the default queue on `conf.update`. The route
names a package the tree does not have."""

from celery import Celery

app = Celery("reports", broker="amqp://guest@localhost//")
app.conf.update(
    task_routes={"reports.tasks.*": {"queue": "reports"}},
    task_default_queue="reports.default",
)
