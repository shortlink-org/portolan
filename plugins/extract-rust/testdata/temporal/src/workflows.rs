#[workflow]
pub struct AuctionLifecycleWorkflow;

#[workflow_methods]
impl AuctionLifecycleWorkflow {
    #[run]
    pub async fn run(context: &mut WorkflowContext<Self>) -> WorkflowResult<()> {
        let _terminal = context.state(|value| match value.phase {
            LifecyclePhase::Terminal(_) => true,
            _ => false,
        });
        temporalio_sdk::workflows::select! {
            _ = context.timer(Duration::from_secs(1)) => {}
        }
        context.execute_activity(OwnerActivities::close_auction, (), options()).await?;
        Ok(())
    }

    #[signal]
    pub fn owner_event(&mut self, signal: LifecycleSignal) {}

    #[query]
    pub fn state(&self) -> LifecycleState {}
}

#[workflow]
pub struct SettleAuctionWorkflow;

#[workflow_methods]
impl SettleAuctionWorkflow {
    #[run]
    pub async fn run(context: &mut WorkflowContext<Self>) -> WorkflowResult<()> {
        let phase = context.state(|workflow| workflow.phase);
        match phase {
            SettlementPhase::AwaitingCandidate => {
                context.wait_condition(|workflow| workflow.ready).await?;
            }
            SettlementPhase::AttemptPayment => {
                context.execute_activity(SettlementActivities::attempt_payment, (), options()).await?;
            }
            SettlementPhase::ConfirmWinner => {
                context.execute_activity(SettlementActivities::confirm_winner, (), options()).await?;
            }
            SettlementPhase::ForfeitCandidate => {
                context.execute_activity(SettlementActivities::forfeit_candidate, (), options()).await?;
            }
            SettlementPhase::NotifyCandidate => {
                context.execute_activity(SettlementActivities::notify, (), options()).await?;
            }
            SettlementPhase::RecoveryRequired => {
                reconcile_attempt(context).await?;
            }
            SettlementPhase::Terminal => return Ok(()),
        }
        Ok(())
    }

    #[signal]
    pub fn owner_event(&mut self, signal: SettlementSignal) {}
}

async fn reconcile_attempt(context: &mut WorkflowContext<SettleAuctionWorkflow>) -> WorkflowResult<()> {
    context.execute_activity(SettlementActivities::get_settlement_attempt, (), options()).await?;
    Ok(())
}
