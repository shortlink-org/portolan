-- A list is imported whole and archived rather than edited, so that what a
-- quote was priced against stays readable for as long as the quote does.
CREATE TABLE price_lists (
    id         text        NOT NULL PRIMARY KEY,
    name       text        NOT NULL,
    currency   char(3)     NOT NULL,
    valid_from timestamptz NOT NULL,
    archived   boolean     NOT NULL DEFAULT false
);

-- Which list is in force for a currency, which is asked on every quote.
CREATE INDEX price_lists_in_force ON price_lists (currency, valid_from);

CREATE TABLE price_rows (
    price_list_id text   NOT NULL REFERENCES price_lists (id) ON DELETE CASCADE,
    sku           text   NOT NULL,
    amount_minor  bigint NOT NULL,
    PRIMARY KEY (price_list_id, sku)
);
