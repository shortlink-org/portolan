-- The relay needs what the bus needs: an id to deduplicate on, the payload as
-- it will travel, and the metadata the event's name and the trace context
-- ride in. name and aggregate_id stay as columns: what was announced about
-- which quote is a query on them, not on JSON.
ALTER TABLE outbox
    ADD COLUMN uuid     text  NOT NULL,
    ADD COLUMN payload  jsonb NOT NULL,
    ADD COLUMN metadata jsonb NOT NULL;

-- One row per message id: the bus deduplicates on it, and so does the table.
CREATE UNIQUE INDEX outbox_by_uuid ON outbox (uuid);
