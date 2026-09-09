//! The whole emitted contract. Focused fixture tests explain the important
//! behaviour; this comparison catches fields nobody remembered to assert.

mod common;

#[test]
fn reads_the_fixture_into_the_golden_fragment() {
    let got = common::fragment();
    let want: serde_json::Value = serde_json::from_str(include_str!("../testdata/oms/expected.json")).expect("the golden is JSON");
    assert_eq!(got, want, "the fragment differs from testdata/oms/expected.json");

    assert!(common::response().get("warnings").is_none(), "warnings are not part of the plugin protocol");
}
