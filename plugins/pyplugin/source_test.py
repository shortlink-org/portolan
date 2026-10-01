"""The tree read as syntax: which files count, how a name is found, and the
small readers every plugin runs over a node.

`testdata/shop` is the smallest tree that has one of each: a package with an
`__init__`, a module beside it, a relative import, a directory the reader
skips, and a file that does not parse.
"""

import ast
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import source  # noqa: E402
from source import Project  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(HERE, "testdata", "shop")


def project():
    return Project(FIXTURE, FIXTURE, lambda p: os.path.relpath(p, FIXTURE).replace(os.sep, "/"))


def expr(text):
    return ast.parse(text, mode="eval").body


def stmt(text):
    return ast.parse(text).body[0]


class Tree(unittest.TestCase):
    def setUp(self):
        self.project = project()

    def test_every_module_by_its_dotted_name_and_a_skipped_directory_is_not_one(self):
        self.assertEqual(sorted(self.project.modules), ["orders.__init__", "orders.events", "orders.tasks"])

    def test_a_file_that_does_not_parse_is_reported_and_left_out(self):
        self.assertEqual([rel for rel, _ in self.project.broken], ["broken.py"])

    def test_a_package_is_its_init_and_a_module_is_its_file(self):
        self.assertIs(self.project.module("orders"), self.project.modules["orders.__init__"])
        self.assertEqual(self.project.module("orders.events").rel, "orders/events.py")
        self.assertIsNone(self.project.module("orders.nothing"))
        self.assertEqual(self.project.modules["orders.events"].package, "orders")
        self.assertEqual(self.project.modules["orders.events"].where(self.project.modules["orders.events"].classes()[0]), "orders/events.py:5")

    def test_under_a_package_in_path_order_with_the_init_first(self):
        self.assertEqual([m.rel for m in self.project.under("orders")], ["orders/__init__.py", "orders/events.py", "orders/tasks.py"])

    def test_an_import_is_read_as_the_name_the_module_sees_it_by(self):
        tasks = self.project.module("orders.tasks")
        self.assertEqual(tasks.imports["json"], source.Import("json", "*", 1))
        self.assertEqual(tasks.imports["shared_task"], source.Import("celery", "shared_task", 2))
        self.assertEqual(tasks.imports["celery_app"], source.Import("config.celery", "app", 4))
        self.assertEqual(tasks.imports["OrderPlaced"], source.Import("orders.events", "OrderPlaced", 5))

    def test_a_relative_import_in_a_module_resolves_to_the_file_beside_it(self):
        tasks = self.project.module("orders.tasks")
        target, name = self.project.resolve(tasks, "OrderPlaced")
        self.assertEqual((target.rel, name), ("orders/events.py", "OrderPlaced"))

    def test_a_relative_import_in_a_package_init_is_against_the_package_itself(self):
        # Python makes a package's `__init__` a member of the package itself:
        # `from .events import OrderPlaced` in `orders/__init__.py` names
        # `orders.events`, one level fewer than the file's path says.
        init = self.project.module("orders")
        self.assertEqual(init.imports["OrderPlaced"], source.Import("orders.events", "OrderPlaced", 6))
        self.assertEqual(self.project.resolve(init, "OrderPlaced"), (self.project.module("orders.events"), "OrderPlaced"))

    def test_a_name_defined_here_resolves_to_here_and_one_from_outside_the_tree_to_nothing(self):
        events = self.project.module("orders.events")
        self.assertEqual(self.project.resolve(events, "OrderPlaced"), (events, "OrderPlaced"))
        self.assertEqual(self.project.resolve(events, "LIMIT"), (events, "LIMIT"))
        self.assertIsNone(self.project.resolve(events, "nothing"))
        self.assertIsNone(self.project.resolve(self.project.module("orders.tasks"), "shared_task"))

    def test_a_dotted_name_is_the_path_from_the_source_root(self):
        self.assertEqual(source.dotted_name("/s", "/s/a/b.py"), "a.b")
        self.assertEqual(source.dotted_name("/s", "/s/a/__init__.py"), "a.__init__")


