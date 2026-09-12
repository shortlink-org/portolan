// The application layer: a handler is a class whose base list says
// `ICommandHandler<C>` or `IQueryHandler<Q, R>`, and the message names the
// operation. `INotificationHandler<T>` is a consumer - of a domain event, of
// the notification wrapping one after the unit of work commits, or of an
// integration event another module put on the bus. What a module publishes
// is read from `IEventsBus.Publish(new X(...))`, what it hears from
// `SubscribeToIntegrationEvent<X>` in its infrastructure, and what it puts
// on its own internal queue from `ICommandsScheduler.EnqueueAsync(new X(...))`.

using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Portolan.Extract.CSharp;

public sealed class HandlerInfo
{
    public required Module Module { get; init; }
    public required AggregateInfo Aggregate { get; init; }
    public required INamedTypeSymbol Handler { get; init; }
    public required INamedTypeSymbol Message { get; init; }
    public required IMethodSymbol Handle { get; init; }
    public required string Kind { get; init; }
    public bool Internal { get; init; }
    public bool Recurring { get; init; }
    public List<string> ExposedBy { get; } = new();
    public string OpId => Names.Kebab(Names.Strip(Message.Name, "Command", "Query"));
    /// How a flow step names the operation it runs: `<aggregate>/<operation>`.
    public string Ref => Aggregate.Id + "/" + OpId;
}

public sealed class NotificationHandlerInfo
{
    public required Module Module { get; init; }
    public required INamedTypeSymbol Handler { get; init; }
    public required IMethodSymbol Handle { get; init; }
    public DomainEventInfo? DomainEvent { get; init; }
    public INamedTypeSymbol? IntegrationEventType { get; init; }
    public IntegrationEventInfo? IntegrationEvent { get; set; }
    public bool ViaNotification { get; init; }
}

public sealed class IntegrationEventInfo
{
    public required INamedTypeSymbol Type { get; init; }
    public required Module Owner { get; init; }
    public Module? Publisher { get; set; }
    public DomainEventInfo? From { get; set; }
    public AggregateInfo? Aggregate { get; set; }
    public string PublishSource { get; set; } = "";
    public string Id => (Aggregate?.Id ?? Owner.ServiceId + ".integration-events") + "." + Type.Name;
}

public static class Application
{
    public static void Read(Tree tree)
    {
        foreach (var module in tree.Modules)
        {
            foreach (var syntaxTree in module.IntegrationEvents)
            {
                foreach (var type in tree.TypesIn(syntaxTree))
                {
                    if (!Model.IsIntegrationEvent(type)) continue;
                    tree.IntegrationEvents[type] = new IntegrationEventInfo { Type = type, Owner = module };
                }
            }
        }
        foreach (var module in tree.Modules) ReadHandlers(tree, module);
        foreach (var module in tree.Modules) ReadPublishing(tree, module);
        foreach (var module in tree.Modules) ReadSubscriptions(tree, module);
        Link(tree);
    }

