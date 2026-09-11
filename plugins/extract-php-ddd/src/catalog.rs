//! The fragment's types: the part of `src/catalog-model.ts` an extractor
//! writes. Field order is the order the TypeScript twin writes them in, so
//! that a fragment from either reads the same.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub contexts: Vec<Context>,
    pub defs: serde_json::Map<String, serde_json::Value>,
    pub flows: Vec<Flow>,
    pub adrs: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub stores: Vec<Store>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Context {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub classification: Option<String>,
    pub services: Vec<Service>,
}

#[derive(Debug, Clone, Serialize)]
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
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub channels: Vec<Channel>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub stores: Vec<String>,
}

/// A queue the service puts jobs on and works: the same shape extract-celery
/// writes for a Celery queue.
#[derive(Debug, Clone, Serialize)]
pub struct Channel {
    pub address: String,
    pub kind: String,
    pub title: String,
    pub doc: String,
    pub messages: Vec<ChannelMessage>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChannelMessage {
    pub name: String,
    pub title: String,
    pub doc: String,
    pub direction: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Store {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub kind: String,
    pub owner: String,
    pub tables: Vec<Table>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Table {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub doc: String,
    pub columns: Vec<Column>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub indexes: Vec<TableIndex>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub persists: Option<Persists>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub accesses: Vec<TableAccess>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Persists {
    pub aggregate: String,
    pub block: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TableAccess {
    pub operation: String,
    pub method: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TableIndex {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Column {
    pub name: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub nullable: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub pk: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fk: Option<ForeignKey>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maps: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKey {
    pub table: String,
    pub column: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_delete: Option<String>,
}

/// An interface the service answers on: here, the HTTP routes of one module,
/// read into a partial contract the same way extract-django infers one.
#[derive(Debug, Clone, Serialize)]
pub struct RpcService {
    pub id: String,
    pub methods: Vec<RpcMethod>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RpcMethod {
    pub name: String,
    pub doc: String,
    pub http: HttpRoute,
}

#[derive(Debug, Clone, Serialize)]
pub struct HttpRoute {
    pub method: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Aggregate {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub readme: String,
    /// `model-group`: a source grouping with no confirmed aggregate boundary,
    /// which is what a module without an aggregate root is.
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
#[derive(Debug, Clone, Serialize)]
pub struct Enum {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub doc: String,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub deprecated: bool,
    pub values: Vec<EnumValue>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EnumValue {
    pub name: String,
    pub doc: String,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub deprecated: bool,
}

#[derive(Debug, Clone, Serialize)]
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    pub id: String,
    pub kind: String,
    pub doc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exposed_by: Option<Vec<String>>,
    /// The message's shape: what the caller hands in.
    pub fields: Vec<Field>,
    /// The handler, `path:line`.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Event {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub versions: Vec<EventVersion>,
    pub consumers: Vec<EventConsumer>,
    pub wire: Wire,
}

#[derive(Debug, Clone, Serialize)]
pub struct EventConsumer {
    pub service: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Wire {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EventVersion {
    pub version: String,
    pub doc: String,
    pub source: String,
    pub fields: Vec<Field>,
}

#[derive(Debug, Clone, Serialize)]
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

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum FlowNode {
    #[serde(rename = "step")]
    Step(Step),
}

#[derive(Debug, Clone, Serialize)]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handoff: Option<Handoff>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "storeAccess")]
    pub store_access: Option<StoreAccess>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Handoff {
    pub kind: String,
    pub transport: String,
    pub channel: String,
    pub message: String,
    pub direction: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StoreAccess {
    pub store: String,
    pub method: String,
}