class Readers(unittest.TestCase):
    def test_a_dotted_chain_a_name_and_nothing_else(self):
        self.assertEqual(source.dotted(expr("models.CharField(max_length=3)")), "models.CharField")
        self.assertEqual(source.dotted(expr("Invoice")), "Invoice")
        self.assertEqual(source.dotted(expr("a.b.c")), "a.b.c")
        self.assertEqual(source.dotted(expr("x[0]")), "")

    def test_a_keyword_is_read_as_the_type_asked_for_and_a_bool_is_not_an_int(self):
        call = expr('CharField(max_length=120, unique=True, null=False, default="x", choices=STATES)')
        self.assertEqual(source.keyword_int(call, "max_length"), 120)
        self.assertIsNone(source.keyword_int(call, "unique"))
        self.assertTrue(source.keyword_bool(call, "unique"))
        self.assertFalse(source.keyword_bool(call, "null"))
        self.assertEqual(source.keyword_str(call, "default"), "x")
        self.assertEqual(source.keyword_str(call, "choices"), "")
        self.assertIsNone(source.keyword(call, "nothing"))
        self.assertEqual(source.const_str(None), "")

    def test_an_annotation_is_kept_as_written(self):
        self.assertEqual(source.type_of(expr("Optional[Money]")), "Optional[Money]")
        self.assertEqual(source.type_of(None), "")

    def test_a_class_body_its_bases_assignments_methods_and_inner_classes(self):
        cls = stmt(
            "class Invoice(models.Model, Mixin):\n"
            "    a = 1\n"
            "    b: int = 2\n"
            "    c: int\n"
            "    d, e = 1, 2\n"
            "    class Meta:\n"
            "        pass\n"
            "    def save(self):\n"
            "        pass\n"
            "    async def fetch(self):\n"
            "        pass\n"
        )
        self.assertEqual(source.bases(cls), ["models.Model", "Mixin"])
        self.assertEqual([name for name, _, _ in source.assigned(cls)], ["a", "b"])
        self.assertEqual([m.name for m in source.methods(cls)], ["save", "fetch"])
        self.assertEqual(source.method(cls, "save").name, "save")
        self.assertIsNone(source.method(cls, "delete"))
        self.assertEqual(source.inner_class(cls, "Meta").name, "Meta")
        self.assertIsNone(source.inner_class(cls, "Admin"))

    def test_a_node_has_a_name_when_it_declares_one_thing(self):
        self.assertEqual(source.node_name(stmt("class A: pass")), "A")
        self.assertEqual(source.node_name(stmt("def f(): pass")), "f")
        self.assertEqual(source.node_name(stmt("async def g(): pass")), "g")
        self.assertEqual(source.node_name(stmt("x = 1")), "x")
        self.assertEqual(source.node_name(stmt("y: int = 1")), "y")
        self.assertEqual(source.node_name(stmt("a, b = 1, 2")), "")
        self.assertEqual(source.node_name(stmt("x += 1")), "")
        self.assertEqual(source.node_name(stmt("print(1)")), "")

    def test_a_decorator_is_found_by_its_last_segment_however_it_was_imported(self):
        fn = stmt("@fsm.transition(field=state)\n@receiver(post_save)\ndef on_save(): pass")
        self.assertEqual(len(source.decorators(fn)), 2)
        self.assertEqual(source.dotted(source.decorator_named(fn, "transition")), "fsm.transition")
        self.assertIsNotNone(source.decorator_named(fn, "receiver", "action"))
        self.assertIsNone(source.decorator_named(fn, "action"))

    def test_a_docstring_is_its_first_paragraph_on_one_line(self):
        self.assertEqual(source.doc(project().module("orders").tree), "Orders, the aggregate.")
        self.assertEqual(source.doc(stmt('def f():\n    """One line.\n    continued\n\n    second paragraph"""')), "One line. continued")
        self.assertEqual(source.doc(stmt("def f(): pass")), "")
        self.assertEqual(source.doc(expr("x")), "")


if __name__ == "__main__":
    unittest.main()
