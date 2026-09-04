//! portolan-extract-rust: a Rust service in, a catalog fragment out. The Rust
//! twin of extract-go and extract-ts, on the same protocol: one JSON request on
//! stdin, one JSON response on stdout, and a `describe` that answers with what
//! the plugin is and what it can be told.

pub mod catalog;
pub mod clients;
pub mod domain;
pub mod extract;
pub mod flows;
pub mod ids;
pub mod lifecycle;
pub mod operations;
pub mod protocol;
pub mod source;
pub mod transport;
pub mod wiring;

use protocol::{Descriptor, Options, Request, Response};

const OPTIONS_SCHEMA: &str = include_str!("../options.schema.json");

pub fn descriptor() -> Descriptor {
    Descriptor {
        name: "extract-rust".into(),
        summary: "Reads a Rust service by its layout - aggregates, events, use cases, gRPC endpoints, policies, clients - into a catalog fragment.".into(),
        phases: vec!["extract".into()],
        options: serde_json::from_str(OPTIONS_SCHEMA).expect("options.schema.json is JSON"),
    }
}

/// One request in, one response out, as JSON either way.
pub fn serve(raw: &str, cwd: &std::path::Path) -> Result<String, String> {
    let req: Request = serde_json::from_str(raw).map_err(|e| format!("the request is not a portolan plugin request: {e}"))?;
    if req.kind == "describe" {
        let resp = Response {
            files: vec![],
            diagnostics: vec![],
            describe: Some(descriptor()),
        };
        return serde_json::to_string(&resp).map_err(|e| e.to_string());
    }
    if req.input.root.is_empty() {
        return Err("no input root: an extractor has nothing to read".into());
    }
    let opts: Options = if req.options.is_null() {
        Options::default()
    } else {
        serde_json::from_value(req.options).map_err(|e| format!("options: {e}"))?
    };
    let resp = extract::extract(&req.input, &opts, cwd);
    serde_json::to_string(&resp).map_err(|e| e.to_string())
}
