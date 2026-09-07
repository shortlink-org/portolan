package lockout

import "embed"

//go:embed migrations/*.sql
var migrations embed.FS

// Migrations is this aggregate's schema, and Name is the table the migrator
// records it in - schema_migrations_lockout. See the note on the session
// adapter for why each aggregate carries its own.
var (
	Migrations = migrations
	Name       = "lockout"
)
