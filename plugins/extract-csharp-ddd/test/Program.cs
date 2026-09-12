// The reader, held to a fixture. No framework: the plugin has one dependency
// and a test runner would be a second. Run from anywhere:
//
//     dotnet run --project plugins/extract-csharp-ddd/test
//
// UPDATE_GOLDEN=1 writes the expected files again after a deliberate change,
// and the diff is the review.

using System.Text.Json;
using Portolan.Extract.CSharp;

var failures = new List<string>();
void Check(bool ok, string what)
{
    if (!ok) failures.Add(what);
}

// The repository root: the directory that has plugins/extract-csharp-ddd/testdata under it.
var root = AppContext.BaseDirectory;
while (root != null && !Directory.Exists(Path.Combine(root, "plugins", "extract-csharp-ddd", "testdata")))
{
    root = Path.GetDirectoryName(root.TrimEnd(Path.DirectorySeparatorChar));
}
if (root == null)
{
    Console.Error.WriteLine("cannot find plugins/extract-csharp-ddd/testdata above " + AppContext.BaseDirectory);
    return 2;
}
var fixture = "plugins/extract-csharp-ddd/testdata/mymeetings";
var request = new Request
{
    PortolanVersion = "0.1.0",
    Input = new Input { Root = fixture, Output = fixture },
    Options = JsonDocument.Parse("""{"classification":"core","repo":"github.com/acme/mymeetings"}""").RootElement,
};
var built = Extract.Run(root, request);
var files = built.Files.ToDictionary(f => f.Name, f => f.Contents, StringComparer.Ordinal);
var warnings = string.Join("\n", built.Warnings.Select(w => w.Reference == "" ? w.Message : $"{w.Reference}: {w.Message}")) + "\n";

// Goldens.
var goldens = new Dictionary<string, string>
{
    ["expected.json"] = files.GetValueOrDefault("domain.json") ?? "",
    ["expected-stores.json"] = files.GetValueOrDefault("stores.json") ?? "",
    ["openapi.meetings.yaml"] = files.GetValueOrDefault("openapi.meetings.yaml") ?? "",
    ["openapi.registrations.yaml"] = files.GetValueOrDefault("openapi.registrations.yaml") ?? "",
    ["expected-warnings.txt"] = warnings,
};
var update = Environment.GetEnvironmentVariable("UPDATE_GOLDEN") == "1";
foreach (var (name, actual) in goldens)
{
    var path = Path.Combine(root, fixture, name);
    if (update)
    {
        File.WriteAllText(path, actual);
        continue;
    }
    var expected = File.Exists(path) ? File.ReadAllText(path) : "";
    if (expected != actual)
    {
        failures.Add($"{name} differs from what the extractor writes now{FirstDifference(expected, actual)}\n  (UPDATE_GOLDEN=1 rewrites it after a deliberate change)");
    }
}

// The rules, asserted where the golden would only show them.
var catalog = JsonDocument.Parse(files["domain.json"]).RootElement;
var stores = JsonDocument.Parse(files["stores.json"]).RootElement;
Check(files.Count == 4, $"four files are written, not {files.Count}: {string.Join(", ", files.Keys)}");
Check(catalog.GetProperty("contexts").GetArrayLength() == 3, "three modules, three contexts");

var meetings = Aggregate(catalog, "meetings.module.meetings");
Check(meetings.GetProperty("root").GetString() == "Meeting", "Meeting, implementing IAggregateRoot, is the root of Domain/Meetings");
Check(Names(meetings.GetProperty("entities")) == "Meeting,MeetingAttendee", "the root comes first among the entities, then MeetingAttendee");
Check(Names(meetings.GetProperty("valueObjects")) == "MeetingId,MeetingTerm", "the typed id and the value object are the value objects; the rule under Rules/ is not");
Check(FieldTypes(meetings.GetProperty("valueObjects")[0]) == "value:Guid", "MeetingId inherits value: Guid from TypedIdValueBase");
Check(meetings.GetProperty("enums")[0].GetProperty("values").EnumerateArray().Any(v => v.GetProperty("name").GetString() == "Postponed" && v.GetProperty("deprecated").GetBoolean()), "an [Obsolete] enum member is deprecated");
Check(Ids(meetings.GetProperty("operations")) == "cancel-meeting,create-meeting,get-meeting-details", "the handlers under Application/Meetings are its operations");
Check(Operation(meetings, "create-meeting").GetProperty("exposedBy")[0].GetString() == "CreateNewMeeting", "the controller action that news the command up exposes it");
Check(Operation(meetings, "create-meeting").GetProperty("fields").GetArrayLength() == 3, "a command's fields are its constructor's parameters");
var created = meetings.GetProperty("events").EnumerateArray().First(e => e.GetProperty("name").GetString() == "MeetingCreatedDomainEvent");
Check(!created.TryGetProperty("wire", out _), "a domain event has no wire");
Check(created.GetProperty("consumers")[0].GetProperty("note").GetString() == "MeetingCreatedEventHandler", "the INotificationHandler of the event is its consumer");
var attendeeAdded = meetings.GetProperty("events").EnumerateArray().First(e => e.GetProperty("name").GetString() == "MeetingAttendeeAddedIntegrationEvent");
Check(attendeeAdded.GetProperty("wire").GetProperty("channel").GetString() == "integration-events.MeetingAttendeeAddedIntegrationEvent", "an integration event is its own channel on the bus");
Check(attendeeAdded.GetProperty("consumers").GetArrayLength() == 0, "nobody subscribes to MeetingAttendeeAddedIntegrationEvent");

