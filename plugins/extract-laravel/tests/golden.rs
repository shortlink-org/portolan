//! The whole emitted contract. Focused fixture tests explain the important
//! behaviour; this comparison catches fields nobody remembered to assert.

mod common;

#[test]
fn reads_the_fixture_into_the_golden_fragment() {
    let got = common::fragment();
    if std::env::var_os("UPDATE_GOLDEN").is_some() {
        let path = format!("{}/testdata/shop/expected.json", env!("CARGO_MANIFEST_DIR"));
        std::fs::write(path, format!("{}\n", serde_json::to_string_pretty(&got).unwrap())).unwrap();
        return;
    }
    let want: serde_json::Value = serde_json::from_str(include_str!("../testdata/shop/expected.json")).expect("the golden is JSON");
    assert_eq!(got, want, "the fragment differs from testdata/shop/expected.json");

    assert!(common::response().get("warnings").is_none(), "warnings are not part of the plugin protocol");
}

#[test]
fn reads_the_migrations_into_the_golden_store_fragment() {
    let got = common::stores();
    if std::env::var_os("UPDATE_GOLDEN").is_some() {
        let path = format!("{}/testdata/shop/expected-stores.json", env!("CARGO_MANIFEST_DIR"));
        std::fs::write(path, format!("{}\n", serde_json::to_string_pretty(&got).unwrap())).unwrap();
        return;
    }
    let want: serde_json::Value = serde_json::from_str(include_str!("../testdata/shop/expected-stores.json")).expect("the golden is JSON");
    assert_eq!(got, want, "the store fragment differs from testdata/shop/expected-stores.json");
}

#[test]
fn writes_the_inferred_openapi_document_it_promised() {
    let got = common::openapi();
    if std::env::var_os("UPDATE_GOLDEN").is_some() {
        let path = format!("{}/testdata/shop/openapi.inferred.yaml", env!("CARGO_MANIFEST_DIR"));
        std::fs::write(path, &got).unwrap();
        return;
    }
    let want = include_str!("../testdata/shop/openapi.inferred.yaml");
    assert_eq!(got, want, "the document differs from testdata/shop/openapi.inferred.yaml");
}
