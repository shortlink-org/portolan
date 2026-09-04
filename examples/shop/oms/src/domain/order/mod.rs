//! The order aggregate: what a basket became at checkout, and the one thing in
//! this service that changes. See README.md beside this file.

pub mod event;
mod line;
// The root's file is named for the aggregate, as every service here does it: the layout is what the catalog reads.
#[allow(clippy::module_inception)]
mod order;
pub mod port;
pub mod status;
pub mod vo;

pub use line::Line;
pub use order::Order;
pub use status::{Status, TRANSITIONS};

/// What the aggregate refuses, and what a store may fail with. The domain's
/// own sentinels come first; a storage failure is wrapped, never inspected.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("an order needs at least one line")]
    Empty,
    #[error("a {from} order cannot become {to}")]
    Move { from: &'static str, to: &'static str },
    #[error("the order's lines are not all in one currency")]
    Currency,
    #[error("no order {0}")]
    NotFound(String),
    #[error("the order was changed by somebody else; read it again")]
    Conflict,
    #[error("store: {0}")]
    Store(String),
}
