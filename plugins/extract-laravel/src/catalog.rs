//! The fragment's types: the part of `src/catalog-model.ts` an extractor
//! writes. Field order is the order the TypeScript twin writes them in, so
//! that a fragment from either reads the same.

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
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
    pub provides: Vec<RpcService>,
    pub consumes: Vec<serde_json::Value>,
    pub aggregates: Vec<Aggregate>,
}

/// An interface the service answers on: here, the HTTP routes of one module,
/// read into a partial contract the same way extract-django infers one.
#[derive(Debug, Serialize)]
pub struct RpcService {
    pub id: String,
    pub methods: Vec<RpcMethod>,
    pub source: String,
}

#[derive(Debug, Serialize)]
pub struct RpcMethod {
    pub name: String,
    pub doc: String,
    pub http: HttpRoute,
}

#[derive(Debug, Serialize)]
pub struct HttpRoute {
    pub method: String,
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Aggregate {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub readme: String,
    /// `model-group`: a source grouping with no confirmed aggregate boundary,
    /// which is what a Laravel module's models are until somebody says otherwise.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    pub root: String,
    pub entities: Vec<Block>,
    pub value_objects: Vec<Block>,
    pub operations: Vec<Operation>,
    pub events: Vec<Event>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub enums: Vec<Enum>,
}

/// A closed set of values a field can hold. See models.rs for what counts.
#[derive(Debug, Serialize)]
pub struct Enum {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub doc: String,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub deprecated: bool,
    pub values: Vec<EnumValue>,
}

#[derive(Debug, Serialize)]
pub struct EnumValue {
    pub name: String,
    pub doc: String,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub deprecated: bool,
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
    pub consumers: Vec<EventConsumer>,
    pub wire: Wire,
}

#[derive(Debug, Serialize)]
pub struct EventConsumer {
    pub service: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
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
