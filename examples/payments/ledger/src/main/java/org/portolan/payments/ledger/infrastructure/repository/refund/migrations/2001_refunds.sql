-- Money going back, against a payment that was captured.
CREATE TABLE refunds (
    id           text        NOT NULL PRIMARY KEY,
    payment_id   text        NOT NULL REFERENCES payments (id) ON DELETE RESTRICT,
    order_id     text        NOT NULL,
    amount_minor bigint      NOT NULL,
    currency     char(3)     NOT NULL,
    reason       text        NOT NULL,
    status       text        NOT NULL,
    settled_at   timestamptz
);

CREATE INDEX refunds_by_payment ON refunds (payment_id);
