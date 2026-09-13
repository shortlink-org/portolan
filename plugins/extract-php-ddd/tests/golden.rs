//! The whole emitted contract. Focused fixture tests explain the important
//! behaviour; this comparison catches fields nobody remembered to assert.

mod common;

#[test]
fn reads_the_fixture_into_the_golden_fragment() {
    let got = common::fragment();
    if std::env::var_os("UPDATE_GOLDEN").is_some() {
        let path = format!("{}/testdata/mooc/expected.json", env!("CARGO_MANIFEST_DIR"));
        std::fs::write(path, format!("{}\n", serde_json::to_string_pretty(&got).unwrap())).unwrap();
        return;
    }
    let want: serde_json::Value = serde_json::from_str(include_str!("../testdata/mooc/expected.json")).expect("the golden is JSON");
    assert_eq!(got, want, "the fragment differs from testdata/mooc/expected.json");

    assert!(common::response().get("warnings").is_none(), "warnings are not part of the plugin protocol");
}

#[test]
fn every_flow_names_the_source_backed_trigger() {
    let fragment = common::fragment();
    let flows = fragment["flows"].as_array().expect("flows is an array");
    assert!(flows.iter().all(|flow| flow["trigger"]["confidence"] == "high"));
    assert_eq!(
        flows[0]["trigger"],
        serde_json::json!({"kind":"http","label":"GET /courses","confidence":"high"})
    );
    assert!(flows.iter().any(|flow| flow["trigger"]["kind"] == "event"));
}

#[test]
fn reads_the_mappings_into_the_golden_store_fragment() {
    let got = common::stores();
    let want: serde_json::Value = serde_json::from_str(include_str!("../testdata/mooc/expected-stores.json")).expect("the golden is JSON");
    assert_eq!(got, want, "the store fragment differs from testdata/mooc/expected-stores.json");
}

#[test]
fn writes_the_inferred_openapi_documents_it_promised() {
    for service in ["mooc-backend", "backoffice-backend", "backoffice-frontend"] {
        let name = format!("openapi.{service}.yaml");
        let got = common::file(&name);
        let want = std::fs::read_to_string(format!("{}/testdata/mooc/{name}", env!("CARGO_MANIFEST_DIR"))).expect("the golden exists");
        assert_eq!(got, want, "the document differs from testdata/mooc/{name}");
    }
}
