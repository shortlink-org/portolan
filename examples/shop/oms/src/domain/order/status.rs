/// Where an order is in its life. Closed on purpose: a reader switches on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Placed,
    Confirmed,
    Cancelled,
}

impl Status {
    pub fn as_str(&self) -> &'static str {
        match self {
            Status::Placed => "placed",
            Status::Confirmed => "confirmed",
            Status::Cancelled => "cancelled",
        }
    }

    pub fn parse(s: &str) -> Option<Status> {
        match s {
            "placed" => Some(Status::Placed),
            "confirmed" => Some(Status::Confirmed),
            "cancelled" => Some(Status::Cancelled),
            _ => None,
        }
    }
}

/// Where an order can go from where it is: two ways out of placed, one out of
/// confirmed, none out of cancelled. The table is the claim; `Order::move_to`
/// is held to it, and so is the catalog.
pub const TRANSITIONS: &[(&str, &[&str])] = &[("placed", &["confirmed", "cancelled"]), ("confirmed", &["cancelled"]), ("cancelled", &[])];

pub fn can_move(from: Status, to: Status) -> bool {
    TRANSITIONS
        .iter()
        .find(|(s, _)| *s == from.as_str())
        .is_some_and(|(_, targets)| targets.contains(&to.as_str()))
}
