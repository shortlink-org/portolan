CREATE TYPE order_status AS ENUM ('draft', 'placed');

CREATE TABLE orders (
    id         uuid PRIMARY KEY,
    status     order_status NOT NULL,
    customer_id uuid NOT NULL
);

CREATE TABLE order_lines (
    order_id uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    line_no  integer NOT NULL,
    sku      text NOT NULL,
    PRIMARY KEY (order_id, line_no)
);

CREATE UNIQUE INDEX orders_customer_id_key ON orders (customer_id);

CREATE VIEW placed_orders AS
SELECT id, customer_id
FROM orders
WHERE status = 'placed';
