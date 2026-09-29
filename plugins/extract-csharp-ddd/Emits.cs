// What an operation can publish, read off the domain calls its handler makes.
//
//     internal static Meeting CreateNew(...)
//     {
//         meeting.AddDomainEvent(new MeetingCreatedDomainEvent(meeting.Id));
//         meeting.AddAttendee(creatorId, 0);
//     }
//
//     public async Task<Guid> Handle(CreateMeetingCommand request, ...)
//     {
//         var meeting = Meeting.CreateNew(...);
//     }
//
// The root says which of its members produce which events: a method, a
// constructor or a static factory produces the events it news up - which is
// what `AddDomainEvent(new X(...))` does - and the events its return type
// names, and whatever the root's own members it calls produce. The handler
// says which of those it calls. The event is the domain's to name, and the
// handler only decides whether to run the member that names it - so the
// operation emits what it reaches, whether or not a branch keeps the result.
//
// A call is matched by symbol when it binds and by name when it does not: a
// receiver that came out of Dapper or an unreferenced package is an error
// type, and a root method of that name is then the likeliest reading, the
// same guess the flows make.

using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Portolan.Extract.CSharp;

public sealed class Emitters
{
    private const string Constructor = ".ctor";

    private readonly Tree tree;
    private readonly AggregateInfo aggregate;
    private readonly Dictionary<string, int> order = new(StringComparer.Ordinal);
    private readonly Dictionary<string, HashSet<string>> members = new(StringComparer.Ordinal);

    /// Reads the root's members against the events the aggregate writes, in
    /// the order it writes them.
    public Emitters(Tree tree, AggregateInfo aggregate, List<Event> events)
    {
        this.tree = tree;
        this.aggregate = aggregate;
        for (var i = 0; i < events.Count; i++) order[events[i].Id] = i;
        if (aggregate.Root != null && events.Count > 0) ReadRoot(aggregate.Root);
    }

    /// Each member's own events and the root members it calls, then the calls
    /// folded in until nothing changes: a factory that adds its first
    /// attendee through `AddAttendee` emits what `AddAttendee` raises.
    private void ReadRoot(INamedTypeSymbol root)
    {
        var calls = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        foreach (var method in root.GetMembers().OfType<IMethodSymbol>())
        {
            if (method.IsImplicitlyDeclared || method.MethodKind is not (MethodKind.Ordinary or MethodKind.Constructor)) continue;
            // A private helper is only reached from the root's own members,
            // and its name may be one a handler uses for something else.
            var key = method.DeclaredAccessibility == Accessibility.Private ? "private " + Key(method) : Key(method);
            var own = members.TryGetValue(key, out var existing) ? existing : members[key] = new HashSet<string>(StringComparer.Ordinal);
            var callees = calls.TryGetValue(key, out var c) ? c : calls[key] = new HashSet<string>(StringComparer.Ordinal);
            foreach (var id in TypeEvents(method.ReturnType)) own.Add(id);
            foreach (var reference in method.DeclaringSyntaxReferences)
            {
                var syntax = reference.GetSyntax();
                var model = tree.Model(syntax.SyntaxTree);
                foreach (var n in syntax.DescendantNodes())
                {
                    switch (n)
                    {
                        case BaseObjectCreationExpressionSyntax creation:
                            var created = model.GetTypeInfo(creation).Type;
                            if (EventId(created) is { } id) own.Add(id);
                            else if (IsRoot(created))
                            {
                                callees.Add(Constructor);
                                callees.Add("private " + Constructor);
                            }
                            break;
                        case InvocationExpressionSyntax invocation:
                            foreach (var callee in Callees(model, invocation, privateToo: true)) callees.Add(callee);
                            break;
                    }
                }
            }
        }
        for (var changed = true; changed;)
        {
            changed = false;
            foreach (var (key, callees) in calls)
            {
                foreach (var callee in callees)
                {
                    if (!members.TryGetValue(callee, out var theirs)) continue;
                    foreach (var id in theirs) changed |= members[key].Add(id);
                }
            }
        }
    }

    /// What the operation reached from its handler class can publish: the
    /// root's members it calls, and the aggregate's events it news up
    /// itself. Null when it reaches none.
    public List<string>? Of(HandlerInfo handler)
    {
        if (order.Count == 0) return null;
        var found = new HashSet<string>(StringComparer.Ordinal);
        foreach (var reference in handler.Handler.DeclaringSyntaxReferences)
        {
            var syntax = reference.GetSyntax();
            var model = tree.Model(syntax.SyntaxTree);
            foreach (var n in syntax.DescendantNodes())
            {
                switch (n)
                {
                    case BaseObjectCreationExpressionSyntax creation:
                        var created = model.GetTypeInfo(creation).Type;
                        if (EventId(created) is { } id) found.Add(id);
                        else if (IsRoot(created)) found.UnionWith(Produced(Constructor));
                        break;
                    case InvocationExpressionSyntax invocation:
                        found.UnionWith(Callees(model, invocation, privateToo: false).SelectMany(Produced));
                        break;
                }
            }
        }
        if (found.Count == 0) return null;
        return found.OrderBy(id => order[id]).ToList();
    }

    private IEnumerable<string> Produced(string key) => members.TryGetValue(key, out var ids) ? ids : Enumerable.Empty<string>();

    /// The root members a call can be: the one it binds to, or, unbound, the
    /// members of its name - static only when it is spelled on the root's
    /// name, `Meeting.CreateNew(...)`.
    private IEnumerable<string> Callees(SemanticModel model, InvocationExpressionSyntax invocation, bool privateToo)
    {
        var method = Calls.Method(model, invocation);
        if (method != null)
        {
            if (!IsRoot(method.ContainingType)) yield break;
            yield return Key(method);
            if (privateToo) yield return "private " + Key(method);
            yield break;
        }
        var (name, _) = Calls.Resolve(tree, model, invocation);
        if (name == "") yield break;
        var onRoot = invocation.Expression is MemberAccessExpressionSyntax { Expression: IdentifierNameSyntax receiver } && receiver.Identifier.Text == aggregate.Root?.Name;
        yield return onRoot ? "static " + name : name;
        if (privateToo) yield return "private " + (onRoot ? "static " + name : name);
    }

    private static string Key(IMethodSymbol method) =>
        method.MethodKind == MethodKind.Constructor ? Constructor : (method.IsStatic ? "static " : "") + method.Name;

    private bool IsRoot(ITypeSymbol? type) =>
        type != null && aggregate.Root != null && SymbolEqualityComparer.Default.Equals(type.OriginalDefinition, aggregate.Root);

    /// The events a return type names: the type itself, or what it wraps -
    /// `Task<X>`, `IEnumerable<X>`.
    private IEnumerable<string> TypeEvents(ITypeSymbol type)
    {
        if (EventId(type) is { } id) yield return id;
        if (type is INamedTypeSymbol { IsGenericType: true } generic)
        {
            foreach (var argument in generic.TypeArguments)
            {
                if (EventId(argument) is { } wrapped) yield return wrapped;
            }
        }
    }

    /// The id of one of this aggregate's events, domain or integration; an
    /// event another aggregate files is that aggregate's to publish.
    private string? EventId(ITypeSymbol? type)
    {
        if (type is not INamedTypeSymbol named) return null;
        string? id = null;
        if (tree.DomainEvents.TryGetValue(named, out var domainEvent) && domainEvent.Aggregate == aggregate) id = domainEvent.Id;
        else if (tree.IntegrationEvents.TryGetValue(named, out var ie) && ie.Aggregate == aggregate) id = ie.Id;
        return id != null && order.ContainsKey(id) ? id : null;
    }
}
