pub struct SettlementActivities {
    payments: PaymentsPort,
    auction: AuctionPort,
    notify: NotifyPort,
}

#[activities]
impl SettlementActivities {
    #[activity]
    pub async fn attempt_payment(&self) {
        self.payments.attempt_payment(()).await;
    }

    #[activity]
    pub async fn confirm_winner(&self) {
        self.auction.confirm_winner(()).await;
    }

    #[activity]
    pub async fn forfeit_candidate(&self) {
        self.auction.forfeit_settlement_candidate(()).await;
    }

    #[activity]
    pub async fn get_settlement_attempt(&self) {
        self.payments.get_settlement_attempt(()).await;
    }

    #[activity]
    pub async fn notify(&self) {
        self.notify.notify(()).await;
    }
}
