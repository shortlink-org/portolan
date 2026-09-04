-- Events awaiting the relay, written in the transaction that changed the
-- basket. The same columns the Go services' outbox has, so a reader of one
-- reads the other.
CREATE TABLE outbox (
    id           bigserial PRIMARY KEY,
    uuid         uuid NOT NULL,
    topic        text NOT NULL,
    payload      jsonb NOT NULL,
    metadata     jsonb NOT NULL,
    created_at   timestamptz NOT NULL,
    published_at timestamptz
);

CREATE INDEX outbox_unpublished ON outbox (id) WHERE published_at IS NULL;
