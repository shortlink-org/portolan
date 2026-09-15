-- A shipment is created when the order is confirmed, and nothing in the estate
-- hands over an address then: the order service holds none. The address
-- arrives later, so the column waits for it (core.0003). A stop still never
-- gets a shipment without one; the domain refuses to plan it.
ALTER TABLE packages ALTER COLUMN ship_to DROP NOT NULL;
