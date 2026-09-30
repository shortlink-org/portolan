CREATE TABLE orders (
    id    uuid PRIMARY KEY,
    state text NOT NULL
);

CREATE TABLE order_lines (
    order_id uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    sku      text NOT NULL,
    qty      integer NOT NULL
);
