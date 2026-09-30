package repository

import (
	"database/sql"

	sq "github.com/Masterminds/squirrel"
)

const ordersTable = "orders"

var psql = sq.StatementBuilder.PlaceholderFormat(sq.Dollar)

type Postgres struct {
	db *sql.DB
}

func (p *Postgres) ByID(id string) error {
	query, args, err := psql.Select("o.id", "l.sku").
		From(ordersTable + " o").
		LeftJoin("order_lines l ON l.order_id = o.id").
		Where(sq.Eq{"o.id": id}).
		ToSql()
	if err != nil {
		return err
	}
	return p.db.QueryRow(query, args...).Scan()
}

func (p *Postgres) Save(id string) error {
	_, err := sq.Insert(ordersTable).Columns("id", "state").Values(id, "draft").RunWith(p.db).Exec()
	return err
}

func (p *Postgres) Place(id string) error {
	b := sq.Update("orders")
	b = b.Set("state", "placed")
	_, err := b.From("carts").Where("carts.order_id = orders.id").RunWith(p.db).Exec()
	return err
}

func (p *Postgres) Remove(id string) error {
	_, err := sq.Delete("").From("order_lines").Where(sq.Eq{"order_id": id}).RunWith(p.db).Exec()
	return err
}
