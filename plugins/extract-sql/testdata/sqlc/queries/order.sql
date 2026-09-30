-- name: GetOrder :one
SELECT id, state FROM orders
WHERE id = $1;

-- name: InsertOrder :exec
INSERT INTO orders (id, state) VALUES ($1, $2);

-- name: DeleteOrderLines :exec
DELETE FROM order_lines WHERE order_id = $1;
