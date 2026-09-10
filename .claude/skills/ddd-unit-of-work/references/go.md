# Unit of work in Go

Read [platform/uow](../../../../examples/auth/internal/platform/uow/uow.go).
`Do` joins the transaction carried by `go-sdk/uow` when one exists; otherwise
it opens a transaction and supplies the shared lookup context.

[Root storage wiring](../../../../examples/auth/internal/di/provider/storage.go)
and [outbox wiring](../../../../examples/auth/internal/di/provider/outbox.go)
must use the same lookup. The [user repository](../../../../examples/auth/internal/user/infrastructure/repository/postgres.go)
commits aggregate storage and mapped integration-event append together.

[Session revocation](../../../../examples/auth/internal/session/application/end_after_credential_change/usecase.go)
shows per-item handling of independent aggregate updates; re-read and re-evaluate
on an optimistic conflict under the operation's bounded retry policy. Do not
repeat external effects inside a blind retry loop.

A new projector uses its own local transaction for rows and checkpoint, applying
strictly version + 1. It never tries to join the already-committed producer unit.
See [projector procedure](../../ddd-cqrs/references/go.md).

Backend fixtures belong beside infrastructure/platform/composition tests, not
every use case. [UoW tests](../../../../examples/auth/internal/platform/uow/uow_test.go)
and [outbox tests](../../../../examples/auth/internal/di/provider/outbox_test.go)
verify the production lookup path.
