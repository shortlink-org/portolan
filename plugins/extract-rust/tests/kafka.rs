use std::path::Path;

#[test]
fn reads_rdkafka_topics_as_service_channels() {
    let cwd = Path::new(env!("CARGO_MANIFEST_DIR"));
    let request = r#"{"input":{"root":"testdata/kafka"},"options":{"context":"gavel","service":"processes"}}"#;
    let raw = portolan_extract_rust::serve(request, cwd).expect("the fixture extracts");
    let response: serde_json::Value = serde_json::from_str(&raw).expect("the response is JSON");
    let fragment: serde_json::Value = serde_json::from_str(response["files"][0]["contents"].as_str().unwrap()).unwrap();
    let channels = fragment["contexts"][0]["services"][0]["channels"].as_array().expect("channels are emitted");

    assert_eq!(channels.len(), 3);
    assert_eq!(channels[0]["address"], "gavel.auction.processes.v1");
    assert_eq!(channels[0]["messages"], serde_json::json!([]));
    assert!(channels[0]["doc"].as_str().unwrap().contains("receives"));
    assert_eq!(channels[1]["address"], "gavel.auction.public.v1");
    assert!(channels[1]["doc"].as_str().unwrap().contains("receives"));
    assert_eq!(channels[2]["address"], "gavel.processes.quarantine.v1");
    assert!(channels[2]["doc"].as_str().unwrap().contains("sends"));
    assert!(channels.iter().all(|channel| channel["protocol"] == "kafka"));

    let flows = fragment["flows"].as_array().unwrap();
    assert_eq!(flows.len(), 3);
    assert_eq!(flows[0]["steps"][0]["handoff"]["channel"], "gavel.auction.processes.v1");
    assert_eq!(flows[0]["steps"][0]["handoff"]["direction"], "receive");
    assert_eq!(flows[0]["participants"][0]["id"], "kafka");
    assert_eq!(flows[2]["steps"][0]["handoff"]["channel"], "gavel.processes.quarantine.v1");
    assert_eq!(flows[2]["steps"][0]["handoff"]["direction"], "send");
}
