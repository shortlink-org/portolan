# extract-django

A Django service in, a catalog fragment out — two, when the service keeps a
database. The Django twin of `extract-go` and `extract-ts`, with one difference
that runs through all of it: those read a layout somebody keeps by hand, and
this reads the framework. A Django project already says where the model is,
what the rows are and what answers a request; nothing is annotated for the
catalog, and the applications are the claim.

Written in Python and run as a process plugin, `python3 plugins/extract-django/main.py`.
Python 3.9 or newer and nothing but the standard library: a plugin that needed
the project's own dependencies installed could not be run over somebody else's
checkout. **The project is never imported.** `django.setup()` runs the code it
finds, reads the environment and opens sockets, and an extractor doing any of
those has stopped being a pure function of the tree. Everything is read through
`ast`, and names are resolved by import and by file, the way `extract-ts`
resolves them without a type checker.

## The layout it reads

```
<app>/                        an application: a package with a models module
  models.py                   the root, named after the application, and its entities
  values.py                   value objects: the frozen dataclasses
  events.py                   events: a dataclass with a `name`, or a bare Signal
  services.py                 use cases: one function per scenario
  views.py                    DRF views: a ViewSet's actions, an @api_view function
  urls.py                     the router registration, which names the endpoints
  handlers.py                 policies: `@receiver(signal)`, also read from signals.py
  clients/<peer>/
    openapi.yaml              the peer's document, vendored
    client.py                 the class that calls it
  apps.py                     the AppConfig, read for the label half of a table name
  README.md                   the aggregate's page, or the docstring of the root
```

`models.py` may be a `models/` package, and so may every other module here.

## What becomes what

**Aggregate.** One per application. The root is the model named after the
application — `invoices` holds `Invoice` — or the only model there is, or the
one `aggregates` names in the manifest; an application with several models and
no such name is reported and skipped, because guessing which of them the others
hang off is how an aggregate boundary gets drawn wrong and stays wrong. The
aggregate is named and slugged after the root, so a Django `invoices` and a Go
`invoice` package land on the same id. Every concrete model of the application
is an entity, the root included and first; abstract models are not. The
readme is `README.md` in the application, or the root's docstring.

**Field.** Each model attribute assigned a field, with the type as written:
`CharField`, `DateTimeField`, and a relation as `ForeignKey[Invoice]`. The doc
is the field's own `help_text`, which is the one place a Django model already
writes down what a column means. Value objects are the frozen dataclasses in
`values.py`, their fields the annotations as written.

**Event.** `events.py`, in either of the two ways a Django project says it. A
dataclass with `name = "billing.InvoiceIssued"` is an event, its payload the
annotated fields and its wire name that string; `channel` beside it is where it
goes out. A module-level `Signal()` is one too — leaving it out would hide a
publish — and it declares no payload, which is a diagnostic rather than an
empty shape nobody questions. A signal named after a dataclass event (
`invoice_issued` beside `InvoiceIssued`) is how that event travels, not a
second event.

**Operation.** Each public function of `services.py`, its id the function name
in PascalCase: `issue_invoice` → `IssueInvoice`. It is a command when it saves,
creates, deletes, updates or publishes — or opens a transaction — and a query
when it does not. The doc is the function's docstring, first paragraph.
`exposedBy` names the endpoints that run it.

**Endpoint.** A DRF `ViewSet`'s actions — the five it inherits and every
`@action` it adds — and an `@api_view` function. The id is the router's
basename and the action: `router.register("invoices", InvoiceViewSet,
basename="invoice")` makes `invoice_issue`, which is the name a
drf-spectacular document would give it too. The route itself is not read here:
a path is a fact about the document, and the document is `extract-openapi`'s to
read.

**Lifecycle.** Read off the table the model keeps, never off the branches of
its methods. Either the table is a `TRANSITIONS` mapping beside the
`TextChoices` that names the states —

```python
class Status(models.TextChoices):
    DRAFT = "draft", "Draft"
    ISSUED = "issued", "Issued"

TRANSITIONS = {Status.DRAFT: [Status.ISSUED], Status.ISSUED: []}
```

— and the mover is the method assigning `self.status`; or the table is
django-fsm's `@transition(field=status, source=…, target=…)` decorators, which
are the same table written one edge at a time. Either way `emits` is the event
the method's return annotation names. The first state is where a new row
starts; a state nothing leads out of is terminal, which is derived on the page
and never written down.

**Flow, from an endpoint.** Each view action opens one: `client → service : rpc
<endpoint>`, then the steps of every service function it runs, in order.
**Flow, from a policy.** Each `@receiver` opens one on the bus: `bus → service
: event <ref>`, where the event is the signal it is given — one of this
service's own, or another service's placed by the manifest's `events`.

