package repository

import (
	"context"

	"gorm.io/gorm"
)

const linesTable = "order_lines"

// OrderRecord names its table itself.
type OrderRecord struct {
	ID    string
	State string
}

func (OrderRecord) TableName() string { return "orders" }

// OrderLine takes gorm's default: order_lines.
type OrderLine struct {
	OrderID string
	SKU     string
}

type Postgres struct {
	db *gorm.DB
}

func (p *Postgres) Save(ctx context.Context, o OrderRecord, lines []OrderLine) error {
	return p.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&o).Error; err != nil {
			return err
		}
		for _, l := range lines {
			if err := tx.Create(&l).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (p *Postgres) ByID(ctx context.Context, id string) (OrderRecord, error) {
	var o OrderRecord
	err := p.db.WithContext(ctx).Where("id = ?", id).First(&o).Error
	return o, err
}

func (p *Postgres) Lines(ctx context.Context, id string) ([]OrderLine, error) {
	var lines []OrderLine
	err := p.db.WithContext(ctx).Table(linesTable).Where("order_id = ?", id).Find(&lines).Error
	return lines, err
}

func (p *Postgres) CountPlaced(ctx context.Context) (int64, error) {
	q := p.db.WithContext(ctx).Model(&OrderRecord{})
	q = q.Where("state = ?", "placed")
	var n int64
	err := q.Count(&n).Error
	return n, err
}

func (p *Postgres) Cancel(ctx context.Context, id string) error {
	return p.db.Model(&OrderRecord{}).Where("id = ?", id).Update("state", "cancelled").Error
}

func (p *Postgres) Totals(ctx context.Context) error {
	var rows []struct{ ID string }
	return p.db.Raw("SELECT o.id FROM orders o JOIN order_lines l ON l.order_id = o.id").Scan(&rows).Error
}
