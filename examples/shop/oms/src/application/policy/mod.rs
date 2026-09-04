//! Policies: "when X has happened, do Y". Each reacts to one event off the bus
//! and runs one use case; the subscriptions that feed them are made in main.

pub mod confirm_order_on_payment_authorized;
pub mod place_order_on_basket_checked_out;
