use std::path::Path;

#[test]
fn describes_itself() {
    let raw = portolan_extract_rust::serve(r#"{"kind":"describe"}"#, Path::new(".")).unwrap();
    let response: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(response["describe"]["name"], "extract-rust");
    assert_eq!(response["describe"]["phases"][0], "extract");
    assert_eq!(response["describe"]["options"]["additionalProperties"], false);
    assert!(response["files"].as_array().unwrap().is_empty());
}

#[test]
fn refuses_to_extract_nothing() {
    let err = portolan_extract_rust::serve(r#"{"input":{"root":""}}"#, Path::new(".")).unwrap_err();
    assert!(err.contains("no input root"));
}
