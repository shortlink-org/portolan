"""The rules a model field states, read one option at a time."""

import ast
import unittest

from domain import FieldDef
from rules import rules_of


class Module:
    """The slice of a Module the rules reader touches: the tree and its classes."""

    def __init__(self, tree: ast.Module):
        self.tree = tree

    def classes(self):
        return [node for node in self.tree.body if isinstance(node, ast.ClassDef)]


class Model:
    def __init__(self, node: ast.ClassDef, module: Module):
        self.node = node
        self.module = module


def fields(source: str):
    """Every field of the last class in `source`, as the extractor reads it,
    with the integer options it resolves ahead of time."""
    tree = ast.parse(source)
    node = [n for n in tree.body if isinstance(n, ast.ClassDef)][-1]
    model = Model(node, Module(tree))
    out = {}
    for stmt in node.body:
        if isinstance(stmt, ast.Assign) and isinstance(stmt.value, ast.Call):
            name = stmt.targets[0].id
            call = stmt.value
            kind = call.func.attr if isinstance(call.func, ast.Attribute) else call.func.id
            integers = {}
            for kw in call.keywords:
                if kw.arg == "max_length" and isinstance(kw.value, ast.Constant):
                    integers["max_length"] = kw.value.value
            out[name] = rules_of(FieldDef(name=name, kind=kind, call=call, node=stmt, integers=integers), model)
    return out


class Options(unittest.TestCase):
    def test_the_options_become_rules_in_the_order_written(self):
        got = fields(
            "class Invoice(models.Model):\n"
            "    number = models.CharField(max_length=32, unique=True, null=True)\n"
            "    currency = models.CharField(unique=True, max_length=3)\n"
        )
        self.assertEqual(got["number"], {"rules": [{"name": "max_len", "value": "32"}, {"name": "unique"}]})
        self.assertEqual(got["currency"], {"required": True, "rules": [{"name": "unique"}, {"name": "max_len", "value": "3"}]})

    def test_the_field_class_speaks_first(self):
        got = fields(
            "class Line(models.Model):\n"
            "    email = models.EmailField(max_length=254)\n"
            "    quantity = models.PositiveIntegerField()\n"
            "    site = models.URLField(blank=True)\n"
            "    owner = models.UUIDField(default=uuid.uuid4)\n"
        )
        self.assertEqual(got["email"]["rules"], [{"name": "format", "value": "email"}, {"name": "max_len", "value": "254"}])
        self.assertEqual(got["quantity"], {"required": True, "rules": [{"name": "gte", "value": "0"}]})
        self.assertEqual(got["site"], {"rules": [{"name": "format", "value": "uri"}]})
        self.assertEqual(got["owner"], {"rules": [{"name": "format", "value": "uuid"}]})

    def test_validators_carry_their_bound(self):
        got = fields(
            "class Line(models.Model):\n"
            "    rate = models.DecimalField(validators=[MinValueValidator(0), MaxValueValidator(limit_value=1)])\n"
            "    code = models.CharField(validators=[RegexValidator(r'^[A-Z]{3}$'), RegexValidator('x', inverse_match=True), validators.MinLengthValidator(2)])\n"
            "    other = models.CharField(validators=[custom(), MinValueValidator(LIMIT)])\n"
        )
        self.assertEqual(got["rate"]["rules"], [{"name": "gte", "value": "0"}, {"name": "lte", "value": "1"}])
        self.assertEqual(got["code"]["rules"], [{"name": "pattern", "value": "^[A-Z]{3}$"}, {"name": "min_len", "value": "2"}])
        self.assertEqual(got["other"], {"required": True})


class Choices(unittest.TestCase):
    def test_a_choices_class_is_read_by_its_stored_values(self):
        got = fields(
            "class Invoice(models.Model):\n"
            "    class Status(models.TextChoices):\n"
            "        DRAFT = 'draft', 'Draft'\n"
            "        PAID = 'paid', 'Paid'\n"
            "    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)\n"
        )
        self.assertEqual(got["status"], {"rules": [{"name": "max_len", "value": "16"}, {"name": "in", "value": "draft, paid"}]})

    def test_a_module_level_class_and_an_integer_choices_read_the_same(self):
        got = fields(
            "class Priority(models.IntegerChoices):\n"
            "    LOW = 1\n"
            "    HIGH = 2, 'High'\n"
            "class Ticket(models.Model):\n"
            "    priority = models.IntegerField(choices=Priority.choices)\n"
        )
        self.assertEqual(got["priority"], {"required": True, "rules": [{"name": "in", "value": "1, 2"}]})

    def test_literal_lists_bare_values_and_groups(self):
        got = fields(
            "SIZES = [('s', 'Small'), ('m', 'Medium')]\n"
            "class Shirt(models.Model):\n"
            "    size = models.CharField(choices=SIZES)\n"
            "    fit = models.CharField(choices=['slim', 'regular'])\n"
            "    colour = models.CharField(choices=[('Warm', [('red', 'Red')]), ('Cold', [('blue', 'Blue')])])\n"
            "    made = models.CharField(choices=load_choices())\n"
        )
        self.assertEqual(got["size"]["rules"], [{"name": "in", "value": "s, m"}])
        self.assertEqual(got["fit"]["rules"], [{"name": "in", "value": "slim, regular"}])
        self.assertEqual(got["colour"]["rules"], [{"name": "in", "value": "red, blue"}])
        self.assertEqual(got["made"], {"required": True})

    def test_a_pair_naming_a_member_reads_its_value(self):
        got = fields(
            "class Kind(models.TextChoices):\n"
            "    ORDER = 'order', 'Order'\n"
            "class Invoice(models.Model):\n"
            "    kind = models.CharField(choices=[(Kind.ORDER, 'An order')])\n"
        )
        self.assertEqual(got["kind"]["rules"], [{"name": "in", "value": "order"}])


class Required(unittest.TestCase):
    def test_the_model_fills_or_excuses_the_value(self):
        got = fields(
            "class Invoice(models.Model):\n"
            "    id = models.BigAutoField(primary_key=True)\n"
            "    order_id = models.UUIDField()\n"
            "    number = models.CharField(max_length=32, null=True)\n"
            "    note = models.TextField(blank=True)\n"
            "    created = models.DateTimeField(auto_now_add=True)\n"
            "    status = models.CharField(max_length=8, default='draft')\n"
            "    paid = models.BooleanField()\n"
            "    tags = models.ManyToManyField('Tag')\n"
            "    invoice = models.ForeignKey('Invoice', on_delete=models.CASCADE)\n"
        )
        required = {name: value.get("required", False) for name, value in got.items()}
        self.assertEqual(
            required,
            {
                "id": False,
                "order_id": True,
                "number": False,
                "note": False,
                "created": False,
                "status": False,
                "paid": False,
                "tags": False,
                "invoice": True,
            },
        )


if __name__ == "__main__":
    unittest.main()
