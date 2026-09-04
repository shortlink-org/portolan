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
}

/// Where an order can go from where it is: two ways out of placed, none back.
pub const TRANSITIONS: &[(&str, &[&str])] = &[("placed", &["confirmed", "cancelled"]), ("confirmed", &[]), ("cancelled", &[])];
