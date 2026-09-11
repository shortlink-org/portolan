use std::path::Path;

pub fn response() -> serde_json::Value {
    let cwd = Path::new(env!("CARGO_MANIFEST_DIR"));
    let request = r#"{"input":{"root":"testdata/mooc","output":"testdata/mooc/portolan"},"options":{"classification":"core"}}"#;
    let raw = portolan_extract_php_ddd::serve(request, cwd).expect("the fixture extracts");
    serde_json::from_str(&raw).expect("the response is JSON")
}

pub fn files() -> Vec<(String, String)> {
    let response = response();
    response["files"]
        .as_array()
        .expect("files is an array")
        .iter()
        .map(|f| (f["name"].as_str().unwrap().to_string(), f["contents"].as_str().unwrap().to_string()))
        .collect()
}

pub fn file(name: &str) -> String {
    files().into_iter().find(|(n, _)| n == name).map(|(_, c)| c).unwrap_or_else(|| panic!("no file {name}"))
}

pub fn fragment() -> serde_json::Value {
    let files = files();
    assert_eq!(
        files.iter().map(|(n, _)| n.as_str()).collect::<Vec<_>>(),
        ["domain.json", "openapi.backoffice-backend.yaml", "openapi.backoffice-frontend.yaml", "openapi.mooc-backend.yaml", "stores.json"],
        "the fixture yields the fragment, one inferred OpenAPI document per application with routes, and the store fragment"
    );
    serde_json::from_str(&file("domain.json")).expect("the fragment is JSON")
}

pub fn stores() -> serde_json::Value {
    serde_json::from_str(&file("stores.json")).expect("the store fragment is JSON")
}
