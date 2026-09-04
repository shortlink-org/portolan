-- The order, and its lines beside it. One row per order, one per line; the
-- basket is unique, which is what makes placing from the same checkout twice
-- find the first order rather than make a second.
CREATE TABLE orders (
    id          TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    -- The basket this order was placed from: the id is copied off the event
    -- cart published, and cart stays the only writer of the row it names.
    -- from: shop.cart.pg.baskets.id
    basket_id   TEXT NOT NULL UNIQUE,
    status      TEXT NOT NULL,
    total_minor BIGINT NOT NULL,
    currency    TEXT NOT NULL,
    placed_at   TIMESTAMPTZ NOT NULL,
    version     INTEGER NOT NULL
);

CREATE TABLE order_lines (
    order_id         TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    sku              TEXT NOT NULL,
    quantity         INTEGER NOT NULL,
    unit_price_minor BIGINT NOT NULL,
    currency         TEXT NOT NULL,
    PRIMARY KEY (order_id, sku)
);
