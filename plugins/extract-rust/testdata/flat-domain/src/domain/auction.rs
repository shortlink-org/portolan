/// An auction whose state changes by applying accepted bids.
pub struct Auction {
    pub id: String,
    pub version: u64,
}

impl Auction {
    pub fn apply_bid(&mut self) {
        self.version += 1;
    }
}

pub struct Money {
    pub minor: u64,
}

impl Money {
    pub fn new(minor: u64) -> Self {
        Self { minor }
    }
}
