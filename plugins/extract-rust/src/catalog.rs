//! The fragment's types: the part of `src/catalog.ts` an extractor writes.
//! Field order is the order the TypeScript twin writes them in, so that a
//! fragment from either reads the same.

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub generated_at: String,
    pub commit: String,
    pub contexts: Vec<Context>,
    pub defs: serde_json::Map<String, serde_json::Value>,
    pub flows: Vec<Flow>,
    pub adrs: Vec<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct Context {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub classification: Option<String>,
    pub services: Vec<Service>,
}

#[derive(Debug, Serialize)]
pub struct Service {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub repo: String,
    pub path: String,
    pub readme: String,
    pub provides: Vec<serde_json::Value>,
    pub consumes: Vec<RpcCall>,
    pub aggregates: Vec<Aggregate>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RpcCall {
    pub id: String,
    pub peer: String,
    pub status: String,
    pub source: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Aggregate {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub readme: String,
    pub root: String,
    pub entities: Vec<Block>,
    pub value_objects: Vec<Block>,
    pub operations: Vec<Operation>,
    pub events: Vec<Event>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lifecycle: Option<Lifecycle>,
}

#[derive(Debug, Serialize)]
pub struct Block {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub doc: String,
    pub fields: Vec<Field>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Field {
    pub name: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub doc: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    pub id: String,
    pub kind: String,
    pub doc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exposed_by: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct Event {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub versions: Vec<EventVersion>,
    pub consumers: Vec<serde_json::Value>,
    pub wire: Wire,
}

#[derive(Debug, Serialize)]
pub struct Wire {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct EventVersion {
    pub version: String,
    pub doc: String,
    pub source: String,
    pub fields: Vec<Field>,
}

#[derive(Debug, Serialize)]
pub struct Lifecycle {
    pub states: Vec<String>,
    pub transitions: Vec<Transition>,
}

#[derive(Debug, Serialize)]
pub struct Transition {
    pub from: String,
    pub to: String,
    pub on: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emits: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Flow {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub summary: String,
    pub source: String,
    pub owner: String,
    pub participants: Vec<Participant>,
    pub steps: Vec<FlowNode>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Participant {
    pub id: String,
    pub kind: String,
    pub context: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
pub enum FlowNode {
    #[serde(rename = "step")]
    Step(Step),
    #[serde(rename = "alt")]
    Alt(Alt),
}

#[derive(Debug, Serialize)]
pub struct Step {
    pub id: String,
    pub from: String,
    pub to: String,
    pub kind: String,
    pub label: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none", rename = "ref")]
    pub reference: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Alt {
    pub id: String,
    pub branches: Vec<AltBranch>,
}

#[derive(Debug, Serialize)]
pub struct AltBranch {
    pub title: String,
    pub steps: Vec<FlowNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal: Option<bool>,
}
