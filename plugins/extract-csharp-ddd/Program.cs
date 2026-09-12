// One request on stdin, one response on stdout, warnings on stderr.

using System.Text;
using System.Text.Json;
using Portolan.Extract.CSharp;

var stdin = Console.OpenStandardInput();
using var reader = new StreamReader(stdin, new UTF8Encoding(false));
var raw = await reader.ReadToEndAsync();

Request request;
try
{
    request = JsonSerializer.Deserialize<Request>(raw.Length == 0 ? "{}" : raw) ?? new Request();
}
catch (JsonException e)
{
    Console.Error.WriteLine($"portolan-extract-csharp-ddd: reading the request: {e.Message}");
    return 1;
}

var response = new Response();
if (request.Kind == "describe")
{
    using var stream = typeof(Request).Assembly.GetManifestResourceStream("options.schema.json")!;
    using var schemaReader = new StreamReader(stream);
    var schema = JsonDocument.Parse(await schemaReader.ReadToEndAsync());
    response.Describe = new Descriptor
    {
        Name = "extract-csharp-ddd",
        Summary = "A C# tree laid out by module and layer - src/Modules/<Module>/{Domain,Application,Infrastructure,IntegrationEvents}, controllers under an API host, a database project - read into contexts, aggregates, commands and queries, domain and integration events, an in-memory bus, SQL Server schemas and flows, through Roslyn without restoring a package.",
        Category = "code",
        Phases = { "extract" },
        Options = schema.RootElement.Clone(),
    };
}
else
{
    Builder built;
    try
    {
        built = Extract.Run(Directory.GetCurrentDirectory(), request);
    }
    catch (Exception e)
    {
        Console.Error.WriteLine($"portolan-extract-csharp-ddd: {e}");
        return 1;
    }
    response.Files = built.Files;
    foreach (var warning in built.Warnings)
    {
        Console.Error.WriteLine(warning.Reference == "" ? $"warning: {warning.Message}" : $"warning: {warning.Reference}: {warning.Message}");
    }
}

var stdout = Console.OpenStandardOutput();
await using var writer = new StreamWriter(stdout, new UTF8Encoding(false));
await writer.WriteAsync(JsonSerializer.Serialize(response, Json.Writing));
return 0;
