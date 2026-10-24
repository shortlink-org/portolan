use rdkafka::{
    consumer::{Consumer, StreamConsumer},
    producer::FutureRecord,
};

const AUCTION_PUBLIC_TOPIC: &str = "gavel.auction.public.v1";
const AUCTION_RESTRICTED_TOPIC: &str = "gavel.auction.processes.v1";
const QUARANTINE_TOPIC: &str = "gavel.processes.quarantine.v1";

fn subscribe(consumer: &StreamConsumer) {
    consumer
        .subscribe(&[AUCTION_PUBLIC_TOPIC, AUCTION_RESTRICTED_TOPIC])
        .unwrap();
}

fn quarantine() {
    let _record = FutureRecord::to(QUARANTINE_TOPIC);
}
