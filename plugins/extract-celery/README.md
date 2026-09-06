# extract-celery

A tree with Celery in it in, work queues and job flows out. The Python twin of
`extract-river`: it does not need aggregates, does not treat a task as a
domain event, and answers with a channel of kind `job` per queue and a two-hop
flow per task — the call that enqueues it, and the worker that runs it.

Written in Python and run as a process plugin, `python3 plugins/extract-celery/main.py`.
Python 3.9 or newer and nothing but the standard library; the protocol, the
tree reader and the fragment shapes are `plugins/pyplugin`, shared with
`extract-django`. **The project is never imported**, and neither is Celery:
everything is read through `ast`, and names are resolved by import and by
file.

## What it reads

**A task** is a module-level function decorated `@shared_task`, `@app.task`
or `@<anything>.task`, with or without arguments. Its wire name is the
`name=` it was given, or what Celery composes when it was not: the module's
dotted path and the function's name, `invoices.tasks.send_invoice_email`. A
`queue=` on the decorator is where it goes unless a call says otherwise. The
doc is the docstring, first paragraph. A class-based task is not read.

**An enqueue** is `t.delay(...)`, `t.apply_async(...)`, or either through a
signature, `t.s(...).apply_async()`. A `chain`, `group` or `chord` holds
several signatures; each is recorded as an enqueue, noted with the canvas it
sits in, and the order the canvas imposes is not drawn. `app.send_task("name")`
enqueues by wire name, for a task that may live in another tree.
`transaction.on_commit(lambda: t.delay(...))` — and the `partial` form — is
the same enqueue with the note that it waits for the commit, which is the one
fact about *when* a message leaves that the code states plainly. A
`countdown=` or an `eta=` is noted too. Every module of the tree is searched:
services, views, receivers, other tasks.

**The queue** is decided the way Celery decides it: the `queue=` at the call,
then the decorator's, then `task_routes` — an exact name before a glob, in the
order written — then `task_default_queue`, and past all of those Celery's own
`celery`. Each message says which rule placed it.

**The configuration** is read from two places, the settings first and the app
module over them, which is the order Celery applies them in. The app module
is wherever `X = Celery(...)` is assigned; its `config_from_object(...,
namespace="CELERY")` names the prefix the settings are read under, and its
`X.conf.update(...)` and `X.conf.key = ...` are read as written. The settings
module is what `manage.py` sets `DJANGO_SETTINGS_MODULE` to, or the `settings`
option. Three keys matter — `task_routes`, `task_default_queue`, `broker_url`
— and the pre-4.0 spellings of them are accepted. A value is read as far as
syntax carries it: a literal, the default of `os.environ.get("X", default)`,
a module-level constant followed once. A router function is not run, and is
said not to be.

## What comes out

One `channel` per queue, `kind: "job"`, `address` the queue, one message per
task on it: `send` when this tree enqueues it, `receive` when this tree
declares it. The doc of the `receive` says which rule placed it. The kind is
what lets many callers enqueue one task without the merge calling them rival
publishers, and what keeps a task out of the Problems page's search for a
domain event with the same wire name.

One `flow` per task that is both enqueued and declared here: `service →
broker : call enqueue <task>` at the first call in path order, with the
others named in the note, then `broker → service : call <task>` at the
function. The broker participant is `celery-<queue>`. Every step is
`declared`.

## What it does not read

Named here rather than left to be discovered: **beat schedules** (a move the
clock makes is not a move, and nothing in the tree runs when it fires),
**retries, rate limits and time limits**, **the result backend**, **task
priority**, a **router function** in `task_routes`, a **regex** route, and a
**worker's `-Q`** — which queues a worker actually consumes is a fact about a
deployment, not the tree.

## Options

```json
{
  "context": "shop",
  "service": "billing",
  "source": ".",
  "settings": "config.settings",
  "out": "celery.json"
}
```

`source` is the directory the tasks and their callers are looked for in, the
input root unless said otherwise. `settings` is only needed where `manage.py`
does not name the settings module.

## Extraction limits

These cases do not become facts in the fragment, and each is reported:

- a tree with no task in it;
- a task nothing in the tree enqueues — it is still a `receive`, on the queue
  its route gives it;
- an enqueue of a name that does not resolve to a task declared here;
- a task sent by name that no function here declares — a `send` with no
  handler, and no flow;
- a `task_routes` pattern that matches no task;
- `task_routes` that is not a literal mapping;
- a settings module named and not found;
- a file that does not parse, by path.

## Manifest

```json
{
  "plugins": [{ "name": "celery", "process": { "command": "python3", "args": ["plugins/extract-celery/main.py"] } }],
  "extract": [
    {
      "plugin": "celery",
      "in": "examples/shop/billing",
      "out": "examples/shop/billing/portolan",
      "options": { "context": "shop", "service": "billing", "out": "celery.json" }
    }
  ]
}
```

## Tests

```bash
python3 -m unittest discover -s plugins/extract-celery -t plugins/extract-celery -p "*_test.py"
```

The reader is held to fixtures under `testdata/`: `billing`, a Django project
with each shape this reads present once — the three ways a queue is chosen,
`on_commit` in both forms, a signature, a countdown — against the golden
`expected.json`; and `drift`, a tree where every diagnostic the reader is
meant to raise is raised once. `UPDATE_GOLDEN=1` writes the goldens again
after a deliberate change, and the diff is the review.
