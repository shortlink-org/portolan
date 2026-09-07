"""An app configured in place rather than from settings: the broker on the
constructor, the routes, the default queue and the beat schedule on
`conf.update`. The route names a package the tree does not have."""

from celery import Celery
from celery.schedules import crontab

app = Celery("reports", broker="amqp://guest@localhost//")
app.conf.update(
    task_routes={"reports.tasks.*": {"queue": "reports"}},
    task_default_queue="reports.default",
    # One entry names a task the tree does not hold; the other has a schedule
    # that is not syntax this reader knows, and a queue of its own.
    beat_schedule={
        "nightly": {"task": "reports.tasks.nightly", "schedule": crontab(hour=2, minute=0)},
        "rebuild": {"task": "jobs.tasks.build_report", "schedule": every_other_day(), "options": {"queue": "rebuild"}},
    },
)
