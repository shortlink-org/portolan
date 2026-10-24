use std::path::Path;

// RPC dependencies are a fact of the generated client call. They do not
// depend on the service adopting Portolan's example DDD directory layout or
// on the proto being copied beside the adapter.
#[test]
fn reads_rpc_dependency_without_a_domain_layout() {
    let cwd = Path::new(env!("CARGO_MANIFEST_DIR"));
    let request = r#"{
        "input": {"root": "testdata/rpc"},
        "options": {
            "context": "shop",
            "service": "checkout",
            "peers": {"authz.v1": "platform.authz"}
        }
    }"#;
    let raw = portolan_extract_rust::serve(request, cwd).expect("the fixture extracts");
    let response: serde_json::Value = serde_json::from_str(&raw).expect("the response is JSON");
    let fragment: serde_json::Value = serde_json::from_str(response["files"][0]["contents"].as_str().unwrap()).unwrap();

    assert_eq!(
        fragment["contexts"][0]["services"][0]["consumes"],
        serde_json::json!([{
            "id": "authz.v1.AuthzService/CheckPermission",
            "peer": "platform.authz",
            "status": "declared",
            "source": "testdata/rpc/contracts/authz.proto"
        }])
    );
}
