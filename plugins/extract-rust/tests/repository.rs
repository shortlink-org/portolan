//! The fixture read as if it were a copy fetched into the workspace: the host
//! names where the copy begins, and every path in the fragment is the one the
//! copy's own repository has - the same fragment, with the directory holding
//! the copy taken off.

use std::path::Path;

use serde_json::Value;

const ROOT: &str = "testdata/oms";

fn files(repository: &str) -> Vec<(String, String)> {
    let cwd = Path::new(env!("CARGO_MANIFEST_DIR"));
    let request = format!(
        r#"{{"input":{{"root":"{ROOT}","repository":"{repository}"}},"options":{{"context":"shop","contextName":"Shop","service":"oms","store":"pg","peers":{{"payments.v1":"payments.ledger"}},"events":{{"crate::infrastructure::cart":"shop.cart.basket"}}}}}}"#
    );
    let raw = portolan_extract_rust::serve(&request, cwd).expect("the fixture extracts");
    let response: Value = serde_json::from_str(&raw).expect("the response is JSON");
    response["files"]
        .as_array()
        .expect("files is an array")
        .iter()
        .map(|f| (f["name"].as_str().unwrap().to_string(), f["contents"].as_str().unwrap().to_string()))
        .collect()
}

fn respell(value: Value) -> Value {
    match value {
        Value::String(s) if s == ROOT => Value::String(String::new()),
        Value::String(s) => Value::String(s.strip_prefix(&format!("{ROOT}/")).map(str::to_string).unwrap_or(s)),
        Value::Array(items) => Value::Array(items.into_iter().map(respell).collect()),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(k, v)| (k, respell(v)))
                .filter(|(k, v)| !(k == "source" && v == ""))
                .collect(),
        ),
        other => other,
    }
}

#[test]
fn a_fetched_copy_is_spelled_from_its_own_repository() {
    let workspace = files("");
    let fetched = files(ROOT);
    assert_eq!(workspace.len(), fetched.len());
    for ((name, plain), (_, copy)) in workspace.iter().zip(fetched.iter()) {
        assert!(!copy.contains(&format!("{ROOT}/")), "{name} still names the directory holding the copy");
        let want = respell(serde_json::from_str(plain).expect("the fragment is JSON"));
        // A store read from the whole of the copy names no source, however empty is spelled.
        let got = respell(serde_json::from_str(copy).expect("the fragment is JSON"));
        assert_eq!(got, want, "{name}");
    }
}
