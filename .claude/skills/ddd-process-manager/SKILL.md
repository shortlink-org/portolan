---
name: ddd-process-manager
description: Design a durable business process across aggregates or services, including progress, timeouts and compensation. Use when a single event policy is insufficient, or when evaluating Temporal for a long-running workflow.
---

# Process manager and saga

Use [ddd-policy](../ddd-policy/SKILL.md) for a single independent reaction.
Use a process manager when later decisions depend on persisted progress across
several steps, deadlines, external responses or human actions. A saga includes
business compensations for already committed steps; it is not one database
transaction across services.

## Define the business process

Name its owner, process identity, entry command and terminal outcomes. Write
steps as a table: trigger, precondition, command, expected response, timeout,
retry policy and compensation. Include partial success and the point after
which automatic compensation is no longer valid.

Each aggregate retains its invariants and local transaction. The process
coordinates use cases through ports or public contracts, never changes peer
repositories directly. Keep business decisions independent of the workflow
engine; engine-specific orchestration belongs at the infrastructure boundary.

## Survive interruption

- Persist progress before relying on it after a restart. For a database-backed
  coordinator, commit progress and the next outbox command atomically.
- Give every logical operation a stable idempotency key, reused on retries.
  Distinguish an uncertain outcome from a confirmed refusal: reconcile before
  repeating an irreversible operation.
- Define bounded retries and deadlines; terminal business refusals do not
  become infinite retries. Compensation is a separate idempotent business
  action and may also fail; name the recovery or manual intervention path.
- Correlate responses to the process and step; handle duplicates, late replies,
  cancellation and timer/response races. For ordered event consumers follow
  [ddd-domain-event](../ddd-domain-event/SKILL.md).
- Show process state, last failure, next deadline and stalled work to operators.

## Temporal as an implementation option

Consider Temporal when durable waits, retries, signals and recovery are real
requirements. Compare its operational cost with a small persisted coordinator;
a single policy does not justify adding it.

A Temporal Workflow must be deterministic under replay. Use workflow-safe time
and timers; put database/network I/O in Activities. Activities invoke use cases
or external ports, with stable operation keys and explicit retry/timeouts;
Temporal does not make external effects exactly once. Register compensation
intent so a timeout after an external success can still be reconciled.

Keep Workflow IDs stable for the business process and define duplicate-start
behaviour. Deliver a database-committed start/signal reliably (for example,
through an outbox bridge); a direct call after commit leaves a crash window.
Plan compatible changes for running histories and test replay before deploying
a changed workflow. Workflow history is not the service's integration-event log.

Verify SDK-specific code against the installed version and official docs:
[Workflows](https://docs.temporal.io/workflows),
[Activities](https://docs.temporal.io/activities).
These are implementation constraints; choosing Temporal does not change the
context map or move aggregate invariants into the engine.

## Validation

Exercise success, failure after each committed step, duplicate/late delivery,
restart, timeout after external success, failed compensation and cancellation.
Assert final business state and external effects, not just workflow completion.
For Temporal include deterministic replay and Activity retry tests.
