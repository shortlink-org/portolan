# pyplugin

A shared Python package, not a plugin: the three things every Python
extractor needs, written once the way `plugin/` is shared by the Go ones.
`extract-django`, `extract-celery` and `extract-python-kafka` use it; each
adds the package to `sys.path` from its `main.py` and keeps its own options
dataclass.

## What it reads

- `source.py` - the tree, read as syntax with `ast`. The project is never
  imported: `django.setup()` runs code, reads the environment and opens
  sockets. Names are resolved by import and by file. `.git`, caches,
  virtualenvs, `build`, `dist`, `migrations`, `node_modules`,
  `site-packages`, `static`, `templates` and `tests` are skipped.
- `celery_conf.py` - where a task goes: `app.conf.update(...)`,
  `app.conf.task_routes = ...`, and the settings module read through
  `config_from_object(..., namespace="CELERY")`, settings first and the
  app's own assignments over them. `task_routes`, `task_default_queue`,
  `broker_url` and `beat_schedule` (plus `add_periodic_task`) are read, the
  pre-4.0 spellings included; a non-literal value is read as far as it goes.
- `celery_tasks.py` - every function decorated `@shared_task`, `@app.task`
  or `@<x>.task`, its wire name (`name=` or module path plus function) and
  `queue=`. A class-based task is not read.
- `kafka.py` - `confluent_kafka`, `kafka-python` and `aiokafka` producers and
  consumers, constructed and called, without importing the project.

## What it emits

- `protocol.py` - the plugin protocol as `plugin/protocol.go` spells it: one
  JSON request on stdin, one response on stdout, the `describe` answer, and
  `Input` (`root`, `output`, `repository`) with its path spelling helpers.
  Nothing reads the environment or the clock.
- `catalog.py` - the fragment shapes in the order `catalog/model.go`
  declares them, so the key order of a regenerated fragment is stable;
  `field()` writes `required` only when true and `rules` only when there are
  any.
- `names.py` - `slug` (`PriceList` is `price-list`), `camel`
  (`issue_invoice` is `IssueInvoice`) and `title`, the rules `extract-go`
  lives by.

## Options

None; it is a library.

## Manifest

Nothing in a manifest names it. The plugins that use it are declared as
processes, for example
`{ "name": "celery", "process": { "command": "python3", "args": ["plugins/extract-celery/main.py"] } }`.

## Runtime

Python 3 standard library only (`ast`, `dataclasses`, `json`, `os`).

## Limits

- Syntax only; a value that is not a literal is unknown past its default,
  and is said rather than guessed.
- The Kafka reader knows client APIs, not framework conventions.

## Tests

`*_test.py` beside each module, with `testdata/shop` as the smallest tree
that has one of everything `source.py` reads:
`python3 -m unittest discover -s plugins/pyplugin -p '*_test.py'`. The
`*_test.py` files of `extract-django`, `extract-celery` and
`extract-python-kafka` exercise it further.
