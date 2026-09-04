//! Order Management — service `oms` of bounded context `shop`. The layout is
//! the claim: domain/ depends on nothing, application/ on the domain,
//! infrastructure/ on both, and main.rs is the one place that knows every
//! module exists.

pub mod application;
pub mod domain;
pub mod infrastructure;
pub mod pkg;
pub mod telemetry;
