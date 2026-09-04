pub mod cancel_order;
pub mod confirm_order;
pub mod get_order;
pub mod place_order;

/// A clock is a port with nobody at the other end: assembly hands one in, a
/// test hands in a fixed one.
pub type Clock = Box<dyn Fn() -> chrono::DateTime<chrono::Utc> + Send + Sync>;

/// The clock the assembly hands in: now, in UTC.
pub fn wall_clock() -> Clock {
    Box::new(chrono::Utc::now)
}
