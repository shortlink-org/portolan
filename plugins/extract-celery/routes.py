"""Which queue a task lands on, decided the way Celery decides it.

The call comes first, `apply_async(queue=...)`; then the decorator's
`queue=`; then `task_routes`, an exact name before a glob, in the order they
are written; then `task_default_queue`; and past all of those Celery's own
`celery`. Every answer says which rule gave it, so a page can say "routed by
task_routes" rather than leave a reader to work it out.
"""

from __future__ import annotations

from fnmatch import fnmatchcase
from typing import List, Tuple

from conf import DEFAULT_QUEUE, Config

AT_CALL = "named at the call"
ON_TASK = "named on the task"
BY_ROUTES = "routed by task_routes"
BY_DEFAULT = "the default queue"
BY_CELERY = "Celery's own default"


def queue_for(wire: str, at_call: str, on_task: str, cfg: Config) -> Tuple[str, str]:
    if at_call:
        return at_call, AT_CALL
    if on_task:
        return on_task, ON_TASK
    for pattern, queue in cfg.routes:
        if matches(pattern, wire):
            return queue, BY_ROUTES
    if cfg.default_queue:
        return cfg.default_queue, BY_DEFAULT
    return DEFAULT_QUEUE, BY_CELERY


def matches(pattern: str, wire: str) -> bool:
    """Celery takes a glob - `invoices.tasks.*` - and a compiled regex; only
    the glob is syntax, so only the glob is matched here."""
    return pattern == wire or fnmatchcase(wire, pattern)


def unmatched(cfg: Config, wires: List[str]) -> List[str]:
    """Route patterns that name no task in the tree: a route to nowhere is
    stale, or the task moved."""
    return [pattern for pattern, _ in cfg.routes if not any(matches(pattern, wire) for wire in wires)]
