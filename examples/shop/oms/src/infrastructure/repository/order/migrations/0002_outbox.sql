-- Events wait here for the relay, written in the transaction that produced
-- them. The uuid is the message id on the bus; published_at is set once the
-- bus has taken the row, and a row taken twice is the bus's to deduplicate.
CREATE TABLE outbox (
    id           BIGSERIAL PRIMARY KEY,
    uuid         TEXT NOT NULL UNIQUE,
    topic        TEXT NOT NULL,
    payload      JSONB NOT NULL,
    metadata     JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ
);

CREATE INDEX outbox_unpublished ON outbox (id) WHERE published_at IS NULL;
