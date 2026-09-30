package repository

import "context"

// The generated package is not imported here; p.q's declared type says whose
// InsertOrder this is.
func (p *Postgres) Save(ctx context.Context, id, state string) error {
	return p.q.InsertOrder(ctx, id, state)
}
