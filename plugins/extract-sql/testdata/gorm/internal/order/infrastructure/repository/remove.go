package repository

import "context"

// No gorm import here: p.db is declared a *gorm.DB in gorm.go, and that is
// what makes this a gorm call.
func (p *Postgres) Remove(ctx context.Context, id string) error {
	return p.db.Delete(&OrderLine{}, "order_id = ?", id).Error
}