    private static void ReadHandlers(Tree tree, Module module)
    {
        var applicationDir = Path.Combine(module.Dir, "Application") + "/";
        foreach (var syntaxTree in module.Application)
        {
            var rel = syntaxTree.FilePath[applicationDir.Length..];
            var group = rel.Contains('/') ? rel[..rel.IndexOf('/')] : "";
            if (group is "Configuration" or "Contracts") continue;
            foreach (var type in tree.TypesIn(syntaxTree))
            {
                if (type.TypeKind != TypeKind.Class || type.IsAbstract) continue;
                foreach (var (name, args) in tree.SyntaxBases(type))
                {
                    if (args.Count == 0 || args[0] is not INamedTypeSymbol message || message.TypeKind != TypeKind.Class) continue;
                    if (name is "ICommandHandler" or "IQueryHandler")
                    {
                        var handle = type.GetMembers("Handle").OfType<IMethodSymbol>().FirstOrDefault();
                        if (handle == null)
                        {
                            tree.Out.Warn(tree.Line(type), $"{type.Name} implements {name}<{message.Name}> but has no Handle method");
                            continue;
                        }
                        var aggregate = AggregateFor(module, group);
                        var handler = new HandlerInfo
                        {
                            Module = module,
                            Aggregate = aggregate,
                            Handler = type,
                            Message = message,
                            Handle = handle,
                            Kind = name == "ICommandHandler" ? "command" : "query",
                            Internal = Tree.Derives(message, "InternalCommandBase"),
                            Recurring = tree.Implements(message, "IRecurringCommand"),
                        };
                        if (tree.HandlerByMessage.TryGetValue(message, out var other))
                        {
                            tree.Out.Warn(tree.Line(type), $"{message.Name} has two handlers, {other.Handler.Name} and {type.Name}; the first is kept");
                            continue;
                        }
                        tree.HandlerByMessage[message] = handler;
                        module.Handlers.Add(handler);
                        aggregate.Operations.Add(handler);
                    }
                    else if (name == "INotificationHandler")
                    {
                        var handle = type.GetMembers("Handle").OfType<IMethodSymbol>().FirstOrDefault();
                        if (handle == null) continue;
                        NotificationHandlerInfo? info = null;
                        if (tree.DomainEvents.TryGetValue(message, out var domainEvent))
                        {
                            info = new NotificationHandlerInfo { Module = module, Handler = type, Handle = handle, DomainEvent = domainEvent };
                        }
                        else if (Tree.Base(message, "DomainNotificationBase") is { TypeArguments.Length: 1 } notification
                                 && notification.TypeArguments[0] is INamedTypeSymbol wrapped && tree.DomainEvents.TryGetValue(wrapped, out var viaEvent))
                        {
                            info = new NotificationHandlerInfo { Module = module, Handler = type, Handle = handle, DomainEvent = viaEvent, ViaNotification = true };
                        }
                        else if (Model.IsIntegrationEvent(message))
                        {
                            info = new NotificationHandlerInfo { Module = module, Handler = type, Handle = handle, IntegrationEventType = message };
                        }
                        else
                        {
                            tree.Out.Warn(tree.Line(type), $"{type.Name} handles {message.Name}, which is neither a domain event, a domain notification nor an integration event the tree declares");
                        }
                        if (info != null)
                        {
                            module.NotificationHandlers.Add(info);
                            info.DomainEvent?.Handlers.Add(info);
                        }
                    }
                }
            }
        }
    }

    /// The aggregate an application group belongs to: the domain directory of
    /// the same name anywhere in the module, or a model-group named after it.
    private static AggregateInfo AggregateFor(Module module, string group)
    {
        if (group == "") group = module.Name;
        return module.Aggregates.FirstOrDefault(a => a.DirName == group) ?? module.ModelGroup(group);
    }

