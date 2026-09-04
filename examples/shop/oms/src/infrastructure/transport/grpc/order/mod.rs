//! The service's own contract, `shop.v1.OrderService`, generated from the
//! registry at the commit pinned in buf.gen.yaml; and the handlers that
//! answer it, each running one use case.

#[path = "gen/mod.rs"]
pub mod generated;
pub mod handlers;

pub use handlers::OrderHandlers;
