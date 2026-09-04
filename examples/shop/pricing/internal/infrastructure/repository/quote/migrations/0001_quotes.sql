-- A quote is one basket, priced, with the lines it was priced from. Both are
-- written in the same transaction as the event that announces them.
CREATE TABLE quotes (
    id           text        NOT NULL PRIMARY KEY,
    basket_id    text        NOT NULL,
    total_minor  bigint      NOT NULL,
    currency     char(3)     NOT NULL,
    state        text        NOT NULL,
    issued_at    timestamptz NOT NULL,
    expires_at   timestamptz NOT NULL
);

-- The sweep asks for open quotes whose moment has passed, and asks often.
CREATE INDEX quotes_open_by_expiry ON quotes (state, expires_at);

CREATE INDEX quotes_by_basket ON quotes (basket_id);

CREATE TABLE quote_lines (
    quote_id         text    NOT NULL REFERENCES quotes (id) ON DELETE CASCADE,
    sku              text    NOT NULL,
    quantity         integer NOT NULL,
    unit_price_minor bigint  NOT NULL,
    currency         char(3) NOT NULL,
    PRIMARY KEY (quote_id, sku)
);

-- Events leave through here, in the transaction that made them.
CREATE TABLE outbox (
    id           bigserial   NOT NULL PRIMARY KEY,
    topic        text        NOT NULL,
    name         text        NOT NULL,
    aggregate_id text        NOT NULL,
    occurred_at  timestamptz NOT NULL,
    published_at timestamptz
);

CREATE INDEX outbox_unpublished ON outbox (id) WHERE published_at IS NULL;
