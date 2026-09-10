use std::path::Path;

pub fn response() -> serde_json::Value {
    let cwd = Path::new(env!("CARGO_MANIFEST_DIR"));
    let request = r#"{"input":{"root":"testdata/oms"},"options":{"context":"shop","contextName":"Shop","service":"oms","store":"pg","peers":{"payments.v1":"payments.ledger"},"events":{"crate::infrastructure::cart":"shop.cart.basket"}}}"#;
    let raw = portolan_extract_rust::serve(request, cwd).expect("the fixture extracts");
    serde_json::from_str(&raw).expect("the response is JSON")
}

pub fn fragment() -> serde_json::Value {
    let response = response();
    let files = response["files"].as_array().expect("files is an array");
    assert_eq!(files.len(), 1);
    assert_eq!(files[0]["name"], "domain.json");
    serde_json::from_str(files[0]["contents"].as_str().expect("contents is a string")).expect("the fragment is JSON")
}
