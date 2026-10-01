"""Every function the tree hands to Celery, and the name it travels under."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import celery_tasks  # noqa: E402
from source import Project  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(HERE, "testdata", "shop")


class Tasks(unittest.TestCase):
    def setUp(self):
        self.project = Project(FIXTURE, FIXTURE, lambda p: os.path.relpath(p, FIXTURE).replace(os.sep, "/"))
        self.tasks = celery_tasks.read_tasks(self.project)
        self.by_key, self.by_name = celery_tasks.index(self.tasks)

    def test_a_decorated_function_is_a_task_and_a_plain_one_is_not(self):
        self.assertEqual([t.short for t in self.tasks], ["place_order", "notify", "retry_later"])

    def test_the_wire_name_is_the_one_given_or_the_one_celery_composes(self):
        self.assertEqual([t.name for t in self.tasks], ["orders.place", "orders.tasks.notify", "orders.tasks.retry_later"])

    def test_the_queue_is_the_decorators_and_nothing_when_it_names_none(self):
        self.assertEqual([t.queue for t in self.tasks], ["orders.slow", "", ""])

    def test_where_a_task_is_and_what_the_page_says_about_it(self):
        place = self.by_name["orders.place"]
        self.assertEqual(place.key, ("orders.tasks", "place_order"))
        self.assertEqual(place.line, "orders/tasks.py:9")
        self.assertEqual(place.doc, "Places the order.")
        self.assertEqual(place.entrypoint, "python:orders.tasks:place_order")

    def test_the_index_answers_a_call_on_the_function_and_a_send_by_name(self):
        self.assertIs(self.by_key[("orders.tasks", "notify")], self.by_name["orders.tasks.notify"])
        self.assertEqual(sorted(self.by_name), ["orders.place", "orders.tasks.notify", "orders.tasks.retry_later"])

    def test_a_package_init_is_the_package(self):
        self.assertEqual(celery_tasks.package_of(self.project.module("orders")), "orders")
        self.assertEqual(celery_tasks.package_of(self.project.module("orders.tasks")), "orders.tasks")


if __name__ == "__main__":
    unittest.main()
