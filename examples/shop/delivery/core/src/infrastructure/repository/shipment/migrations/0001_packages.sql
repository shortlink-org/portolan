-- What is being carried, one row per shipment, and the boxes it is made of.
CREATE TABLE packages (
    id            text NOT NULL PRIMARY KEY,
    -- The order this shipment is for. The row lives in another service's
    -- database, and this key crosses that boundary knowingly: neither service
    -- can migrate the table alone, and the catalog says so on Problems.
    order_id      text NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
    -- Where it goes. Handed over with the dispatch: the order service holds
    -- no address, and asking it for one would be asking the wrong service.
    ship_to       text NOT NULL,
    status        text NOT NULL,
    tracking      text,
    route_id      text,
    dispatched_at timestamptz
);

CREATE INDEX packages_by_order ON packages (order_id);
CREATE UNIQUE INDEX packages_by_tracking ON packages (tracking) WHERE tracking IS NOT NULL;

CREATE TABLE parcels (
    id         text    NOT NULL PRIMARY KEY,
    package_id text    NOT NULL REFERENCES packages (id) ON DELETE CASCADE,
    weight_g   integer NOT NULL,
    contents   text    NOT NULL
);

-- Append-only: a wrong scan is followed by a right one, and the pair is the
-- history.
CREATE TABLE scans (
    id         bigserial   NOT NULL PRIMARY KEY,
    parcel_id  text        NOT NULL REFERENCES parcels (id) ON DELETE CASCADE,
    location   text        NOT NULL,
    scanned_at timestamptz NOT NULL
);

CREATE INDEX scans_by_parcel ON scans (parcel_id, scanned_at);
