// The fragment's types: the part of `src/catalog-model.ts` an extractor
// writes. Property order is the order the TypeScript twin writes them in, so
// that a fragment from either reads the same; a list that is left out when
// empty is null here, which the writer skips.

using System.Text.Json.Serialization;

namespace Portolan.Extract.CSharp;

public sealed class Catalog
{
    [JsonPropertyName("contexts")] public List<Context> Contexts { get; set; } = new();
    [JsonPropertyName("defs")] public Dictionary<string, object> Defs { get; set; } = new();
    [JsonPropertyName("flows")] public List<Flow> Flows { get; set; } = new();
    [JsonPropertyName("adrs")] public List<object> Adrs { get; set; } = new();
    [JsonPropertyName("stores")] public List<Store>? Stores { get; set; }
}

public sealed class Context
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("slug")] public string Slug { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("summary")] public string Summary { get; set; } = "";
    [JsonPropertyName("classification")] public string? Classification { get; set; }
    [JsonPropertyName("services")] public List<Service> Services { get; set; } = new();
}

public sealed class Service
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("slug")] public string Slug { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("repo")] public string Repo { get; set; } = "";
    [JsonPropertyName("path")] public string Path { get; set; } = "";
    [JsonPropertyName("readme")] public string Readme { get; set; } = "";
    [JsonPropertyName("provides")] public List<RpcService> Provides { get; set; } = new();
    [JsonPropertyName("consumes")] public List<object> Consumes { get; set; } = new();
    [JsonPropertyName("aggregates")] public List<Aggregate> Aggregates { get; set; } = new();
    [JsonPropertyName("channels")] public List<Channel>? Channels { get; set; }
    [JsonPropertyName("stores")] public List<string>? Stores { get; set; }
}

public sealed class Channel
{
    [JsonPropertyName("address")] public string Address { get; set; } = "";
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";
    [JsonPropertyName("title")] public string Title { get; set; } = "";
    [JsonPropertyName("doc")] public string Doc { get; set; } = "";
    [JsonPropertyName("messages")] public List<ChannelMessage> Messages { get; set; } = new();
    [JsonPropertyName("source")] public string Source { get; set; } = "";
}

public sealed class ChannelMessage
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("title")] public string Title { get; set; } = "";
    [JsonPropertyName("doc")] public string Doc { get; set; } = "";
    [JsonPropertyName("direction")] public string Direction { get; set; } = "";
}

public sealed class Store
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("slug")] public string Slug { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";
    [JsonPropertyName("owner")] public string Owner { get; set; } = "";
    [JsonPropertyName("tables")] public List<Table> Tables { get; set; } = new();
    [JsonPropertyName("views")] public List<View>? Views { get; set; }
    [JsonPropertyName("source")] public string Source { get; set; } = "";
}

public sealed class Table
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("doc")] public string? Doc { get; set; }
    [JsonPropertyName("columns")] public List<Column> Columns { get; set; } = new();
    [JsonPropertyName("indexes")] public List<TableIndex>? Indexes { get; set; }
    [JsonPropertyName("persists")] public Persists? Persists { get; set; }
    [JsonPropertyName("role")] public string? Role { get; set; }
    [JsonPropertyName("accesses")] public List<TableAccess>? Accesses { get; set; }
}

public sealed class View
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("columns")] public List<Column> Columns { get; set; } = new();
    [JsonPropertyName("reads")] public List<string>? Reads { get; set; }
    [JsonPropertyName("definition")] public string? Definition { get; set; }
    [JsonPropertyName("persists")] public Persists? Persists { get; set; }
    [JsonPropertyName("source")] public string? Source { get; set; }
}

public sealed class Persists
{
    [JsonPropertyName("aggregate")] public string Aggregate { get; set; } = "";
    [JsonPropertyName("block")] public string Block { get; set; } = "";
}

public sealed class TableAccess
{
    [JsonPropertyName("operation")] public string Operation { get; set; } = "";
    [JsonPropertyName("method")] public string Method { get; set; } = "";
    [JsonPropertyName("source")] public string Source { get; set; } = "";
}

public sealed class TableIndex
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("columns")] public List<string> Columns { get; set; } = new();
    [JsonPropertyName("unique")] public bool Unique { get; set; }
}

public sealed class Column
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("type")] public string Type { get; set; } = "";
    [JsonPropertyName("nullable")] public bool Nullable { get; set; }
    [JsonPropertyName("pk")] public bool? Pk { get; set; }
    [JsonPropertyName("fk")] public ForeignKey? Fk { get; set; }
    [JsonPropertyName("maps")] public string? Maps { get; set; }
    [JsonPropertyName("doc")] public string? Doc { get; set; }
}

public sealed class ForeignKey
{
    [JsonPropertyName("table")] public string Table { get; set; } = "";
    [JsonPropertyName("column")] public string Column { get; set; } = "";
}

/// An interface the service answers on: here, the actions of one controller,
/// read into a partial contract the same way extract-php-ddd infers one from
/// route files.
public sealed class RpcService
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("methods")] public List<RpcMethod> Methods { get; set; } = new();
    [JsonPropertyName("source")] public string Source { get; set; } = "";
}

public sealed class RpcMethod
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("doc")] public string Doc { get; set; } = "";
    [JsonPropertyName("http")] public HttpRoute Http { get; set; } = new();
}

