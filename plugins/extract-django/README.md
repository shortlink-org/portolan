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
  tasks.py                    Celery tasks: what runs later; an enqueue of one is a hop
  clients/<peer>/
    openapi.yaml              the peer's document, vendored
    client.py                 the class that calls it
  apps.py                     the AppConfig, read for the label half of a table name
  README.md                   the aggregate's page, or the docstring of the root
```

`models.py` may be a `models/` package, and so may every other module here.

## What becomes what

**Models and aggregates.** Every concrete, non-proxy model is visible. When
an application has an explicitly configured root, a model named after the
application (`invoices` → `Invoice`), or just one concrete model, it retains
its existing aggregate representation and stable root-based id.

Otherwise the application is emitted as a `kind: "model-group"` entry with
an empty `root` and an id ending in `models-<application-package>`. All of its
concrete models appear once, alongside the application's value objects,
operations and events. This is a source grouping, not a claim that the models
share a transactional boundary. Its tables link to the model blocks without
being labelled aggregate roots or children. No root-selection warning is
emitted, and no configuration is required to browse the models.

`options.aggregates` remains an optional refinement: selecting a root replaces
the source group with an aggregate. A configured root that no longer exists
produces a warning with concrete candidates, while retaining every model in
the group. Settings can help repair that configuration and save the choice to
the matching extraction step. Regenerate to apply it; other options are kept.

**Field.** Each model attribute assigned a field, with the type as written:
`CharField`, `DateTimeField`, and a relation as `ForeignKey[Invoice]`. The doc
is the field's own `help_text`, which is the one place a Django model already
writes down what a column means. What the field call says a value must
satisfy is read into the catalog's own words (portolan.0015): `max_length`
is `max_len`, `unique=True` is `unique`, `choices` is `in` with the stored
values — read off a `Choices` class, a literal list of pairs or a module-level
constant, and left out when they come from a call — an `EmailField`,
`URLField` or `UUIDField` is `format`, a `PositiveIntegerField` is `gte 0`,
and `MinValueValidator`, `MaxValueValidator`, `MinLengthValidator`,
`MaxLengthValidator` and `RegexValidator` are the bounds they were given. The
model is the source of truth for `required`: a field must be given unless
the model fills it (`default`, `auto_now`, an auto id) or excuses it (`blank`,
`null`); what a serializer adds is that layer's word and is not read here.
Value objects are the frozen dataclasses in `values.py`, their fields the
annotations as written.

**Event.** `events.py`, in either of the two ways a Django project says it. A
dataclass with `name = "billing.InvoiceIssued"` is an event, its payload the
annotated fields and its wire name that string; `channel` beside it is where it
goes out — or, when the dataclass does not say, the address the code puts it
on (below), and when both say and disagree that is reported, with the
dataclass's claim kept on the page. A module-level `Signal()` is one too — leaving it out would hide a
publish — and it declares no payload, which is a diagnostic rather than an
empty shape nobody questions. A signal named after a dataclass event (
`invoice_issued` beside `InvoiceIssued`) is how that event travels, not a
second event.

**Operation.** Each public function of `services.py`, its id the function name
in PascalCase: `issue_invoice` → `IssueInvoice`. It is a command when it saves,
creates, deletes, updates or publishes — or opens a transaction — and a query
when it does not. The doc is the function's docstring, first paragraph.
`exposedBy` names the endpoints that run it.

**Endpoint and inferred HTTP contract.** The root URLConf is found through
`DJANGO_SETTINGS_MODULE` and `ROOT_URLCONF`; nested `include()` prefixes,
`path`/`re_path`, DRF router registrations, concrete generic views and local
HTTP handlers are then followed without importing the project. A `ViewSet`'s
inherited actions and every `@action` it adds are included. The id is the
router basename and action: `router.register("invoices", InvoiceViewSet,
basename="invoice")` makes `invoice_issue` at the collection or detail route.

Those operations become a partial `provides` interface and an
`openapi.inferred.yaml` OpenAPI 3.1 document even when Swagger is generated
only at runtime. The normal API reference can therefore render the result. It
is partial deliberately and carries `x-portolan-inferred`: URLConf proves the
verb and path, while request and response schemas and status codes stay absent
unless source code proves them. A checked-in document remains
`extract-openapi`'s richer source of truth. Stateless Django applications with
routes but no models contribute to this HTTP contract without being invented
as domain aggregates.

**DRF payload schemas.** A `Serializer` becomes an OpenAPI object from its
declared fields. A `ModelSerializer` joins `Meta.fields` to the named model's
Django fields and honours explicit overrides and `read_only_fields`.
Inheritance and nested serializers (including `many=True`) become component
references. The field mapping carries scalar formats, nullability, length,
help text, defaults and read/write direction where syntax proves them.

An endpoint is joined to `serializer_class`, an action's own
`serializer_class`, or a statically decidable `get_serializer_class()` branch.
Standard generic actions supply list/object response shapes and the normal
`200`, `201` and `204` statuses. A concrete `Response` or `JsonResponse`
supplies the statuses written in its handler. Operations without that evidence
keep an unknown default response rather than borrowing a nearby serializer.

For custom handlers, literal response objects and lists are read recursively;
`Serializer(...).data` and `self.get_serializer(..., many=True).data` retain
their component references even when nested in an envelope such as
`{"data": serializer.data}`. `swagger_auto_schema` and `extend_schema` take
precedence where they declare request/response schemas, operation text, tags,
ids or manual parameters. Query parameters come from explicit
`request.GET.get(...)` and `request.query_params.get(...)` reads, including
literal defaults and simple numeric casts. `filterset_fields`, `search_fields`,
`ordering_fields` and an explicit pagination class add the conventional DRF
filter, search, ordering and page parameters. A parameter is marked required only when a missing value is
statically followed by a raise.

**Auth, in the contract.** Who may call an operation is read off DRF's
`permission_classes` and `authentication_classes`, in the order DRF applies
them: the action's own (`@action(permission_classes=…)`, or the decorators on
an `@api_view` function), then a `get_permissions()` a `self.action` branch
can decide, then the class attribute — the view's own or one a local base
class declares — then `REST_FRAMEWORK` in the settings, and past all of those
DRF's defaults. An authentication class is written as an OpenAPI security
scheme under the id drf-spectacular would give it (`SessionAuthentication` →
`cookieAuth`, `TokenAuthentication` → `tokenAuth`, a JWT class → `jwtAuth`),
and the permissions decide the operation's `security`: required for
`IsAuthenticated` and its kin, optional (`{}` among the alternatives) for
`AllowAny`, and for `IsAuthenticatedOrReadOnly` required on everything but
`GET`, `HEAD` and `OPTIONS`. The classes as the code names them are kept under
`x-portolan-permissions`. `extend_schema(auth=…)` and
`swagger_auto_schema(security=…)` win outright when written as literals. A
permission the reader does not know — a project's own `IsOwner` — is not
guessed at: the operation carries no `security` of its own, the class is still
named, and the diagnostic says so; a custom authentication class becomes a
scheme of its own whose transport is said to be unknown.

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
<endpoint>`, then follows project-local calls through imported functions,
`self.method()`, `super().method()` and class or static methods until it reaches
observable effects. Traversal is bounded and cycles are cut by symbol, so a
recursive helper cannot make extraction recursive. ORM models from routed
applications remain visible here even when the application has no unambiguous
aggregate root. A URLConf may directly mount an arbitrarily named method of a
plain class, such as `Planet.fetch`, or a plain function; that is still an
HTTP flow root, and its verb is read off what the code declares, in the order
a reviewer would trust it: a decorator on the handler (`@action(methods=…)`,
`@api_view`, `@require_http_methods([…])`, `@require_GET`, `@require_POST`,
`@require_safe`, also through `method_decorator`), the same decorators on the
class (`@method_decorator(…, name="dispatch")`), the class's
`http_method_names` (less `HEAD`, `OPTIONS` and `TRACE`, which every route
answers), a branch on `request.method` in the handler body, and last a project
wrapper — a decorator or a function the handler hands `request` to — whose own
body does one of those, followed a bounded number of levels deep. The first
tier that speaks decides; a declaration listing several verbs makes one
endpoint per verb, `planet_status` and `planet_status_patch`. When none of
them speaks, the verb is not guessed: the route stays in `provides` with an
empty `http.method`, the inferred OpenAPI document keeps the path as an item
with no operations and `x-portolan-verb: unknown`, the flow is retained, and
a diagnostic names the route. The merge never matches an outbound call
against a route whose verb is unknown, so the link waits for a declaration
rather than being confirmed by the path alone. An
inherited DRF generic action has no local handler body, so
its framework behaviour is reconstructed instead: list/retrieve read the
model, create/update validate through the selected serializer and persist it,
and destroy reads then deletes it. The model must be proven by `queryset`,
`get_queryset()` or a serializer's `Meta.model`; a URL or class name is never
used to invent a persistence hop. These steps point at the view declaration
and say that DRF supplied them, keeping inferred framework behaviour distinct
from a custom handler read directly from code.

