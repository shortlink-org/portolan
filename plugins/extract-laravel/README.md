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
factories) are not read.

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
operation: the route file proves the verb, the path, its parameters and which
method answers, while request and response schemas are not in what this
reads and stay absent. A route answering every verb is a path item with no
operation. A checked-in document remains `extract-openapi`'s richer source of
truth. A controller the routes name that is not in the tree is reported.

**Flow.** One per endpoint: the call in, then every event the handler
publishes - itself, or through the classes it holds, `$this->orders->create()`
reaching `OrderRepository::create` when the constructor promoted `$orders`
with that type, up to five calls deep. And one per listener method: the
events it reacts to, then what it publishes in turn. A step's `ref` is the
event's id when the tree dispatches it, and the step is unresolved with a
note when it does not - a framework event, or a name nobody in the tree
dispatches, which is reported.

## What it does not read

Jobs and queues (`dispatch(new Job)`, `ShouldQueue`), which are hops rather
than events; lifecycles; form requests and API resources as schemas; Concord
proxies and `Contracts` as a second name for a model; `$hidden`, accessors,
scopes; middleware and authorization. Each is a next step, not an oversight.

## Options

See `options.schema.json`. `context` and `service` default to the input
directory's name; `modules` picks the layout; `repo` defaults to
composer.json's `support.source` or `homepage` when either is a repository;
`out` and `openapiOut` name the two files.

## Trying it on a real one

```
git clone --depth 1 https://github.com/bagisto/bagisto
printf '%s' '{"input":{"root":"bagisto","output":"bagisto/portolan"},"options":{"context":"commerce","service":"bagisto"}}' \
  | cargo run --quiet --manifest-path plugins/extract-laravel/Cargo.toml
```

On Bagisto 2.4 that is 41 packages read in well under a second: 28 model
groups, 125 models, 22 enums, 326 events - most of them named, dispatched
from admin and storefront controllers and owned by the package their name
says, 50 of them with a listener - ten HTTP interfaces with 520 operations,
593 flows, and one controller the admin routes name that does not exist.