public sealed class HttpRoute
{
    [JsonPropertyName("method")] public string Method { get; set; } = "";
    [JsonPropertyName("path")] public string Path { get; set; } = "";
}

public sealed class Aggregate
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("slug")] public string Slug { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("readme")] public string Readme { get; set; } = "";
    /// `model-group`: a source grouping with no confirmed aggregate boundary,
    /// which is what a domain directory without a root, or an application
    /// group without a domain directory, is.
    [JsonPropertyName("kind")] public string? Kind { get; set; }
    [JsonPropertyName("root")] public string Root { get; set; } = "";
    [JsonPropertyName("entities")] public List<Block> Entities { get; set; } = new();
    [JsonPropertyName("valueObjects")] public List<Block> ValueObjects { get; set; } = new();
    [JsonPropertyName("operations")] public List<Operation> Operations { get; set; } = new();
    [JsonPropertyName("events")] public List<Event> Events { get; set; } = new();
    [JsonPropertyName("enums")] public List<Enum>? Enums { get; set; }
}

public sealed class Enum
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("slug")] public string Slug { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("doc")] public string Doc { get; set; } = "";
    [JsonPropertyName("deprecated")] public bool? Deprecated { get; set; }
    [JsonPropertyName("values")] public List<EnumValue> Values { get; set; } = new();
}

public sealed class EnumValue
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("doc")] public string Doc { get; set; } = "";
    [JsonPropertyName("deprecated")] public bool? Deprecated { get; set; }
}

public sealed class Block
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("slug")] public string Slug { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("doc")] public string Doc { get; set; } = "";
    [JsonPropertyName("fields")] public List<Field> Fields { get; set; } = new();
}

public sealed class Field
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("type")] public string Type { get; set; } = "";
    [JsonPropertyName("doc")] public string Doc { get; set; } = "";
}

public sealed class Operation
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";
    [JsonPropertyName("doc")] public string Doc { get; set; } = "";
    [JsonPropertyName("exposedBy")] public List<string>? ExposedBy { get; set; }
    /// The message's shape: what the caller hands in.
    [JsonPropertyName("fields")] public List<Field> Fields { get; set; } = new();
    /// The handler, `path:line`.
    [JsonPropertyName("source")] public string? Source { get; set; }
}

public sealed class Event
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("slug")] public string Slug { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("versions")] public List<EventVersion> Versions { get; set; } = new();
    [JsonPropertyName("consumers")] public List<EventConsumer> Consumers { get; set; } = new();
    [JsonPropertyName("wire")] public Wire? Wire { get; set; }
}

public sealed class EventConsumer
{
    [JsonPropertyName("service")] public string Service { get; set; } = "";
    [JsonPropertyName("status")] public string Status { get; set; } = "";
    [JsonPropertyName("note")] public string? Note { get; set; }
}

public sealed class Wire
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("channel")] public string? Channel { get; set; }
}

public sealed class EventVersion
{
    [JsonPropertyName("version")] public string Version { get; set; } = "";
    [JsonPropertyName("doc")] public string Doc { get; set; } = "";
    [JsonPropertyName("source")] public string Source { get; set; } = "";
    [JsonPropertyName("fields")] public List<Field> Fields { get; set; } = new();
}

public sealed class Flow
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("slug")] public string Slug { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("summary")] public string Summary { get; set; } = "";
    [JsonPropertyName("source")] public string Source { get; set; } = "";
    [JsonPropertyName("trigger")] public Trigger? Trigger { get; set; }
    [JsonPropertyName("owner")] public string Owner { get; set; } = "";
    [JsonPropertyName("participants")] public List<Participant> Participants { get; set; } = new();
    [JsonPropertyName("steps")] public List<Step> Steps { get; set; } = new();
}

public sealed class Trigger
{
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";
    [JsonPropertyName("label")] public string? Label { get; set; }
    [JsonPropertyName("confidence")] public string Confidence { get; set; } = "";
}

public sealed class Participant
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";
    [JsonPropertyName("context")] public string? Context { get; set; }
    [JsonPropertyName("label")] public string? Label { get; set; }
}

public sealed class Step
{
    [JsonPropertyName("type")] public string Type { get; set; } = "step";
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("from")] public string From { get; set; } = "";
    [JsonPropertyName("to")] public string To { get; set; } = "";
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";
    [JsonPropertyName("label")] public string Label { get; set; } = "";
    [JsonPropertyName("status")] public string Status { get; set; } = "declared";
    [JsonPropertyName("ref")] public string? Ref { get; set; }
    [JsonPropertyName("note")] public string? Note { get; set; }
    [JsonPropertyName("line")] public string? Line { get; set; }
    [JsonPropertyName("handoff")] public Handoff? Handoff { get; set; }
    [JsonPropertyName("storeAccess")] public StoreAccess? StoreAccess { get; set; }
}

public sealed class Handoff
{
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";
    [JsonPropertyName("transport")] public string Transport { get; set; } = "";
    [JsonPropertyName("channel")] public string Channel { get; set; } = "";
    [JsonPropertyName("message")] public string Message { get; set; } = "";
    [JsonPropertyName("direction")] public string Direction { get; set; } = "";
}

public sealed class StoreAccess
{
    [JsonPropertyName("store")] public string Store { get; set; } = "";
    [JsonPropertyName("method")] public string Method { get; set; } = "";
}