**Inside a body.** Statements are read in source order, and a chain left to
right. `Invoice.objects.get(…)` is a hop into the store, and so are
`Invoice.objects.filter(…).first()` - where the queryset is built, which is
where the line is - and a `save()` or `delete()` on something the ORM handed
back; an event handed to anything — a signal's `send`, a project's own
`publish` — is the event leaving for the bus; a call on a vendored client is an
rpc to the peer. A call into `services.py` is followed, two deep at most, and
past that the call itself is the step. `if` becomes an alt when some arm holds
a hop, and a branch ending in a `return` or a `raise` is terminal; a `for`, a
`while`, a `with transaction.atomic()` and an `except` are a note on the steps
inside them. `await` is transparent. Every step is `declared`.

**Peer.** `clients/<peer>/` holds the class that calls and the document it was
vendored from. The code names the verb and the route —
`self._http.post("/v1/quotes")`, httpx or requests alike — and the document
says which operation answers there, so the call is recorded under the id the
callee's own extractor gives it: `pricing.v1.Quotes/createQuote`, spelled by
the same rules as `plugins/openapi`. The peer is the manifest's `peers` entry
for that api id; without one the lane is `unknown` and the step unresolved.
Without a document there is no id to share, and the call is recorded against
the route it names.

**Store.** The models are the schema, so the tables come out of this plugin
rather than out of `extract-sql`. A Django model is both the domain object and
the row, which means the two facts a SQL reader has to pair up — a column, and
the field it carries — are one declaration here: `maps` is exact, and so is
`persists`, down to the block. The table is `Meta.db_table` or the name Django
composes from the application's label; a column is `db_column` or the field's
own name, `_id` for a relation; the type is what Django's PostgreSQL backend
emits, so `CharField(max_length=32)` is `varchar(32)` and a key into a
`bigserial` is a `bigint`. Indexes come from `db_index`, `unique`,
`Meta.indexes`, `Meta.unique_together` and `Meta.constraints`; an index Django
would name with a hash of its own is called after its table and columns, since
inventing the hash would be a name no database has.

## What it does not read

Named here rather than left to be discovered: **migrations** (the models are
the schema; a migration is how it got there), **Celery tasks** and `.delay()`,
**admin**, **serializers**, **templates**, **middleware**, **management
commands**, **signals connected outside a `@receiver`**, and a **many-to-many**
field's join table — which is reported, since Django makes a table there that
this does not name.

## Options

```json
{
  "context": "shop",
  "service": "billing",
  "store": "pg",
  "storeKind": "postgres",
  "aggregates": { "invoices": "Invoice" },
  "peers": { "pricing.v1": "shop.pricing" },
  "events": { "payments.events": "payments.ledger.payment" },
  "source": ".",
  "out": "domain.json",
  "storesOut": "stores.json"
}
```

`source` is the directory the applications are looked for in, the input root
unless said otherwise; `apps` names them outright for a project that keeps them
somewhere a models module would not be found. `store` is what says which
database the models are the schema of — without it they describe none, and
calls into the ORM stay on the service's own lane. Everything else means what
it means for `extract-ts`.

## Diagnostics

Reported beside the fragment, never papered over inside it:

- an application with no models, or with several and no root among them named
  after it;
- a model that declares no fields;
- an events module holding a class with no wire name, and a signal with no
  payload;
- an application with no services module;
- a view no router registers;
- a table with an edge no method makes, a method moving into a state the table
  lacks, a status assigned to something the states do not name, and a model
  that moves its status while declaring no table at all;
- a client with no document beside it, and a route its document does not
  declare;
- an api id the manifest names no peer for;
- a many-to-many field, whose join table is not named here;
- an event no flow reaches;
- a file that does not parse, by path.

## Manifest

```json
{
  "plugins": [{ "name": "django-domain", "process": { "cmd": "python3 plugins/extract-django/main.py" } }],
  "extract": [
    {
      "plugin": "django-domain",
      "in": "examples/shop/billing",
      "out": "examples/shop/billing/portolan",
      "options": {
        "context": "shop",
        "service": "billing",
        "store": "pg",
        "peers": { "pricing.v1": "shop.pricing" },
        "events": { "payments.events": "payments.ledger.payment" }
      }
    }
  ]
}
```

## Tests

```bash
python3 -m unittest discover -s plugins/extract-django -t plugins/extract-django -p "*_test.py"
```

The reader is held to fixtures under `testdata/`: `billing`, a service in the
layout above with each shape it claims to read present once, against the golden
`expected.json` and `expected-stores.json`; `fsm`, the same lifecycle written
with django-fsm; and `drift`, a table and the methods that no longer agree with
it, where every diagnostic is one the reader is meant to raise.
`UPDATE_GOLDEN=1` writes the goldens again after a deliberate change, and the
diff is the review.