**Flow, from a policy.** Each `@receiver` opens one on the bus: `bus → service
: event <ref>`, where the event is the signal it is given — one of this
service's own, or another service's placed by the manifest's `events`. A
receiver on one of Django's model signals — `post_save`, `pre_delete`,
`m2m_changed` and the rest — opens none: that is a hook on the row, not a
policy on an event. It says nothing about what happened, and it fires for
every save, migrations and fixtures included, so it is reported, with the
`sender` it hangs on, as the one thing left to move onto an event.

**Inside a body.** Statements are read in source order, and a chain left to
right. `Invoice.objects.get(…)` is a hop into the store, and so are
`Invoice.objects.filter(…).first()` - where the queryset is built, which is
where the line is - and a `save()` or `delete()` on something the ORM handed
back; an event handed to anything — a signal's `send`, a project's own
`publish` — is the event leaving for the bus, and where the call names an
address — `producer.send("topic", …)`, `produce`, NATS' or Redis' `publish`,
Channels' `group_send`, as a literal, a module constant or a `settings.X` —
or is a function of the project whose body does, the step says `on <address>`;
a standard `requests`, `httpx` or `aiohttp` call is an unresolved rpc to the
URL's host, including URLs carried through local variables, settings and
`urljoin`; a call on a vendored client is an rpc to the peer; a `.delay()` or `.apply_async()` on a function decorated
`@shared_task` or `@app.task`, directly or through `.s()`, is a hop to the
queue it lands on, `celery-<queue>` — decided the way Celery decides it, by the
reader `extract-celery` shares through `pyplugin`: the `queue=` at the call,
then the decorator's, then `task_routes`, then `task_default_queue` — so the
endpoint and task flows carry the same exact queue and task wire name and are
composed at the worker receive step; and `transaction.on_commit(…)` around it,
as a lambda or a `partial`, is the note that it waits for the commit. A call into `services.py` and ordinary project helpers is followed within the same
bounded traversal. `if` becomes an alt when some arm holds
a hop, and a branch ending in a `return` or a `raise` is terminal; a `for`, a
`while`, a `with transaction.atomic()` and an `except` are a note on the steps
inside them. `await` is transparent. Every step is `declared`.

