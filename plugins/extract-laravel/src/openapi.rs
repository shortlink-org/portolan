//! The HTTP contract the route files prove, as an OpenAPI 3.1 document. It
//! is partial on purpose and says so on every operation: the route files
//! prove the verb, the path, which controller method answers and what that
//! method validates its request against; the response shape is not in the
//! source this reads, so it stays absent rather than invented.
//!
//! The request is written in JSON Schema's words, which is the other half of
//! the one vocabulary (portolan.0015): `max_len` is `maxLength` here as it was
//! `max:64` in the rules array, so a document generated from a Laravel
//! application and one written by hand say the same thing the same way - and
//! reading this document back with `extract-openapi` gives the rules it
//! started as, but for a closed set, which OpenAPI keeps in the type where
//! the catalog has always kept it. A rule JSON Schema has no keyword for -
//! `confirmed`, `required_if`, `unique` - is kept beside the property under
//! `x-portolan-rules` rather than dropped.

use serde_json::{Map, Value, json};

use crate::catalog::Field;
use crate::requests::Request;
use crate::routes::params_of;

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
    /// What the action validates the request against, when it validates it.
    pub request: Option<Request>,
    /// `file:line` of the route declaration.
    pub source: String,
}

/// The verbs whose request is a body. What the others take, they take in the
/// query string, and that is where a rules array's fields belong for them.
fn has_body(verb: &str) -> bool {
    matches!(verb, "post" | "put" | "patch")
}

