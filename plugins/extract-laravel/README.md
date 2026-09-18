# extract-laravel

A Laravel application in, a catalog fragment out - two, when its route files
prove an HTTP contract. The PHP twin of `extract-django`: like it, this reads
the framework rather than a layout somebody keeps by hand. A Laravel
application already says where the models are, what they hold, what answers a
request and who listens to what; nothing is annotated for the catalog, and
the framework's conventions are the claim.

Written in Rust and run as a process plugin, `cargo run --quiet
--manifest-path plugins/extract-laravel/Cargo.toml`, on [Mago](https://github.com/carthage-software/mago)'s
`mago-syntax`: the one maintained PHP parser in Rust, kept up with PHP 8.5
within weeks of each release, which is what a reader of a framework that moves
with the language needs. **The application is never run.** No `artisan`, no
container, no `composer install`: everything is read from syntax, and names
are resolved by namespace and by `use` line, the way `extract-ts` resolves
them without a type checker. A file that does not parse is read as far as it
parsed and reported.

## The layout it reads

Two layouts, and the manifest's `modules` option can name either or a third:

```
app/                          a plain Laravel application: one module, named after the root
  Models/*.php                Eloquent models
  Events/*.php                events with a payload
  Listeners/*.php             what reacts to them
  Providers/EventServiceProvider.php
  Http/Controllers/**/*.php   what answers a route
routes/*.php                  the route files, beside app/

packages/<Vendor>/<Name>/src/ a monolith built from packages (Bagisto, Concord, nwidart/modules):
  Models/, Events/, Listeners/, Providers/, Http/Controllers/   one module per package, named <Name>
  Routes/*.php, Http/routes.php                                  the package's own routes
```

`packages/*/*/src` is used when it matches anything, `app` otherwise. A
module is a source grouping: it becomes a `kind: "model-group"` aggregate,
`<service>.models-<module>`, the way a Django application does, because a
package is where the code lives and not a claim about a transactional
boundary. The service is the whole application; a monolith of forty packages
is one service with forty groups, and the events that cross between the
groups are the reason they are worth telling apart.

`vendor/`, tests, resources, storage and `Database/` (migrations, seeders,
factories) are not read as PHP. Two things from outside the code are looked
at for names only: the `*.blade.php` templates under a module, for the events
they dispatch, and `composer.lock`, for which package autoloads a namespace
the tree uses and does not declare.

## What becomes what

**Model.** A concrete class extending Eloquent's `Model` - or `Pivot`,
`MorphPivot`, `Illuminate\Foundation\Auth\User` - directly or through a base
class of the tree's own. Its fields are what it writes down, in this order:
the primary key, `id` typed `int` unless `$primaryKey` and `$keyType` say
otherwise; `$casts` with the type as cast (the `casts()` method in Laravel 11
counts); `$fillable` and `$guarded` columns with no cast, typed `mixed`
because the model does not say; `$dates`; `created_at` and `updated_at`
unless `$timestamps` is off; and one field per relation method, `items: HasMany[OrderItem]` for
`$this->hasMany(OrderItem::class)`, the target read off the first argument -
`X::class`, a string, or Concord's `XProxy::modelClass()` with the `Proxy`
taken off. The doc is the class docblock's first paragraph. `$hidden`,
accessors and scopes are not fields.

**Enum.** A backed PHP `enum` anywhere in the module, its values the backing
values; and on a model, two or more string constants sharing a prefix,
`STATUS_PENDING = 'pending'` beside `STATUS_CLOSED = 'closed'`, as one set
named `<Model> <Prefix>` with id `<group>.<model>-<prefix>`. A value's doc is
the constant's or case's docblock; `@deprecated` in it, or a `#[Deprecated]`
attribute, marks the value.

**Event, two ways.** A class under `Events/` - or using `Dispatchable` - is an
event with a payload: its promoted constructor parameters, then its public
properties, with the types as written; the wire name is the class's full name.
A string handed to `Event::dispatch('sales.order.cancel.after', $order)` or
`event('...')` is an event too, one with a name and no declared shape, id
`<group>.SalesOrderCancelAfter`, wire name the string, and no fields - which
is reported once per module rather than invented. Leaving those out would hide
most of what a package-built monolith publishes.

A class the tree does not declare is an event of the tree too when the tree
dispatches it: `event(new PasswordReset($user))` with Laravel's
`Illuminate\Auth\Events\PasswordReset` is the application publishing, and
only the shape is somebody else's. It is declared with no fields, a doc
naming the package composer.lock autoloads it from (`laravel/framework`),
and belongs to the module that dispatches it most. And a name a Blade
template dispatches - `view_render_event('bagisto.shop.products.price.after')`,
`Event::dispatch('...')` or `event('...')` with a literal in a view - is an
event when something in the tree listens to it; Bagisto's templates hold over
a thousand such hooks for markup, and only the ones a listener answers are
news.

A named event belongs to the module its name says: `sales.order.cancel.after`
is Sales's whoever dispatches it, by the first segment of the name or the
second. When no segment names a module it goes to the module that dispatches
it most. A class event belongs to the module that declares it.

**Consumer.** Everything Laravel accepts as a listener: an
`EventServiceProvider`'s `$listen` table, in each of its shapes
(`Listener::class`, `'Class@method'`, `[Class::class, 'method']`); its
`$subscribe` classes, read through their `subscribe()` - `$events->listen(...)`
or the returned `['event' => 'method']` map; `Event::listen(...)` anywhere;
and a class under `Listeners/` whose `handle(SomeEvent $e)` names an event of
the tree, which Laravel discovers on its own. Each is a consumer on the event,
`service` the application itself and `note` the handler, and a policy flow.

**Endpoint and inferred HTTP contract.** Every route file - anything under a
`Routes/` or `routes/` directory, or a `routes.php` - is read the way the
router would read it: `Route::get|post|put|patch|delete|options|any|match`,
inside `prefix`, `name`, `namespace`, `controller` and `group` calls that
apply to everything in their closure, in both the fluent and the
`Route::group(['prefix' => ...], fn)` spelling. `Route::resource` and
`apiResource` expand to the routes they stand for, with `only` and `except`
honoured and the parameter named the way Laravel names it; `update` is kept
as PUT, PATCH being the same operation. The action is read in every shape
Laravel takes: `'index'` under a `controller()` group, `[C::class, 'm']`,
`'C@m'`, `C::class` for an invokable, a closure. A route whose path or
action is computed at runtime is kept as unknown and reported rather than
guessed. A route without its own `name()` has none, even inside a named
group.

The routes of one module make one interface, `<service>.<module>`, with an
operation per route named after the route name (`shop.checkout.cart.index` →
`shop_checkout_cart_index`), or the controller and method when there is no
name, or the verb and path when there is neither; the doc is the controller
method's docblock. They also make an `openapi.inferred.yaml` OpenAPI 3.1
document, partial on purpose and marked `x-portolan-inferred` on every
operation: the route file proves the verb, the path, its parameters, which
method answers and what that method validates its request against, while the
response schema is not in what this reads and stays absent. A route answering
every verb is a path item with no operation. A checked-in document remains
`extract-openapi`'s richer source of truth. A controller the routes name that
is not in the tree is reported.

**What a request must satisfy.** An action says it in one of the ways Laravel
takes: a form request in its signature, whose `rules()` is the shape; or the
rules it validates with in the body - `$request->validate([...])`,
`request()->validate([...])`, `Validator::make($data, [...])`,
`$this->validate($request, [...])`, `validator($data, [...])`. Either way the
fields become the operation's request message on the interface, named after
the form request or, for rules in a body, after the controller and method
(`CartController::store` → `CartStoreRequest`); one message however many
routes share it. A method that validates nothing claims no shape, which is not
the same as taking nothing, and a form request whose `rules()` states no array
this can read is reported.

The rules arrive in the catalog's one vocabulary (portolan.0015):
`required` is the field's flag and `nullable` and `sometimes` leave it off,
`present` is `required`; `regex` is `pattern` without its delimiters; `in`,
`not_in` and `Rule::in([...])` are one closed set; `email`, `url`, `uuid`,
`ip` and `json` are a `format`, in the spelling a document uses (`url` → `uri`);
`starts_with` and `ends_with` are `prefix` and `suffix`; `distinct` is
`unique`. What `min`, `max`, `size` and `between` mean is decided the way
Laravel decides it, by the type the rules state: on a `string` they are
`min_len`, `max_len` and `len`, on an `integer` or `numeric` they are `gte`,
`lte` and `const`, on an `array` they are `min_items` and `max_items` - and a
rule set that states no type keeps Laravel's own word, `max = 255`, rather
than being given a meaning the source did not state. A rule the vocabulary has
no word for is kept as Laravel wrote it: `confirmed`, `required_if = status,
paid`, `unique = users, email`.

A key ending in `.*` is about what the list holds: its rules land on the list
under the `items.` prefix, and what the items say gives the list its type
(`options.* => string` makes `options` a `string[]`). A deeper key,
`lines.*.sku`, is a field of its own, named as the rules array names it.

The same shape is written into `openapi.inferred.yaml`, in JSON Schema's
words, which is the other half of that one vocabulary: a body for the verbs
that have one, query parameters for the verbs that do not, and one
`components.schemas` entry per message. `max_len` is `maxLength` there, `in`
is `enum`, `gte` is `minimum`, and reading the document back with
`extract-openapi` gives the rules it started as - a closed set excepted, which
OpenAPI keeps in the type where the catalog has always kept an enum. A rule
JSON Schema has no keyword for is kept beside the property under
`x-portolan-rules` rather than dropped.

**Flow.** One per endpoint: the call in, then every event the handler
publishes - itself, or through the classes it holds, `$this->orders->create()`
reaching `OrderRepository::create` when the constructor promoted `$orders`
with that type, up to five calls deep. And one per listener method: the
events it reacts to, then what it publishes in turn. A step's `ref` is the
event's id when the tree dispatches it. A class a package declares and only
the package dispatches - l5-repository's `RepositoryEntityDeleted`, fired by
every repository's `delete` inside the package - comes in from that package:
the step starts in an `external` lane named after it, `prettus/l5-repository`,
declared, with no `ref`, because there is nothing in the catalog to point
at. A name nobody dispatches is an unresolved step with a note, and
reported. Endpoint flows carry an exact verb/path `http`
trigger; listener flows carry an `event` trigger listing their declared events.

**Store.** The migrations, replayed. `extract-sql` reads DDL and a Laravel
schema is not DDL, so `Schema::create('orders', function (Blueprint $table)
{ ... })` is read here, one `$table->...` line at a time, in the order the
migration files sort - which is the order Laravel runs them - with
`Schema::table` alterations, `dropColumn`, `renameColumn`, `drop` and
`rename` applied on the way; only `up()` is read. Every column type Laravel's
blueprint has is mapped to its SQL spelling (`string` → `varchar(255)`,
`foreignId` → `bigint unsigned`, `decimal(12, 4)`, `enum('a','b')`,
`timestamps()` → two nullable timestamps), `nullable`, `unsigned`, `unique`,
`index`, `primary` and `comment` are honoured, and a foreign key is read
from `foreignId()->constrained()` and `foreign()->references()->on()`, with
its `onDelete`. The store is `<service>.<store>` (`db` unless the manifest
says), its kind read off config/database.php's default connection - mysql
when that cannot be read - and it goes into a second fragment, `stores.json`,
the way extract-django writes one. A table maps to the model whose `$table`
names it, or whose name Eloquent would pluralise to it (`OrderItem` →
`order_items`); its `persists` is that model's block and each column shared
with the model's fields carries `maps`. A table the code reaches that no
migration in the tree creates is kept with no columns, and reported.

**Table access.** `Order::create(...)`, `Order::where(...)->update(...)`,
`$this->model->find(...)` in a repository whose `model()` names the model -
or the Concord contract the model implements - and
`DB::table('orders')->insert(...)`: each is an access of the table, read,
write or delete by the strongest method on the chain, listed on the table
and drawn as a step to the store lane in every flow that reaches it.

**Job.** A class under `Jobs/` or implementing `ShouldQueue`. Every way one
is handed to the queue is read - `Job::dispatch(...)`, `dispatch(new Job)`,
`Bus::dispatch(new Job)`, the lists of `Bus::chain` and `Bus::batch`, written
out or built up first in a variable of the same method (`$jobs[] = new
ImportBatch($batch)`, then `Bus::batch($jobs)`, itself a link of a
`$chain[]` that `Bus::chain($chain)` dispatches) - and
the queue is the site's `onQueue('mail')`, else the job's own `$queue`, else
the queue its first dispatch site names, else `default`. Each queue is a
channel of kind `job` on the service, with a `send` message per job put on
it and a `receive` per job worked from it, the shape extract-celery writes
for a Celery queue; the transport is the connection config/queue.php
defaults to, and that file is the channel's source - the first job put on
the queue is no more its source than the last. A dispatch is a hop in the flow that makes it, a `call` to the
`Queue · mail` lane with a `job` handoff, and every job has a worker flow of
its own from the queue in through what `handle()` does. That worker flow has a
`job` trigger labelled with its resolved Laravel queue.

## What it does not read

Lifecycles; API resources as response schemas; rules a form request builds
rather than states - a `rules()` that returns a variable, or one whose array
is assembled in a loop; `$hidden`, accessors, scopes; broadcasting
(`ShouldBroadcast`), mail and notifications,
which go through the queue but are not jobs; `Cache::` and `Redis::`, which
are a keyspace and not a table; middleware and authorization. Each is a next
step, not an oversight.

## Options

See `options.schema.json`. `context` and `service` default to the input
directory's name; `modules` picks the layout; `repo` defaults to
composer.json's `support.source` or `homepage` when either is a repository;
`store` and `storeKind` name the database; `out`, `openapiOut` and
`storesOut` name the three files.

## Trying it on a real one

```
git clone --depth 1 https://github.com/bagisto/bagisto
printf '%s' '{"input":{"root":"bagisto","output":"bagisto/portolan"},"options":{"context":"commerce","service":"bagisto"}}' \
  | cargo run --quiet --manifest-path plugins/extract-laravel/Cargo.toml
```

On Bagisto 2.4 that is 41 packages read in well under a second: 29 model
groups, 125 models, 22 enums, 313 events - most of them named, dispatched
from admin and storefront controllers and owned by the package their name
says, 53 of them with a listener - ten HTTP interfaces with 520 operations,
a database of 138 tables and 1300 columns replayed from 189 migrations with
185 foreign keys and 120 places the code reads or writes them, 17 jobs on
one queue, 610 flows, and one controller the admin routes name that does not
exist.