The worker receive is also a source seam. When `extract-celery` is enabled,
its transport flow continues into the task function body read here, so one
request flow can show `HTTP → enqueue → worker → database/API` without
repeating the enqueue. The task-body fragment is source-backed and disappears
as a standalone fragment once composition consumes it.

**Project wrappers.** Some repositories deliberately put a semantic boundary
around infrastructure or a business integration. `flowWrappers` maps that
callable's fully qualified Python name to the step the reader should show,
instead of expanding its implementation on every call:

```json
{
  "flowWrappers": {
    "util.logger.send_log": {
      "label": "Record application log",
      "technical": true
    },
    "mailer.client.send": {
      "label": "Send email",
      "target": "messaging.mailer"
    }
  }
}
```

`technical: true` keeps one counted step per flow (`×N`) rather than flooding
every branch with the same logger, metric or tracing implementation. It does
not silently discard the calls: their count, wrapper name and first source
line remain visible. A wrapper without `technical` is a normal semantic step
and is kept at every call site. `target` is an optional catalog service id;
without it the wrapper is shown as an operation inside the current service.

**Peer.** `clients/<peer>/` holds the class that calls and the document it was
vendored from. The code names the verb and the route —
`self._http.post("/v1/quotes")`, httpx or requests alike — and the document
says which operation answers there, so the call is recorded under the id the
callee's own extractor gives it: `pricing.v1/createQuote`, spelled by
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

