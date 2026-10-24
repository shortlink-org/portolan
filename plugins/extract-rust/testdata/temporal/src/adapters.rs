struct OwnerRpcActivities {
    payments: PaymentsServiceClient<Channel>,
    auction: AuctionServiceClient<Channel>,
    notify: NotifyServiceClient<Channel>,
}

impl OwnerRpcActivities {
    async fn attempt_payment(&mut self) {
        self.payments.attempt_payment(()).await;
    }

    async fn get_settlement_attempt(&mut self) {
        self.payments.get_settlement_attempt(()).await;
    }

    async fn confirm_winner(&mut self) {
        self.auction.confirm_winner(()).await;
    }

    async fn forfeit_settlement_candidate(&mut self) {
        self.auction.forfeit_settlement_candidate(()).await;
    }

    async fn notify(&mut self) {
        self.notify.send_notification(()).await;
    }
}