var registrations = Aggregate(catalog, "registrations.module.user-registrations");
var registered = registrations.GetProperty("events").EnumerateArray().First(e => e.GetProperty("name").GetString() == "NewUserRegisteredIntegrationEvent");
Check(registered.GetProperty("consumers")[0].GetProperty("service").GetString() == "meetings.module"
      && registered.GetProperty("consumers")[0].GetProperty("status").GetString() == "declared", "Meetings subscribes to NewUserRegistered and handles it");

var countries = Aggregate(catalog, "meetings.module.countries");
Check(countries.GetProperty("kind").GetString() == "model-group", "an application group with no domain directory is a model-group");

var subscriptions = Aggregate(catalog, "payments.module.subscriptions");
Check(subscriptions.GetProperty("root").GetString() == "Subscription", "a class extending the module's own AggregateRoot is a root");
Check(FieldTypes(subscriptions.GetProperty("entities")[0]).StartsWith("id:Guid,version:int,", StringComparison.Ordinal), "the event-sourced base's Id and Version are fields of the root");

var meetingsService = Service(catalog, "meetings.module");
Check(meetingsService.GetProperty("channels").EnumerateArray().Any(c => c.GetProperty("address").GetString() == "meetings.internal-commands" && c.GetProperty("kind").GetString() == "job"), "a module that enqueues has an internal-commands job channel");
Check(meetingsService.GetProperty("provides").GetArrayLength() == 2, "two controllers under Modules/Meetings: two interfaces");

var flows = catalog.GetProperty("flows").EnumerateArray().ToDictionary(f => f.GetProperty("slug").GetString()!, f => f);
var createMeeting = flows["meetings-meetings-create-new-meeting"];
Check(Labels(createMeeting) == "POST /api/meetings/meetings|MeetingCreatedDomainEvent|MeetingAttendeeAddedDomainEvent|IMeetingRepository.AddAsync",
    "creating a meeting: the request, the two events the factory raises (one from inside AddAttendee), the save; got " + Labels(createMeeting));
Check(createMeeting.GetProperty("trigger").GetProperty("kind").GetString() == "http", "a controller flow is triggered by http");
var onRegistered = flows["meetings-new-user-registered-integration-event-handler"];
Check(onRegistered.GetProperty("steps")[0].GetProperty("handoff").GetProperty("direction").GetString() == "receive"
      && onRegistered.GetProperty("steps")[1].GetProperty("handoff").GetProperty("kind").GetString() == "job", "hearing an integration event: received from the bus, a job enqueued");
var createMember = flows["meetings-create-member-job"];
Check(createMember.GetProperty("steps")[0].GetProperty("ref").GetString() == "meetings.module.members/create-member", "the dequeue step names the operation as <aggregate>/<operation>");
Check(flows["payments-expire-subscriptions-scheduled"].GetProperty("trigger").GetProperty("kind").GetString() == "scheduled", "a recurring command is a scheduled flow");
Check(Labels(flows["payments-expire-subscriptions-scheduled"]).Contains("read payments.SubscriptionDetails|IAggregateStore.Load|SubscriptionExpiredDomainEvent|IAggregateStore.AppendChanges"),
    "the Dapper read, the event store and the event raised are followed; got " + Labels(flows["payments-expire-subscriptions-scheduled"]));

