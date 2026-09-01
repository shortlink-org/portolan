package session

import "embed"

//go:embed migrations/*.sql
var migrations embed.FS

// Migrations is this aggregate's schema, and Name is the table the migrator
// records it in - schema_migrations_session.
//
// A table exists because an aggregate exists, so the schema lives next to the
// code that reads it rather than in a pile at the root. Numbering starts at 1
// within this package: user and session both have an 0001 and neither waits for
// the other, which works because no table here refers to one of theirs.
//
// The files are named .up.sql because the migrator reads a direction from the
// name. There are no .down.sql files: a down migration here would drop the
// table, which is not a rollback but a way to lose everything, and nothing in
// this service would ever be right to run it.
var (
	Migrations = migrations
	Name       = "session"
)
