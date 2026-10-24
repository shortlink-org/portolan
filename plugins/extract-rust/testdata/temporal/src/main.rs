use crate::workflows::{AuctionLifecycleWorkflow, SettleAuctionWorkflow};

mod activities;
mod adapters;
mod workflows;

fn workers(config: Config) {
    WorkerOptions::new(config.lifecycle_task_queue.clone())
        .register_workflow::<AuctionLifecycleWorkflow>()
        .unwrap()
        .register_activities(OwnerActivities::new());
    WorkerOptions::new(config.settlement_task_queue.clone())
        .register_workflow::<SettleAuctionWorkflow>()
        .unwrap()
        .register_activities(SettlementActivities::new());
}