pub fn document(ops: &[Op], service_name: &str) -> Value {
    let mut paths: Map<String, Value> = Map::new();
    let mut schemas: Map<String, Value> = Map::new();
    let mut tags: Vec<String> = Vec::new();
    let mut sorted: Vec<&Op> = ops.iter().collect();
    sorted.sort_by(|a, b| a.path.cmp(&b.path).then(a.verb.cmp(&b.verb)).then(a.operation_id.cmp(&b.operation_id)));
    for op in sorted {
        let item = paths.entry(op.path.clone()).or_insert_with(|| Value::Object(Map::new()));
        let Value::Object(item) = item else { continue };
        if op.verb == "any" {
            // Laravel answers every verb here; OpenAPI has no operation for
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
        let in_path = params_of(&op.path);
        let mut params: Vec<Value> = in_path
            .iter()
            .map(|p| json!({ "name": p, "in": "path", "required": true, "schema": { "type": "string" } }))
            .collect();
        if let Some(request) = &op.request {
            if !schemas.contains_key(&request.name) {
                schemas.insert(request.name.clone(), object_schema(&request.fields));
            }
            if has_body(&op.verb) {
                operation.insert(
                    "requestBody".into(),
                    json!({
                        "required": true,
                        "content": { "application/json": { "schema": { "$ref": format!("#/components/schemas/{}", request.name) } } },
                    }),
                );
            } else {
                // The path already carries what the path names; the rest of
                // what a GET validates came in the query string.
                for field in request.fields.iter().filter(|f| !in_path.contains(&f.name)) {
                    let mut param = Map::new();
                    param.insert("name".into(), json!(field.name));
                    param.insert("in".into(), json!("query"));
                    if field.required {
                        param.insert("required".into(), json!(true));
                    }
                    param.insert("schema".into(), field_schema(field));
                    if let Some(rest) = unmapped(field) {
                        param.insert("x-portolan-rules".into(), rest);
                    }
                    params.push(Value::Object(param));
                }
            }
        }
        if !params.is_empty() {
            operation.insert("parameters".into(), Value::Array(params));
        }
        operation.insert(
            "responses".into(),
            json!({ "default": { "description": "Response schema and status are not available from static Laravel route analysis." } }),
        );
        operation.insert("x-portolan-inferred".into(), json!(true));
        operation.insert("x-portolan-source".into(), json!(op.source));
        if let Some(name) = &op.route_name {
            operation.insert("x-portolan-route".into(), json!(name));
        }
        item.insert(op.verb.clone(), Value::Object(operation));
    }
    tags.sort();
    let mut document = Map::new();
    document.insert("openapi".into(), json!("3.1.0"));
    document.insert(
        "info".into(),
        json!({
            "title": format!("{service_name} HTTP API"),
            "version": "inferred",
            "description": "Generated statically from Laravel route files and controller declarations. Unknown details are left unspecified.",
        }),
    );
    document.insert("tags".into(), json!(tags.iter().map(|t| json!({ "name": t })).collect::<Vec<_>>()));
    document.insert("paths".into(), Value::Object(paths));
    if !schemas.is_empty() {
        document.insert("components".into(), json!({ "schemas": Value::Object(schemas) }));
    }
    document.insert("x-portolan-inferred".into(), json!(true));
    document.insert("x-portolan-generator".into(), json!("extract-laravel"));
    Value::Object(document)
}

/// A request message as a JSON Schema object: what must be sent, and what
/// each value must satisfy.
fn object_schema(fields: &[Field]) -> Value {
    let mut properties: Map<String, Value> = Map::new();
    let mut required: Vec<Value> = Vec::new();
    for field in fields {
        let mut schema = field_schema(field);
        if let (Value::Object(map), Some(rest)) = (&mut schema, unmapped(field)) {
            map.insert("x-portolan-rules".into(), rest);
        }
        properties.insert(field.name.clone(), schema);
        if field.required {
            required.push(json!(field.name));
        }
    }
    let mut out = Map::new();
    out.insert("type".into(), json!("object"));
    if !required.is_empty() {
        out.insert("required".into(), Value::Array(required));
    }
    out.insert("properties".into(), Value::Object(properties));
    Value::Object(out)
}

/// One field's rules, in JSON Schema's words. A rule about what a list holds
/// goes where JSON Schema keeps it, under `items`.
fn field_schema(field: &Field) -> Value {
    let mut out = Map::new();
    let list = field.type_.strip_suffix("[]");
    let (type_, format) = json_type(list.map(|_| "array").unwrap_or(&field.type_));
    if !type_.is_empty() {
        out.insert("type".into(), json!(type_));
    }
    if !format.is_empty() {
        out.insert("format".into(), json!(format));
    }
    let mut items = Map::new();
    if let Some(holds) = list {
        let (type_, format) = json_type(holds);
        if !type_.is_empty() {
            items.insert("type".into(), json!(type_));
        }
        if !format.is_empty() {
            items.insert("format".into(), json!(format));
        }
    }
    for rule in &field.rules {
        match rule.name.strip_prefix("items.") {
            Some(name) => keyword(&mut items, name, rule.value.as_deref()),
            None => keyword(&mut out, &rule.name, rule.value.as_deref()),
        }
    }
    if !items.is_empty() {
        out.insert("items".into(), Value::Object(items));
    }
    Value::Object(out)
}

/// The keyword one rule is, when JSON Schema has one for it.
fn keyword(out: &mut Map<String, Value>, name: &str, value: Option<&str>) {
    // A bound is written as the source wrote it: `1` stays 1, and only a
    // bound with a fraction becomes one.
    let number = || {
        value.and_then(|v| match v.parse::<i64>() {
            Ok(n) => Some(json!(n)),
            Err(_) => v.parse::<f64>().ok().map(|n| json!(n)),
        })
    };
    let integer = || value.and_then(|v| v.parse::<u64>().ok()).map(|n| json!(n));
    let (key, value) = match name {
        "min_len" => ("minLength", integer()),
        "max_len" => ("maxLength", integer()),
        "len" => {
            if let Some(n) = integer() {
                out.insert("minLength".into(), n.clone());
                out.insert("maxLength".into(), n);
            }
            return;
        }
        "min_items" => ("minItems", integer()),
        "max_items" => ("maxItems", integer()),
        "gte" => ("minimum", number()),
        "lte" => ("maximum", number()),
        "gt" => ("exclusiveMinimum", number()),
        "lt" => ("exclusiveMaximum", number()),
        "multiple_of" => ("multipleOf", number()),
        "pattern" => ("pattern", value.map(|v| json!(v))),
        "format" => ("format", value.map(|v| json!(v))),
        "const" => ("const", number().or_else(|| value.map(|v| json!(v)))),
        "in" => ("enum", value.map(|v| Value::Array(v.split(", ").map(|one| json!(one)).collect()))),
        // Everything else is a rule about the world - a row that must exist,
        // a field that must match - and JSON Schema has no word for it.
        _ => return,
    };
    if let Some(value) = value {
        out.insert(key.into(), value);
    }
}

/// The rules no keyword carried, spelled as the fragment carries them, so the
/// document loses nothing by being JSON Schema.
fn unmapped(field: &Field) -> Option<Value> {
    let rest: Vec<Value> = field
        .rules
        .iter()
        .filter(|rule| {
            let name = rule.name.strip_prefix("items.").unwrap_or(&rule.name);
            !matches!(
                name,
                "min_len" | "max_len" | "len" | "min_items" | "max_items" | "gte" | "lte" | "gt" | "lt" | "multiple_of" | "pattern" | "format" | "const" | "in"
            )
        })
        .map(|rule| match &rule.value {
            Some(value) => json!(format!("{} = {value}", rule.name)),
            None => json!(rule.name),
        })
        .collect();
    if rest.is_empty() { None } else { Some(Value::Array(rest)) }
}

/// The catalog's type as JSON Schema spells it, with the format when the type
/// is one JSON Schema says with a string.
fn json_type(type_: &str) -> (&str, &str) {
    match type_ {
        "string" => ("string", ""),
        "integer" => ("integer", ""),
        "number" => ("number", ""),
        "boolean" => ("boolean", ""),
        "array" => ("array", ""),
        "date" => ("string", "date"),
        "file" => ("string", "binary"),
        // `mixed` is the rules array naming no type: Laravel decides at
        // runtime, and a document that says `string` here would be inventing.
        _ => ("", ""),
    }
}
