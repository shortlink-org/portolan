-- name: LineTotals :many
SELECT o.id, sum(l.qty) AS qty
FROM orders o
JOIN order_lines l ON l.order_id = o.id
GROUP BY o.id;

-- name: StaleOrders :many
SELECT id FROM orders WHERE state = 'draft';
