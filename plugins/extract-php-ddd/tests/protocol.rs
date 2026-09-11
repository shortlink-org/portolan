use std::path::Path;

#[test]
fn describes_itself() {
    let raw = portolan_extract_php_ddd::serve(r#"{"kind":"describe"}"#, Path::new(".")).unwrap();
    let response: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(response["describe"]["name"], "extract-php-ddd");
    assert_eq!(response["describe"]["phases"][0], "extract");
    assert_eq!(response["describe"]["options"]["additionalProperties"], false);
    assert!(response["files"].as_array().unwrap().is_empty());
}

#[test]
fn every_option_is_described_and_matches_the_struct() {
    let schema: serde_json::Value = serde_json::from_str(include_str!("../options.schema.json")).unwrap();
    let properties = schema["properties"].as_object().unwrap();
    for (name, property) in properties {
        assert!(property["description"].as_str().is_some_and(|d| !d.is_empty()), "option {name} has no description");
    }
    // The struct refuses what the schema does not list, and the schema lists
    // nothing the struct does not take: both sides read the same names.
    let mut all = serde_json::Map::new();
    for name in properties.keys() {
        all.insert(name.clone(), serde_json::Value::String("x".into()));
    }
    all.insert("classification".into(), serde_json::Value::String("core".into()));
    all.insert("storeKind".into(), serde_json::Value::String("mysql".into()));
    let raw = serde_json::json!({ "input": { "root": "testdata/mooc" }, "options": all }).to_string();
    portolan_extract_php_ddd::serve(&raw, Path::new(env!("CARGO_MANIFEST_DIR"))).expect("every declared option is accepted");
    let raw = serde_json::json!({ "input": { "root": "testdata/mooc" }, "options": { "nope": 1 } }).to_string();
    let err = portolan_extract_php_ddd::serve(&raw, Path::new(env!("CARGO_MANIFEST_DIR"))).unwrap_err();
    assert!(err.contains("nope"), "{err}");
}

#[test]
fn refuses_to_extract_nothing() {
    let err = portolan_extract_php_ddd::serve(r#"{"input":{"root":""}}"#, Path::new(".")).unwrap_err();
    assert!(err.contains("no input root"));
}