    /// `IEventsBus.Publish(new X(...))` anywhere in the module's application
    /// layer publishes X; `ICommandsScheduler.EnqueueAsync(new C(...))` puts C
    /// on the module's internal queue.
    private static void ReadPublishing(Tree tree, Module module)
    {
        foreach (var syntaxTree in module.Application.Concat(module.Domain))
        {
            var model = tree.Model(syntaxTree);
            foreach (var invocation in syntaxTree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
            {
                var (name, receiver) = Calls.Resolve(tree, model, invocation);
                if (invocation.ArgumentList.Arguments.Count == 0) continue;
                var argument = model.GetTypeInfo(invocation.ArgumentList.Arguments[0].Expression).Type as INamedTypeSymbol;
                if (argument == null) continue;
                if (name == "Publish" && receiver == "IEventsBus" && tree.IntegrationEvents.TryGetValue(argument, out var integrationEvent))
                {
                    if (integrationEvent.Publisher != null && integrationEvent.Publisher != module)
                    {
                        tree.Out.Warn(tree.Line(invocation), $"{argument.Name} is published by {integrationEvent.Publisher.Name} and by {module.Name}; the first is kept as its publisher");
                        continue;
                    }
                    integrationEvent.Publisher = module;
                    integrationEvent.PublishSource = tree.Line(invocation);
                    var handler = module.NotificationHandlers.FirstOrDefault(h => h.Handler.DeclaringSyntaxReferences.Any(r => r.SyntaxTree == syntaxTree) && h.DomainEvent != null);
                    if (handler?.DomainEvent != null)
                    {
                        integrationEvent.From = handler.DomainEvent;
                        integrationEvent.Aggregate = handler.DomainEvent.Aggregate;
                    }
                    if (!module.Published.Contains(integrationEvent)) module.Published.Add(integrationEvent);
                }
                else if (name == "EnqueueAsync" && receiver == "ICommandsScheduler")
                {
                    if (!module.Enqueued.Contains(argument, SymbolEqualityComparer.Default)) module.Enqueued.Add(argument);
                    if (module.EnqueueSource == "") module.EnqueueSource = tree.Line(invocation);
                }
            }
        }
    }

    /// `SubscribeToIntegrationEvent<X>(...)` or `new IntegrationEventGenericHandler<X>()`
    /// in the module's infrastructure: the module hears X.
    private static void ReadSubscriptions(Tree tree, Module module)
    {
        foreach (var syntaxTree in module.Infrastructure)
        {
            var model = tree.Model(syntaxTree);
            foreach (var generic in syntaxTree.GetRoot().DescendantNodes().OfType<GenericNameSyntax>())
            {
                if (generic.Identifier.Text is not ("SubscribeToIntegrationEvent" or "IntegrationEventGenericHandler")) continue;
                if (generic.TypeArgumentList.Arguments.Count != 1) continue;
                if (model.GetTypeInfo(generic.TypeArgumentList.Arguments[0]).Type is not INamedTypeSymbol argument || argument.TypeKind == TypeKind.TypeParameter) continue;
                if (!tree.IntegrationEvents.ContainsKey(argument))
                {
                    if (Model.IsIntegrationEvent(argument)) tree.Out.Warn(tree.Line(generic), $"{module.Name} subscribes to {argument.Name}, which no module's IntegrationEvents declares");
                    continue;
                }
                if (!module.Subscribed.Contains(argument, SymbolEqualityComparer.Default)) module.Subscribed.Add(argument);
                if (module.SubscriptionSource == "") module.SubscriptionSource = tree.PathOf(generic);
            }
        }
    }

    /// Every integration event gets its publisher's aggregate, and every
    /// handler of one is held against the subscription that would reach it.
    private static void Link(Tree tree)
    {
        foreach (var module in tree.Modules)
        {
            foreach (var handler in module.NotificationHandlers)
            {
                if (handler.IntegrationEventType != null && tree.IntegrationEvents.TryGetValue(handler.IntegrationEventType, out var ie))
                {
                    handler.IntegrationEvent = ie;
                }
            }
        }
        foreach (var ie in tree.IntegrationEvents.Values.OrderBy(e => e.Type.Name, StringComparer.Ordinal))
        {
            if (ie.Publisher == null)
            {
                tree.Out.Warn(tree.Line(ie.Type), $"{ie.Type.Name} is declared and published nowhere; it is filed under {ie.Owner.Name}'s integration events");
            }
            if (ie.Aggregate == null)
            {
                var owner = ie.Publisher ?? ie.Owner;
                ie.Aggregate = owner.ModelGroup("IntegrationEvents");
                ie.Aggregate.Name = "Integration events";
            }
            ie.Aggregate.IntegrationEvents.Add(ie);
        }
        foreach (var module in tree.Modules)
        {
            foreach (var subscribed in module.Subscribed)
            {
                if (!module.NotificationHandlers.Any(h => SymbolEqualityComparer.Default.Equals(h.IntegrationEventType, subscribed)))
                {
                    tree.Out.Warn(module.SubscriptionSource, $"{module.Name} subscribes to {subscribed.Name} and has no handler for it");
                }
            }
            foreach (var handler in module.NotificationHandlers.Where(h => h.IntegrationEventType != null))
            {
                if (!module.Subscribed.Contains(handler.IntegrationEventType!, SymbolEqualityComparer.Default))
                {
                    tree.Out.Warn(tree.Line(handler.Handler), $"{handler.Handler.Name} handles {handler.IntegrationEventType!.Name}, which {module.Name} never subscribes to");
                }
            }
        }
    }
}

/// Reading a call: the method's name and the name of the type it is called
/// on, whether the method resolved or not.
public static class Calls
{
    public static (string Name, string Receiver) Resolve(Tree tree, SemanticModel model, InvocationExpressionSyntax invocation)
    {
        var method = Method(model, invocation);
        var name = method?.Name ?? invocation.Expression switch
        {
            MemberAccessExpressionSyntax ma => ma.Name.Identifier.Text,
            IdentifierNameSyntax id => id.Identifier.Text,
            GenericNameSyntax g => g.Identifier.Text,
            MemberBindingExpressionSyntax mb => mb.Name.Identifier.Text,
            _ => "",
        };
        var receiver = method?.ContainingType?.Name ?? "";
        if (receiver == "" && invocation.Expression is MemberAccessExpressionSyntax access)
        {
            receiver = model.GetTypeInfo(access.Expression).Type?.Name ?? "";
        }
        return (name, receiver);
    }

    public static IMethodSymbol? Method(SemanticModel model, InvocationExpressionSyntax invocation)
    {
        var info = model.GetSymbolInfo(invocation);
        return info.Symbol as IMethodSymbol ?? info.CandidateSymbols.OfType<IMethodSymbol>().FirstOrDefault();
    }
}
