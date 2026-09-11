//! portolan-extract-php-ddd: a PHP tree laid out by bounded context, module
//! and hexagonal layer in, a catalog fragment out. The PHP twin of
//! extract-go and extract-rust: nothing is annotated for the catalog, the
//! layout is the claim. One JSON request on stdin, one JSON response on
//! stdout, and a `describe` that answers with what the plugin is and what it
//! can be told.

pub mod application;
pub mod bus;
pub mod catalog;
pub mod domain;
pub mod extract;
pub mod layout;
pub mod openapi;
pub mod protocol;
pub mod stores;
pub mod transport;
pub mod yaml;

pub use phpscan::{ids, source};

use protocol::{Descriptor, Options, Request, Response};

const OPTIONS_SCHEMA: &str = include_str!("../options.schema.json");

pub fn descriptor() -> Descriptor {
    Descriptor {
        name: "extract-php-ddd".into(),
        summary: "Reads a PHP tree laid out by bounded context, module and hexagonal layer - aggregates, value objects, domain events, commands, queries, subscribers, routes, Doctrine mappings - into a catalog fragment and an inferred HTTP contract.".into(),
        category: "code".into(),
        phases: vec!["extract".into()],
        options: serde_json::from_str(OPTIONS_SCHEMA).expect("options.schema.json is JSON"),
    }
}

/// One request in, one response out, as JSON either way.
pub fn serve(raw: &str, cwd: &std::path::Path) -> Result<String, String> {
    let req: Request = serde_json::from_str(raw).map_err(|e| format!("the request is not a portolan plugin request: {e}"))?;
    if !req.portolan_version.is_empty() && req.portolan_version != "0.1.0" {
        return Err(format!("unsupported portolan protocol {:?} (plugin supports 0.1.0)", req.portolan_version));
    }
    if req.kind == "describe" {
        let resp = Response {
            files: vec![],
            warnings: vec![],
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
    for warning in &resp.warnings {
        if warning.reference.is_empty() {
            eprintln!("warning: {}", warning.message);
        } else {
            eprintln!("warning: {}: {}", warning.reference, warning.message);
        }
    }
    serde_json::to_string(&resp).map_err(|e| e.to_string())
}
