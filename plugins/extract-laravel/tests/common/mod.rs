use std::path::Path;

pub fn response() -> serde_json::Value {
    let cwd = Path::new(env!("CARGO_MANIFEST_DIR"));
    let request = r#"{"input":{"root":"testdata/shop","output":"testdata/shop/portolan"},"options":{"context":"shop","contextName":"Shop","service":"shop"}}"#;
    let raw = portolan_extract_laravel::serve(request, cwd).expect("the fixture extracts");
    serde_json::from_str(&raw).expect("the response is JSON")
}

pub fn fragment() -> serde_json::Value {
    let response = response();
    let files = response["files"].as_array().expect("files is an array");
    assert_eq!(
        files.len(),
        3,
        "the fixture yields the fragment, the inferred OpenAPI document and the store fragment"
    );
    assert_eq!(files[0]["name"], "domain.json");
    assert_eq!(files[1]["name"], "openapi.inferred.yaml");
    assert_eq!(files[2]["name"], "stores.json");
    serde_json::from_str(files[0]["contents"].as_str().expect("contents is a string")).expect("the fragment is JSON")
}

pub fn openapi() -> String {
    let response = response();
    response["files"][1]["contents"].as_str().expect("contents is a string").to_string()
}

pub fn stores() -> serde_json::Value {
    let response = response();
    serde_json::from_str(response["files"][2]["contents"].as_str().expect("contents is a string")).expect("the store fragment is JSON")
}
