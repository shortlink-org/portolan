use std::path::Path;

#[test]
fn reads_a_flat_domain_module_without_an_aggregate_directory() {
    let cwd = Path::new(env!("CARGO_MANIFEST_DIR"));
    let request = r#"{
        "input": {"root": "testdata/flat-domain"},
        "options": {"context": "market", "service": "auction"}
    }"#;
    let raw = portolan_extract_rust::serve(request, cwd).expect("the fixture extracts");
    let response: serde_json::Value = serde_json::from_str(&raw).expect("the response is JSON");
    let fragment: serde_json::Value = serde_json::from_str(response["files"][0]["contents"].as_str().unwrap()).unwrap();
    let aggregates = &fragment["contexts"][0]["services"][0]["aggregates"];

    assert_eq!(aggregates.as_array().unwrap().len(), 1);
    assert_eq!(aggregates[0]["id"], "market.auction.auction");
    assert_eq!(aggregates[0]["root"], "Auction");
    assert_eq!(aggregates[0]["readme"], "An auction whose state changes by applying accepted bids.");
}
