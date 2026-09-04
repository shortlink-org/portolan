-- The aggregate root and its lines. One row per basket, one per line; the
-- version is bumped by every write and checked by every write.
CREATE TABLE baskets (
    id          uuid PRIMARY KEY,
    token       text NOT NULL UNIQUE,
    customer_id text,
    currency    char(3),
    status      text NOT NULL,
    touched_at  timestamptz NOT NULL,
    version     integer NOT NULL
);

CREATE INDEX baskets_open_by_customer ON baskets (customer_id) WHERE status = 'open';
CREATE INDEX baskets_idle ON baskets (touched_at) WHERE status = 'open';

CREATE TABLE basket_items (
    basket_id        uuid NOT NULL REFERENCES baskets (id) ON DELETE CASCADE,
    sku              text NOT NULL,
    quantity         integer NOT NULL,
    unit_price_minor bigint NOT NULL,
    currency         char(3) NOT NULL,
    PRIMARY KEY (basket_id, sku)
);
