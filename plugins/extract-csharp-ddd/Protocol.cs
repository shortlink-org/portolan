// The plugin protocol, as `plugin/protocol.go` spells it: one request on
// stdin, one response on stdout, and a `describe` that answers with what the
// plugin is and what it can be told. Warnings go to stderr, one per
// `warning: ` line, which is how the host reads them from every process
// plugin.

using System.Text.Json;
using System.Text.Json.Serialization;

namespace Portolan.Extract.CSharp;

public sealed class Request
{
    [JsonPropertyName("portolanVersion")] public string PortolanVersion { get; set; } = "";
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";
    [JsonPropertyName("input")] public Input Input { get; set; } = new();
    [JsonPropertyName("options")] public JsonElement Options { get; set; }
}

public sealed class Input
{
    [JsonPropertyName("root")] public string Root { get; set; } = "";
    [JsonPropertyName("output")] public string Output { get; set; } = "";
}

/// What the manifest tells the extractor: the things a tree does not say
/// about the estate it belongs to.
public sealed class Options
{
    [JsonPropertyName("modules")] public string Modules { get; set; } = "";
    [JsonPropertyName("api")] public string Api { get; set; } = "";
    [JsonPropertyName("database")] public string Database { get; set; } = "";
    [JsonPropertyName("repo")] public string Repo { get; set; } = "";
    [JsonPropertyName("bus")] public string Bus { get; set; } = "";
    [JsonPropertyName("storeKind")] public string StoreKind { get; set; } = "";
    [JsonPropertyName("classification")] public string? Classification { get; set; }
    [JsonPropertyName("out")] public string Out { get; set; } = "";
    [JsonPropertyName("openapiOut")] public string OpenapiOut { get; set; } = "";
    [JsonPropertyName("storesOut")] public string StoresOut { get; set; } = "";

    public static Options From(JsonElement element)
    {
        var options = element.ValueKind == JsonValueKind.Object
            ? JsonSerializer.Deserialize<Options>(element.GetRawText(), Json.Reading) ?? new Options()
            : new Options();
        if (options.Modules == "") options.Modules = "src/Modules";
        if (options.Api == "") options.Api = "src/API";
        if (options.Database == "") options.Database = "src/Database";
        if (options.Bus == "") options.Bus = "integration-events";
        if (options.StoreKind == "") options.StoreKind = "other";
        if (options.Out == "") options.Out = "domain.json";
        if (options.OpenapiOut == "") options.OpenapiOut = "openapi.{service}.yaml";
        if (options.StoresOut == "") options.StoresOut = "stores.json";
        return options;
    }
}

public sealed class Response
{
    [JsonPropertyName("files")] public List<OutFile> Files { get; set; } = new();
    [JsonPropertyName("describe")] public Descriptor? Describe { get; set; }
}

public sealed class OutFile
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("contents")] public string Contents { get; set; } = "";
}

public sealed class Descriptor
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("summary")] public string Summary { get; set; } = "";
    [JsonPropertyName("category")] public string Category { get; set; } = "";
    [JsonPropertyName("phases")] public List<string> Phases { get; set; } = new();
    [JsonPropertyName("options")] public JsonElement Options { get; set; }
}

public sealed record Warning(string Reference, string Message);

/// Collects what the run produces: the files, and every diagnostic beside
/// them. Reported, never papered over inside the fragment.
public sealed class Builder
{
    public List<OutFile> Files { get; } = new();
    public List<Warning> Warnings { get; } = new();

    public void Warn(string reference, string message) => Warnings.Add(new Warning(reference, message));

    public void File(string name, string contents) => Files.Add(new OutFile { Name = name, Contents = contents });
}

public static class Json
{
    public static readonly JsonSerializerOptions Reading = new()
    {
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
    };

    public static readonly JsonSerializerOptions Writing = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// Pretty JSON the way serde_json and Go's encoder write it: two-space
    /// indent, a newline at the end, and `[]` for an empty list.
    public static string Pretty<T>(T value) => JsonSerializer.Serialize(value, Writing) + "\n";
}
