# Queries and ordered projectors in Go

Current [get query](../../../../examples/auth/internal/user/application/get/usecase.go)
uses [slice-owned Query/Result](../../../../examples/auth/internal/user/application/get/model.go).
Its application tests mock the repository; SQL readers need backend tests in
infrastructure. A screen-specific port belongs to its query slice.

## Ordered projector design

Current auth has no versioned projection to copy. This is a procedure for new
ordered consumers, not a claim about its existing integration DTOs. Introduce
the [versioned record contract](../../ddd-domain-event/references/go.md) first.

Place the projector under the owning module's infrastructure, with its migrations.
Store a checkpoint keyed by `(consumer_id, stream_id)` independently of read rows.
The initial checkpoint is 0, or the exact position of a consistent bootstrap
snapshot. Example transaction algorithm:

```text
begin local transaction
insert checkpoint at 0 if absent (unique consumer_id, stream_id)
select checkpoint for update
if incoming.version <= checkpoint.version:
    commit without effects; acknowledge duplicate
else if incoming.version > checkpoint.version + 1:
    rollback; recover missing history or durably park; do not advance
else:
    validate supported schema/type (unknown required record stops processing)
    apply every effect of the record, or an explicit supported no-op
    update checkpoint to incoming.version
    commit; acknowledge
```

Any decoding/effect error rolls back both rows and checkpoint. The unique key and
row lock serialize first delivery and concurrent retries; conditional-update
implementations must supply equivalent guarantees. Several facts at one position
are an atomic batch. A transaction handling a record from another stream reads
and updates that stream's checkpoint, not a global maximum.

For delta events `+10` at version 1 and `+5` at version 2, receiving version 2
first leaves both total and checkpoint unchanged. Recover version 1, then apply
version 2: total is 15. Delivering version 2 again changes nothing. No occurred-at
comparison participates in the decision.

If rows can be deleted, retain the checkpoint/tombstone so an old delivery cannot
recreate them. A new consumer replays from 1 or restores a consistent snapshot
with checkpoints, then replays the suffix. Name the retained history source;
outbox cleanup must not erase the only recovery data.

A gap record parked durably must be retriggered after the missing version commits.
For a strictly serial broker partition, do not endlessly retry its head while the
missing version is queued behind it: fetch history or park to unblock recovery.
Register the projector in assembly against the complete versioned stream.

Tests cover contiguous order, duplicate, gap/recovery, first-row races, rollback,
multiple streams, snapshot bootstrap, and unknown required schema. Assert rows
and checkpoints through a real backend.
