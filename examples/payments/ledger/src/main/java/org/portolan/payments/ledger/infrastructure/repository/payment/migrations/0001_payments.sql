-- The payment, and the postings that account for it.
--
-- A payment row is one attempt at charging one order: unique on (order_id,
-- attempt), which is what payments.0004 asks for, and what lets a webhook
-- arriving twice be the same attempt rather than a second charge.
CREATE TABLE payments (
    id           text        NOT NULL PRIMARY KEY,
    order_id     text        NOT NULL,
    attempt      integer     NOT NULL,
    amount_minor bigint      NOT NULL,
    currency     char(3)     NOT NULL,
    status       text        NOT NULL,
    auth_code    text,
    created_at   timestamptz NOT NULL,
    CONSTRAINT payments_order_attempt_key UNIQUE (order_id, attempt)
);

CREATE INDEX payments_status_idx ON payments (status);

-- Append-only, and balanced: the two rows of one movement sum to zero. There
-- is deliberately no UPDATE path in the adapter above this table.
CREATE TABLE postings (
    id           bigserial   NOT NULL PRIMARY KEY,
    payment_id   text        NOT NULL REFERENCES payments (id) ON DELETE RESTRICT,
    account      text        NOT NULL,
    amount_minor bigint      NOT NULL,
    currency     char(3)     NOT NULL,
    written_at   timestamptz NOT NULL
);

CREATE INDEX postings_by_payment ON postings (payment_id);
