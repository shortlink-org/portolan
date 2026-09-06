"""A tree with Celery in it in, one fragment out: the work queues the service
sends on and works from, and one flow per task that is both enqueued and
declared here.

A fragment, not a catalog: it carries one context and one service with
nothing on it but channels, and is merged with what the domain extractor said
about the same service before anything validates it. A task is not a domain
event and is not written as one; the queue is a channel of kind `job`, which
is what lets many callers enqueue the same task without the merge calling
them rival publishers.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional, Tuple

import catalog
import conf
import routes
from names import slug, title
from options import Options
from producers import Producer, read_producers
from protocol import Builder, File, Input
from source import Project
from tasks import Task, index, read_tasks

JOB = "job"


class Queue:
    """One queue as the fragment sees it: the tasks sent on it and the tasks
    worked from it."""

    def __init__(self, address: str):
        self.address = address
        self.sends: Dict[str, List[Producer]] = {}  # wire name -> its producers, in path order
        self.works: Dict[str, Task] = {}  # wire name -> the task declared here
        self.how: Dict[str, str] = {}  # wire name -> which rule routed it


def extract(input_: Input, opts: Options, b: Builder, cwd: str = "") -> None:
    cwd = cwd or os.getcwd()
    root = os.path.abspath(os.path.join(cwd, input_.root))

    def rel(path: str) -> str:
        return os.path.relpath(path, cwd).replace(os.sep, "/")

    source = os.path.normpath(os.path.join(root, opts.source or "."))
    context = opts.context or os.path.basename(root)
    service = opts.service or os.path.basename(root)
    svc_id = context + "." + service

    project = Project(root, source, rel)
    for path, message in project.broken:
        b.warn(path, "cannot be parsed, so nothing in it is read: %s" % message)

    tasks = read_tasks(project)
    if not tasks:
        b.warn(svc_id, "no Celery tasks under %s: a function decorated @shared_task or @app.task is what this reads" % rel(source))
    by_key, by_name = index(tasks)

    cfg = conf.read_config(project, opts.settings)
    if cfg.settings and not cfg.settings_found:
        b.warn(svc_id, "settings module `%s` not found: only what the app module configures itself is read, and a task nothing places lands on `%s`" % (cfg.settings, conf.DEFAULT_QUEUE))
    elif not cfg.settings and not cfg.apps:
        b.warn(svc_id, "no Celery app and no settings module found, so a task with no queue of its own lands on `%s`" % conf.DEFAULT_QUEUE)
    for where in cfg.opaque:
        b.warn(where, "task_routes is not a literal mapping, so the routes are not read: this reader does not run a router")
    for pattern in routes.unmatched(cfg, [task.name for task in tasks]):
        b.warn(svc_id, "task_routes pattern `%s` matches no task in this tree" % pattern)

    queues: Dict[str, Queue] = {}

    def queue(address: str) -> Queue:
        if address not in queues:
            queues[address] = Queue(address)
        return queues[address]

    enqueued = set()
    for producer in read_producers(project):
        task: Optional[Task] = None
        if producer.wire:
            task = by_name.get(producer.wire)
            wire = producer.wire
        else:
            task = by_key.get(producer.key) if producer.key else None
            if task is None:
                # An unresolved name that only one task answers to is that task.
                same = [t for t in tasks if t.short == producer.label]
                task = same[0] if len(same) == 1 else None
            if task is None:
                b.warn(producer.line, "`%s` is enqueued, but does not resolve to a task declared in this tree" % producer.label)
                continue
            wire = task.name
        address, how = routes.queue_for(wire, producer.queue, task.queue if task else "", cfg)
        q = queue(address)
        q.sends.setdefault(wire, []).append(producer)
        q.how.setdefault(wire, how)
        if task is not None:
            q.works[wire] = task
            enqueued.add(task.key)
        else:
            b.warn(producer.line, "`%s` is sent as a task no function in this tree declares; recorded as a send with no handler here" % wire)

    for task in tasks:
        if task.key in enqueued:
            continue
        b.warn(task.line, "task `%s` is declared, but nothing in this tree enqueues it" % task.name)
        address, how = routes.queue_for(task.name, "", task.queue, cfg)
        q = queue(address)
        q.works[task.name] = task
        q.how.setdefault(task.name, how)

    channels = [channel_of(queues[address], cfg) for address in sorted(queues)]
    flows = []
    for address in sorted(queues):
        q = queues[address]
        for wire in sorted(q.sends):
            task = q.works.get(wire)
            if task is not None:
                flows.append(flow_of(svc_id, context, service, q, wire, task, queues))
    flows.sort(key=lambda f: f["slug"])

    fragment: Dict[str, Any] = {
        "generatedAt": input_.generated_at,
        "commit": input_.commit,
        "contexts": [
            {
                "id": context,
                "slug": context,
                "name": "",
                "summary": "",
                "services": [
                    {
                        "id": svc_id,
                        "slug": service,
                        "name": "",
                        "repo": "",
                        "path": "",
                        "readme": "",
                        "provides": [],
                        "consumes": [],
                        "aggregates": [],
                        "channels": channels,
                    }
                ],
            }
        ],
        "defs": {},
        "flows": flows,
        "adrs": [],
    }
    b.files.append(File(name=opts.out or "celery.json", contents=json.dumps(fragment, indent=2, ensure_ascii=False) + "\n"))


def channel_of(q: Queue, cfg: conf.Config) -> Dict[str, Any]:
    messages = []
    source = ""
    for wire in sorted(set(q.sends) | set(q.works)):
        task = q.works.get(wire)
        producers = q.sends.get(wire, [])
        doc = task.doc if task else ""
        if producers:
            messages.append(catalog.message(wire, task.short if task else wire, doc, "send"))
            source = source or producers[0].line
        if task:
            handled = "Worked by `%s`, %s." % (task.short, q.how[wire])
            if not producers:
                handled += " Nothing in this tree enqueues it."
            messages.append(catalog.message(wire, task.short, (handled + " " + doc).strip(), "receive"))
            source = source or task.line
    doc = "Tasks enqueued and worked through Celery"
    doc += " over %s." % cfg.broker_scheme if cfg.broker_scheme else "."
    return catalog.channel(q.address, JOB, "Celery · " + q.address, doc, messages, source)


def flow_of(svc_id: str, context: str, service: str, q: Queue, wire: str, task: Task, queues: Dict[str, Queue]) -> Dict[str, Any]:
    slugged = slug(service + "-celery-" + task.short)
    # The same task sent on two queues is two flows, told apart by the queue.
    if sum(1 for other in queues.values() if wire in other.sends and wire in other.works) > 1:
        slugged += "-" + slug(q.address)
    # No dot in the id: a participant is a root of the model, and a dotted id
    # would read as something nested under a `celery` nobody declared.
    broker = "celery-" + slug(q.address)
    producers = q.sends[wire]
    first = producers[0]
    notes = list(first.notes)
    enqueue_note = ("Enqueued " + ", ".join(notes) + ". " if notes else "") + task.doc
    if len(producers) > 1:
        enqueue_note = (enqueue_note + " Also enqueued at %s." % ", ".join(p.line for p in producers[1:])).strip()
    return catalog.flow(
        "flow." + slugged,
        slugged,
        title(task.short) + " task",
        "Celery task `%s` is enqueued on `%s` and worked by `%s`." % (wire, q.address, task.short),
        first.module.rel,
        context,
        [
            catalog.participant(svc_id, "service", context),
            catalog.participant(broker, "broker", None, "Celery · " + q.address),
        ],
        [
            catalog.step("enqueue", svc_id, broker, "call", "enqueue " + task.short, catalog.DECLARED, note=enqueue_note.strip(), line=first.line),
            catalog.step("work", broker, svc_id, "call", task.short, catalog.DECLARED, note="Celery hands `%s` to the worker consuming `%s`, %s." % (wire, q.address, q.how[wire]), line=task.line),
        ],
    )
