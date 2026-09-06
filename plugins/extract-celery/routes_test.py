"""The order a queue is decided in, and the configuration it is read from."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(1, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pyplugin"))

import conf  # noqa: E402
import routes  # noqa: E402
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