The primary store is inferred from `DATABASES["default"]` when that setting is
statically readable; `store` remains the override for settings assembled at
runtime or for a catalog that needs a different stable slug. Every concrete,
non-proxy model becomes a table even when its application has several possible
aggregate roots: both the model group and persistence schema stay visible. Fields from abstract model bases are copied into those tables
regardless of which model module sorts first. `DEFAULT_AUTO_FIELD` supplies
implicit primary-key types. PostgreSQL `ArrayField` nesting and
`MultiSelectField` storage are rendered as their database types; `to_field`
selects a relation's referenced column, and `db_constraint=False` keeps a
logical relation from being drawn as a physical foreign-key constraint. An
implicit `ManyToManyField` contributes the join table Django creates, while an
explicit `through` model is already a normal model and therefore a normal
table. Calls routed through `.using("alias")` or `.db_manager("alias")` keep
that alias on the flow instead of being attributed to the primary store.

## What it does not read

Named here rather than left to be discovered: **migrations** (the models are
the schema; a migration is how it got there), **the bodies of Celery tasks**
(an enqueue is a hop to its queue, and what the worker does there is
`extract-celery`'s), **admin**, **templates**, **middleware**, **management
commands**, **signals connected outside a `@receiver`**, and a **many-to-many**
field with an explicit `through` model beyond the table represented by that
model itself.

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
  "settings": "config.settings",
  "out": "domain.json",
  "storesOut": "stores.json"
}
```

`source` is the directory the applications are looked for in, the input root
unless said otherwise; `apps` names them outright for a project that keeps them
somewhere a models module would not be found. `store` overrides the stable slug
inferred from `DATABASES["default"]`; it is required only when the settings are
not statically readable. `storeKind` is read off
`DATABASES["default"]["ENGINE"]` in the settings module when left out —
`postgresql`, `postgis` and `psqlextra.backend` are `postgres`, and `sqlite3`
is `sqlite`; given, it wins, and a disagreement with the settings is reported.
`settings` names the Django settings module — for the database, and
for the queues Celery is configured with — only where `manage.py` does not.
Everything else means what it means for `extract-ts`.

## Extraction limits

These cases do not become facts in the fragment:

- a domain aggregate for an application with no models (its statically
  resolvable HTTP routes are still included);
- a model that declares no fields;
- an events module holding a class with no wire name, and a signal with no
  payload;
- an application with no services module;
- a dynamically assembled URLConf target or an unrestricted function view
  whose HTTP method cannot be proven from syntax;
- serializer fields created dynamically, a `get_serializer_class()` decision
  that is not reducible to `self.action`, and custom serializer classes that
  do not derive from DRF `Serializer`/`ModelSerializer`;
- a table with an edge no method makes, a method moving into a state the table
  lacks, a status assigned to something the states do not name, and a model
  that moves its status while declaring no table at all;
- a permission class DRF does not ship, and a permission or authentication
  list built with `|`, `&` or anything but a literal list of classes;
- a client with no document beside it, and a route its document does not
  declare;
- an api id the manifest names no peer for;
- a receiver on a model signal, `post_save` and its kin, named with the model
  it hangs on;
- a many-to-many field, whose join table is not named here;
- an event no flow reaches;
- a file that does not parse, by path.

## Manifest

```json
{
  "plugins": [{ "name": "django-domain", "process": { "command": "python3", "args": ["plugins/extract-django/main.py"] } }],
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
