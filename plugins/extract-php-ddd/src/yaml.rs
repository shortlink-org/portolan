//! Just enough YAML to write an OpenAPI document that a person reads and a
//! YAML parser reads the same: mappings, sequences and scalars, strings
//! quoted whenever YAML could take them for something else.

use serde_json::Value;

pub fn to_yaml(value: &Value) -> String {
    let mut out = String::new();
    match value {
        Value::Object(map) if !map.is_empty() => emit_map(map, 0, &mut out),
        Value::Array(items) if !items.is_empty() => emit_seq(items, 0, &mut out),
        other => {
            out.push_str(&scalar(other));
            out.push('\n');
        }
    }
    out
}

fn emit_map(map: &serde_json::Map<String, Value>, indent: usize, out: &mut String) {
    for (key, value) in map {
        out.push_str(&" ".repeat(indent));
        out.push_str(&quote_key(key));
        out.push(':');
        emit_value(value, indent, out);
    }
}

fn emit_seq(items: &[Value], indent: usize, out: &mut String) {
    for item in items {
        out.push_str(&" ".repeat(indent));
        out.push('-');
        match item {
            Value::Object(map) if !map.is_empty() => {
                let mut first = true;
                for (key, value) in map {
                    if first {
                        out.push(' ');
                        first = false;
                    } else {
                        out.push_str(&" ".repeat(indent + 2));
                    }
                    out.push_str(&quote_key(key));
                    out.push(':');
                    emit_value(value, indent + 2, out);
                }
            }
            Value::Array(inner) if !inner.is_empty() => {
                out.push('\n');
                emit_seq(inner, indent + 2, out);
            }
            other => {
                out.push(' ');
                out.push_str(&scalar(other));
                out.push('\n');
            }
        }
    }
}

fn emit_value(value: &Value, indent: usize, out: &mut String) {
    match value {
        Value::Object(map) if !map.is_empty() => {
            out.push('\n');
            emit_map(map, indent + 2, out);
        }
        Value::Array(items) if !items.is_empty() => {
            out.push('\n');
            emit_seq(items, indent + 2, out);
        }
        other => {
            out.push(' ');
            out.push_str(&scalar(other));
            out.push('\n');
        }
    }
}

fn scalar(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => quote_str(s),
        Value::Array(_) => "[]".into(),
        Value::Object(_) => "{}".into(),
    }
}

fn quote_key(key: &str) -> String {
    if key.is_empty()
        || key.starts_with(|c: char| !c.is_ascii_alphanumeric() && c != '_' && c != '$' && c != '/')
        || key
            .chars()
            .any(|c| !(c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.' || c == '/' || c == '{' || c == '}'))
    {
        quote_str(key)
    } else {
        key.to_string()
    }
}

/// Plain when nothing in YAML would read it otherwise; double-quoted else.
fn quote_str(s: &str) -> String {
    let plain_safe = !s.is_empty()
        && !s.chars().any(|c| {
            c == ':'
                || c == '#'
                || c == '\n'
                || c == '"'
                || c == '\''
                || c == '{'
                || c == '}'
                || c == '['
                || c == ']'
                || c == ','
                || c == '&'
                || c == '*'
                || c == '!'
                || c == '|'
                || c == '>'
                || c == '%'
                || c == '@'
                || c == '`'
        })
        && !s.starts_with(['-', '?', ' '])
        && !s.ends_with(' ')
        && !matches!(s.to_ascii_lowercase().as_str(), "true" | "false" | "null" | "yes" | "no" | "on" | "off" | "~")
        && s.parse::<f64>().is_err();
    if plain_safe {
        return s.to_string();
    }
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            '\r' => out.push_str("\\r"),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn writes_a_document_a_parser_reads_back() {
        let doc = json!({
            "openapi": "3.1.0",
            "info": { "title": "Shop HTTP API", "version": "inferred", "description": "Static: yes." },
            "tags": [{ "name": "checkout" }],
            "paths": {
                "/checkout/cart/{id}": {
                    "get": { "operationId": "cart_show", "tags": ["checkout"], "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }], "responses": { "default": { "description": "Not known." } } },
                    "x-portolan-inferred": true
                }
            },
            "empty": [],
            "none": {}
        });
        let text = to_yaml(&doc);
        assert_eq!(
            text,
            "openapi: 3.1.0\ninfo:\n  title: Shop HTTP API\n  version: inferred\n  description: \"Static: yes.\"\ntags:\n  - name: checkout\npaths:\n  /checkout/cart/{id}:\n    get:\n      operationId: cart_show\n      tags:\n        - checkout\n      parameters:\n        - name: id\n          in: path\n          required: true\n          schema:\n            type: string\n      responses:\n        default:\n          description: Not known.\n    x-portolan-inferred: true\nempty: []\nnone: {}\n"
        );
    }

    #[test]
    fn quotes_what_yaml_would_misread() {
        assert_eq!(quote_str("plain words"), "plain words");
        assert_eq!(quote_str("12"), "\"12\"");
        assert_eq!(quote_str("yes"), "\"yes\"");
        assert_eq!(quote_str("a: b"), "\"a: b\"");
        assert_eq!(quote_str("line\nbreak"), "\"line\\nbreak\"");
        assert_eq!(quote_str(""), "\"\"");
    }
}
