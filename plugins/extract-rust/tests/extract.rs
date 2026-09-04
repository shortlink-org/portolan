//! The reader is held to a fixture: a small service in the layout it reads,
//! each shape it claims to read present once, and a golden fragment.

use std::path::Path;

#[test]
fn reads_the_fixture_into_the_golden_fragment() {
    let cwd = Path::new(env!("CARGO_MANIFEST_DIR"));
    let request = r#"{"input":{"root":"testdata/oms","commit":"abc1234","generatedAt":"2026-09-05T00:00:00Z"},"options":{"context":"shop","contextName":"Shop","service":"oms","store":"pg","peers":{"payments.v1":"payments.ledger"},"events":{"crate::infrastructure::cart":"shop.cart.basket"}}}"#;
    let raw = portolan_extract_rust::serve(request, cwd).expect("the fixture extracts");
    let response: serde_json::Value = serde_json::from_str(&raw).unwrap();

    let files = response["files"].as_array().unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0]["name"], "domain.json");
    let got: serde_json::Value = serde_json::from_str(files[0]["contents"].as_str().unwrap()).unwrap();
    let want: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(cwd.join("testdata/oms/expected.json")).unwrap()).unwrap();
    assert_eq!(got, want, "the fragment differs from testdata/oms/expected.json");

    // The one thing the fixture does wrong on purpose: a policy that reacts
    // to a message by a name no event of its own is called.
    let diagnostics = response["diagnostics"].as_array().unwrap();
    assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
    assert_eq!(diagnostics[0]["ref"], "ConfirmOrderOnPaymentAuthorized");
    assert!(diagnostics[0]["message"].as_str().unwrap().contains("payments.PaymentAuthorized"));
}

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
