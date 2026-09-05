//! The plugin protocol, as `plugin/protocol.go` spells it: one request on
//! stdin, one response on stdout, and a `describe` that answers with what the
//! plugin is and what it can be told.

use serde::{Deserialize, Serialize};

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    #[serde(default)]
    pub portolan_version: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub input: Input,
    #[serde(default)]
    pub options: serde_json::Value,
}

#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Input {
    #[serde(default)]
    pub root: String,
    #[serde(default)]
    pub commit: String,
    #[serde(default)]
    pub generated_at: String,
}

#[derive(Debug, Default, Serialize)]
pub struct Response {
    pub files: Vec<File>,
    #[serde(skip_serializing)]
    pub warnings: Vec<Warning>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub describe: Option<Descriptor>,
}

#[derive(Debug, Serialize)]
pub struct File {
    pub name: String,
    pub contents: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Warning {
    pub severity: String,
    pub message: String,
    #[serde(rename = "ref")]
    pub reference: String,
}

#[derive(Debug, Serialize)]
pub struct Descriptor {
    pub name: String,
    pub summary: String,
    pub phases: Vec<String>,
    pub options: serde_json::Value,
}

/// What the manifest tells the extractor: the things a crate does not say
/// about the estate it belongs to. The same options as extract-ts.
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Options {
    #[serde(default)]
    pub context: String,
    #[serde(default)]
    pub context_name: String,
    #[serde(default)]
    pub context_summary: Option<String>,
    #[serde(default)]
    pub classification: Option<String>,
    #[serde(default)]
    pub service: String,
    #[serde(default)]
    pub service_name: String,
    #[serde(default)]
    pub repo: String,
    #[serde(default)]
    pub store: String,
    #[serde(default)]
    pub peers: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    pub events: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub out: String,
}

/// Collects what the run produces: the fragment, and every diagnostic beside
/// it. Reported, never papered over inside the fragment.
#[derive(Debug, Default)]
pub struct Builder {
    pub files: Vec<File>,
    pub warnings: Vec<Warning>,
}

impl Builder {
    pub fn warn(&mut self, reference: &str, message: impl Into<String>) {
        self.warnings.push(Warning {
            severity: "warning".into(),
            message: message.into(),
            reference: reference.into(),
        });
    }
}
