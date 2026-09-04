//! The order's store: Postgres, with the outbox beside it (ADR oms.0001).

mod postgres;

pub use postgres::PostgresOrders;

/// One subject per aggregate, dotted the way a NATS subject is: the topic in
/// the outbox row is the subject on the wire, and one name is enough.
pub const TOPIC: &str = "shop.oms.order";