var db = stores.GetProperty("stores").EnumerateArray().First(s => s.GetProperty("id").GetString() == "meetings.module.db");
var meetingsTable = Table(db, "Meetings");
Check(meetingsTable.GetProperty("role").GetString() == "aggregate-root" && meetingsTable.GetProperty("persists").GetProperty("block").GetString() == "meetings.module.meetings.meeting", "ToTable in the root's configuration: the table persists the root");
Check(Column(meetingsTable, "TermStartDate").GetProperty("maps").GetString() == "Meeting.term", "an owned value object's column maps to the owner's field");
Check(Column(meetingsTable, "Title").GetProperty("maps").GetString() == "Meeting.title", "Property<string>(\"_title\").HasColumnName(\"Title\") maps the column to the field");
var attendees = Table(db, "MeetingAttendees");
Check(attendees.GetProperty("role").GetString() == "child" && attendees.GetProperty("persists").GetProperty("block").GetString() == "meetings.module.meetings.meeting-attendee", "OwnsMany with its own ToTable is the child's table");
Check(Column(attendees, "MeetingId").GetProperty("fk").GetProperty("table").GetString() == "meetings.module.db.Meetings", "a FOREIGN KEY constraint is read");
Check(attendees.GetProperty("indexes")[0].GetProperty("name").GetString() == "IX_meetings_MeetingAttendees_AttendeeId", "an index created beside the table is read");
Check(Table(db, "Countries").GetProperty("role").GetString() == "lookup", "a table only ever read is a lookup");
Check(Table(db, "OutboxMessages").GetProperty("role").GetString() == "outbox" && Table(db, "InternalCommands").GetProperty("role").GetString() == "other", "the outbox is the outbox; the internal queue is not");
Check(meetingsTable.GetProperty("accesses").EnumerateArray().Any(a => a.GetProperty("method").GetString() == "GetMeetingDetailsQueryHandler.Handle"), "a read of v_MeetingDetails is an access on the table the view reads");
var view = db.GetProperty("views").EnumerateArray().First(v => v.GetProperty("name").GetString() == "v_MeetingDetails");
Check(view.GetProperty("persists").GetProperty("block").GetString() == "meetings.module.meetings.meeting", "a view over one aggregate's tables presents the aggregate");
Check(view.GetProperty("columns").EnumerateArray().Last().GetProperty("name").GetString() == "Status", "AS [Status] names the view's column");
var payments = stores.GetProperty("stores").EnumerateArray().First(s => s.GetProperty("id").GetString() == "payments.module.db");
Check(Table(payments, "SubscriptionDetails").GetProperty("role").GetString() == "projection", "a table the application layer writes with SQL is a projection");
Check(Table(payments, "Messages").GetProperty("accesses").GetArrayLength() == 3, "the IAggregateStore adapter's methods access Messages");
Check(!stores.GetProperty("stores").EnumerateArray().Any(s => s.GetProperty("id").GetString()!.EndsWith(".app")), "the app schema belongs to nobody");

Check(warnings.Contains("UserRegistrationsController sits under no module's directory"), "a controller under a module the tree does not have is reported");
Check(warnings.Contains("MemberCreatedIntegrationEvent is declared and published nowhere"), "an integration event nobody publishes is reported");
Check(warnings.Contains("Domain/Users has no aggregate root"), "a domain directory with no root and no group is reported");

if (failures.Count > 0)
{
    Console.Error.WriteLine($"{failures.Count} failure(s):");
    foreach (var failure in failures) Console.Error.WriteLine("  - " + failure);
    return 1;
}
Console.WriteLine(update ? "goldens written" : "ok");
return 0;

static JsonElement Service(JsonElement catalog, string id) =>
    catalog.GetProperty("contexts").EnumerateArray().SelectMany(c => c.GetProperty("services").EnumerateArray()).First(s => s.GetProperty("id").GetString() == id);

static JsonElement Aggregate(JsonElement catalog, string id) =>
    catalog.GetProperty("contexts").EnumerateArray().SelectMany(c => c.GetProperty("services").EnumerateArray()).SelectMany(s => s.GetProperty("aggregates").EnumerateArray()).First(a => a.GetProperty("id").GetString() == id);

static JsonElement Operation(JsonElement aggregate, string id) =>
    aggregate.GetProperty("operations").EnumerateArray().First(o => o.GetProperty("id").GetString() == id);

static JsonElement Table(JsonElement store, string name) =>
    store.GetProperty("tables").EnumerateArray().First(t => t.GetProperty("name").GetString() == name);

static JsonElement Column(JsonElement table, string name) =>
    table.GetProperty("columns").EnumerateArray().First(c => c.GetProperty("name").GetString() == name);

static string Names(JsonElement blocks) => string.Join(",", blocks.EnumerateArray().Select(b => b.GetProperty("name").GetString()));

static string Ids(JsonElement items) => string.Join(",", items.EnumerateArray().Select(b => b.GetProperty("id").GetString()));

static string FieldTypes(JsonElement block) => string.Join(",", block.GetProperty("fields").EnumerateArray().Select(f => $"{f.GetProperty("name").GetString()}:{f.GetProperty("type").GetString()}"));

static string Labels(JsonElement flow) => string.Join("|", flow.GetProperty("steps").EnumerateArray().Select(s => s.GetProperty("label").GetString()));

static string FirstDifference(string expected, string actual)
{
    var e = expected.Split('\n');
    var a = actual.Split('\n');
    for (var i = 0; i < Math.Max(e.Length, a.Length); i++)
    {
        var left = i < e.Length ? e[i] : "<end>";
        var right = i < a.Length ? a[i] : "<end>";
        if (left != right) return $"\n  line {i + 1}:\n    expected: {left}\n    actual:   {right}";
    }
    return "";
}
