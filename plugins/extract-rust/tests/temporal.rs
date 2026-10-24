use std::path::Path;

#[test]
fn reads_registered_temporal_workflows_as_flows() {
    let cwd = Path::new(env!("CARGO_MANIFEST_DIR"));
    let request = r#"{"input":{"root":"testdata/temporal"},"options":{"context":"gavel","service":"processes","peers":{"payments.v1":"gavel.payments","auction.v1":"gavel.auction","notify.v1":"gavel.notify"}}}"#;
    let raw = portolan_extract_rust::serve(request, cwd).expect("the fixture extracts");
    let response: serde_json::Value = serde_json::from_str(&raw).expect("the response is JSON");
    let fragment: serde_json::Value = serde_json::from_str(response["files"][0]["contents"].as_str().unwrap()).unwrap();
    let flows = fragment["flows"].as_array().expect("flows are emitted");

    assert_eq!(flows.len(), 2);
    assert_eq!(flows[0]["id"], "gavel.processes.temporal-auction-lifecycle");
    assert_eq!(flows[0]["name"], "Auction Lifecycle");
    assert_eq!(flows[0]["trigger"]["label"], "Temporal · Auction Lifecycle");
    assert_eq!(flows[0]["participants"][0]["id"], "temporal");
    assert_eq!(flows[0]["participants"][1]["id"], "gavel.processes");

    let lifecycle_labels: Vec<&str> = flows[0]["steps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|step| step["label"].as_str().unwrap())
        .collect();
    assert_eq!(
        lifecycle_labels,
        [
            "run Auction Lifecycle",
            "schedule durable timer",
            "schedule activity Close Auction",
            "signal Owner Event",
        ]
    );
    assert!(flows[0]["source"].as_str().unwrap().ends_with("src/main.rs:9"));

    assert_eq!(flows[1]["id"], "gavel.processes.temporal-settle-auction");
    let settlement = flows[1]["steps"].as_array().unwrap();
    assert_eq!(settlement[0]["label"], "run Settle Auction");
    assert_eq!(settlement[1]["type"], "alt");
    let branches = settlement[1]["branches"].as_array().unwrap();
    assert_eq!(
        branches.iter().map(|branch| branch["title"].as_str().unwrap()).collect::<Vec<_>>(),
        [
            "Awaiting Candidate",
            "Attempt Payment",
            "Confirm Winner",
            "Forfeit Candidate",
            "Notify Candidate",
            "Recovery Required",
            "Terminal",
        ]
    );
    assert_eq!(branches[0]["steps"][0]["label"], "wait for workflow condition");
    assert_eq!(branches[1]["steps"][0]["label"], "schedule activity Attempt Payment");
    assert_eq!(branches[1]["steps"][1]["ref"], "payments.v1.PaymentsService/AttemptPayment");
    assert_eq!(branches[1]["steps"][1]["to"], "gavel.payments");
    assert_eq!(branches[2]["steps"][1]["ref"], "auction.v1.AuctionService/ConfirmWinner");
    assert_eq!(branches[3]["steps"][1]["ref"], "auction.v1.AuctionService/ForfeitSettlementCandidate");
    assert_eq!(branches[3]["steps"][1]["to"], "gavel.auction");
    assert_eq!(branches[4]["steps"][0]["label"], "schedule activity Notify");
    assert_eq!(branches[4]["steps"][1]["ref"], "notify.v1.NotifyService/SendNotification");
    assert_eq!(branches[4]["steps"][1]["to"], "gavel.notify");
    assert_eq!(branches[5]["steps"][0]["label"], "schedule activity Get Settlement Attempt");
    assert_eq!(branches[6]["terminal"], true);
    assert!(
        flows[1]["participants"]
            .as_array()
            .unwrap()
            .iter()
            .any(|participant| participant["id"] == "gavel.payments")
    );
    assert!(
        flows[1]["participants"]
            .as_array()
            .unwrap()
            .iter()
            .any(|participant| participant["id"] == "gavel.auction")
    );
    assert!(
        flows[1]["participants"]
            .as_array()
            .unwrap()
            .iter()
            .any(|participant| participant["id"] == "gavel.notify")
    );
    assert_eq!(settlement[2]["label"], "signal Owner Event");
}
