"""The order a queue is decided in, and the configuration it is read from."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(1, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pyplugin"))

import celery_conf as conf  # noqa: E402
import celery_conf as routes  # noqa: E402
from source import Project  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def project(fixture):
    root = os.path.join(HERE, "testdata", fixture)
    return Project(root, root, lambda p: os.path.relpath(p, root))


class Order(unittest.TestCase):
    def setUp(self):
        self.cfg = conf.Config(routes=[("app.tasks.send", "exact"), ("app.tasks.*", "glob")], default_queue="dflt")

    def test_the_call_first_then_the_task_then_the_routes_then_the_default(self):
        self.assertEqual(routes.queue_for("app.tasks.send", "here", "there", self.cfg), ("here", routes.AT_CALL))
        self.assertEqual(routes.queue_for("app.tasks.send", "", "there", self.cfg), ("there", routes.ON_TASK))
        self.assertEqual(routes.queue_for("app.tasks.send", "", "", self.cfg), ("exact", routes.BY_ROUTES))
        self.assertEqual(routes.queue_for("app.tasks.other", "", "", self.cfg), ("glob", routes.BY_ROUTES))
        self.assertEqual(routes.queue_for("elsewhere.task", "", "", self.cfg), ("dflt", routes.BY_DEFAULT))

    def test_past_everything_celery_has_a_queue_of_its_own(self):
        self.assertEqual(routes.queue_for("x", "", "", conf.Config()), ("celery", routes.BY_CELERY))

    def test_a_route_that_names_no_task_is_found(self):
        self.assertEqual(routes.unmatched(self.cfg, ["app.tasks.send"]), [])
        self.assertEqual(routes.unmatched(self.cfg, ["other.task"]), ["app.tasks.send", "app.tasks.*"])


class Schedules(unittest.TestCase):
    """A schedule object, as the sentence the page says."""

    def text(self, source):
        import ast

        from source import Module

        module = Module.__new__(Module)
        module.tree = ast.parse("x = " + source)
        return conf.schedule_text(module.tree.body[0].value, module)

    def test_crontab_in_its_own_field_order_with_stars_for_what_is_not_said(self):
        self.assertEqual(self.text("crontab(minute=0, hour='*/3')"), ("cron 0 */3 * * *", True))
        self.assertEqual(self.text("crontab(hour=9, minute=30, day_of_week='mon-fri')"), ("cron 30 9 * * mon-fri", True))
        self.assertEqual(self.text("crontab()"), ("cron * * * * *", True))

    def test_an_interval_in_seconds_or_a_timedelta(self):
        self.assertEqual(self.text("30.0"), ("every 30s", True))
        self.assertEqual(self.text("90"), ("every 1m30s", True))
        self.assertEqual(self.text("timedelta(hours=6)"), ("every 6h", True))
        self.assertEqual(self.text("timedelta(days=1, hours=12)"), ("every 1d12h", True))
        self.assertEqual(self.text("schedule(run_every=timedelta(minutes=5))"), ("every 5m", True))

    def test_a_solar_event_and_anything_else_as_written(self):
        self.assertEqual(self.text("solar('sunset', 59.9, 10.7)"), ("solar sunset", True))
        self.assertEqual(self.text("crontab(minute=MINUTE)"), ("crontab(minute=MINUTE)", False))
        self.assertEqual(self.text("every_other_day()"), ("every_other_day()", False))

    def test_the_entries_are_read_off_the_settings_and_the_app_module(self):
        cfg = conf.read_config(project("billing"), "")
        self.assertEqual(
            [(s.name, s.task or s.ref, s.when, s.queue, s.opaque) for s in cfg.schedules],
            [
                ("remind-unpaid-invoices", "invoices.tasks.remind_unpaid_invoice", "every 6h", "", False),
                ("archive-closed-invoices", "billing.archive_invoice", "cron 30 2 * * *", "", False),
                ("close-stale-drafts", "close_stale_drafts", "cron 0 3 * * *", "", False),
            ],
        )
        self.assertFalse(cfg.beat_in_database)


class Reading(unittest.TestCase):
    def test_the_settings_under_the_namespace_the_app_names(self):
        cfg = conf.read_config(project("billing"), "")
        self.assertEqual(cfg.settings, "config.settings")
        self.assertTrue(cfg.settings_found)
        self.assertEqual(cfg.routes, [("invoices.tasks.send_invoice_email", "billing.mail")])
        self.assertEqual(cfg.default_queue, "billing")
        self.assertEqual(cfg.broker_scheme, "redis")
        self.assertEqual([a.name for a in cfg.apps], ["app"])

    def test_the_app_module_over_settings_that_are_not_there(self):
        cfg = conf.read_config(project("drift"), "")
        self.assertFalse(cfg.settings_found)
        self.assertEqual(cfg.routes, [("reports.tasks.*", "reports")])
        self.assertEqual(cfg.default_queue, "reports.default")
        self.assertEqual(cfg.broker_scheme, "amqp")

    def test_an_environment_lookup_is_its_default_and_no_further(self):
        cfg = conf.read_config(project("billing"), "")
        self.assertEqual(cfg.broker, "redis://localhost:6379/0")


if __name__ == "__main__":
    unittest.main()
