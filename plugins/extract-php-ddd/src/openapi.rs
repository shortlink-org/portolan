//! The HTTP contract the route files prove, as an OpenAPI 3.1 document. It
//! is partial on purpose and says so on every operation: the route files
//! prove the verb, the path and which controller method answers; request
//! and response shapes are not in the source this reads, so they stay
//! absent rather than invented.

use serde_json::{Map, Value, json};

use crate::transport::params_of;

#[derive(Debug, Clone)]
pub struct Op {
    pub operation_id: String,
    /// Lower case; `any` for a route that answers every verb.
    pub verb: String,
    pub path: String,
    pub summary: String,
    pub description: String,
    pub tag: String,
    pub route_name: Option<String>,
    /// `file:line` of the route declaration.
    pub source: String,
}

pub fn document(ops: &[Op], service_name: &str) -> Value {
    let mut paths: Map<String, Value> = Map::new();
    let mut tags: Vec<String> = Vec::new();
    let mut sorted: Vec<&Op> = ops.iter().collect();
    sorted.sort_by(|a, b| a.path.cmp(&b.path).then(a.verb.cmp(&b.verb)).then(a.operation_id.cmp(&b.operation_id)));
    for op in sorted {
        let item = paths.entry(op.path.clone()).or_insert_with(|| Value::Object(Map::new()));
        let Value::Object(item) = item else { continue };
        if op.verb == "any" {
            // The route answers every verb here; OpenAPI has no operation for
            // that, and inventing one per verb would be read as a fact.
            item.entry("summary").or_insert(json!(op.summary));
            item.entry("x-portolan-inferred").or_insert(json!(true));
            item.entry("x-portolan-source").or_insert(json!(op.source));
            item.entry("x-portolan-verb").or_insert(json!("any"));
            continue;
        }
        if item.contains_key(&op.verb) {
            continue;
        }
        if !tags.contains(&op.tag) {
            tags.push(op.tag.clone());
        }
        let mut operation = Map::new();
        operation.insert("operationId".into(), json!(op.operation_id));
        operation.insert("summary".into(), json!(op.summary));
        if !op.description.is_empty() {
            operation.insert("description".into(), json!(op.description));
        }
        operation.insert("tags".into(), json!([op.tag]));
        let params: Vec<Value> = params_of(&op.path)
            .iter()
            .map(|p| json!({ "name": p, "in": "path", "required": true, "schema": { "type": "string" } }))
            .collect();
        if !params.is_empty() {
            operation.insert("parameters".into(), Value::Array(params));
        }
        operation.insert(
            "responses".into(),
            json!({ "default": { "description": "Response schema and status are not available from static route analysis." } }),
        );
        operation.insert("x-portolan-inferred".into(), json!(true));
        operation.insert("x-portolan-source".into(), json!(op.source));
        if let Some(name) = &op.route_name {
            operation.insert("x-portolan-route".into(), json!(name));
        }
        item.insert(op.verb.clone(), Value::Object(operation));
    }
    tags.sort();
    json!({
        "openapi": "3.1.0",
        "info": {
            "title": format!("{service_name} HTTP API"),
            "version": "inferred",
            "description": "Generated statically from Symfony route files and controller declarations. Unknown details are left unspecified.",
        },
        "tags": tags.iter().map(|t| json!({ "name": t })).collect::<Vec<_>>(),
        "paths": Value::Object(paths),
        "x-portolan-inferred": true,
        "x-portolan-generator": "extract-php-ddd",
    })
}
