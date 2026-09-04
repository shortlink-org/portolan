-- A van's day, and the stops in the order they are driven.
CREATE TABLE routes (
    id          text        NOT NULL PRIMARY KEY,
    vehicle     text        NOT NULL,
    planned_for date        NOT NULL,
    status      text        NOT NULL
);

CREATE INDEX routes_by_day ON routes (planned_for, status);

CREATE TABLE route_stops (
    route_id    text        NOT NULL REFERENCES routes (id) ON DELETE CASCADE,
    seq         integer     NOT NULL,
    shipment_id text        NOT NULL REFERENCES packages (id) ON DELETE RESTRICT,
    -- from: delivery.core.pg.packages.ship_to
    address     text        NOT NULL,
    window_from timestamptz NOT NULL,
    window_to   timestamptz NOT NULL,
    done        boolean     NOT NULL DEFAULT false,
    PRIMARY KEY (route_id, seq)
);
