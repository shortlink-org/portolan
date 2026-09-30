CREATE TABLE orders (
    id    uuid PRIMARY KEY,
    state text NOT NULL
);

CREATE TABLE order_lines (
    order_id uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    sku      text NOT NULL
);

CREATE TABLE carts (
    id       uuid PRIMARY KEY,
    order_id uuid
);
