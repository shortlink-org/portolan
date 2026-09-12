// Flows: one per controller action, one per handler of a domain event, one
// per subscription to an integration event, one per internal command, one per
// recurring command. Each follows the handler's Handle body through the
// classes it holds and the domain methods it calls, by symbol: a call on a
// port is a step to the store, `AddDomainEvent(...)` an event raised in
// process, `IEventsBus.Publish(...)` an event on the bus,
// `ICommandsScheduler.EnqueueAsync(...)` a job on the module's internal queue,
// and a command handed to another module's facade a call across the boundary.

using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Portolan.Extract.CSharp;

public static class Flows
{
    private const int MaxDepth = 8;

    public static List<Flow> Read(Tree tree)
    {
        var flows = new List<Flow>();
        foreach (var module in tree.Modules)
        {
            foreach (var controller in module.Controllers)
            {
                foreach (var action in controller.Actions.OrderBy(a => a.Path, StringComparer.Ordinal).ThenBy(a => a.HttpMethod, StringComparer.Ordinal))
                {
                    flows.Add(Http(tree, action));
                }
            }
            foreach (var handler in module.NotificationHandlers.Where(h => h.DomainEvent != null).OrderBy(h => h.Handler.Name, StringComparer.Ordinal))
            {
                flows.Add(OnDomainEvent(tree, handler));
            }
            foreach (var handler in module.NotificationHandlers.Where(h => h.IntegrationEvent != null).OrderBy(h => h.Handler.Name, StringComparer.Ordinal))
            {
                flows.Add(OnIntegrationEvent(tree, handler));
            }
            foreach (var handler in module.Handlers.Where(h => h.Internal && !h.Recurring).OrderBy(h => h.OpId, StringComparer.Ordinal))
            {
                flows.Add(Job(tree, handler));
            }
            foreach (var handler in module.Handlers.Where(h => h.Recurring).OrderBy(h => h.OpId, StringComparer.Ordinal))
            {
                flows.Add(Scheduled(tree, handler));
            }
        }
        var slugs = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var flow in flows)
        {
            if (slugs.TryGetValue(flow.Slug, out var n))
            {
                slugs[flow.Slug] = n + 1;
                flow.Slug = $"{flow.Slug}-{n + 1}";
            }
            else slugs[flow.Slug] = 1;
            flow.Id = "flow." + flow.Slug;
        }
        return flows;
    }

    private static Flow Http(Tree tree, ActionInfo action)
    {
        var module = action.Controller.Module;
        var b = new FlowBuilder(tree, new Flow
        {
            Slug = $"{module.Slug}-{action.Controller.Slug}-{Names.Kebab(action.Method.Name)}",
            Name = Names.Sentence(action.Method.Name),
            Source = tree.PathOf(action.Syntax),
            Owner = module.ContextId,
            Trigger = new Trigger { Kind = "http", Label = $"{action.HttpMethod} {action.Path}", Confidence = "high" },
        });
        var client = b.Client();
        var service = b.Service(module);
        b.Add(new Step
        {
            From = client,
            To = service,
            Kind = "rpc",
            Label = $"{action.HttpMethod} {action.Path}",
            Ref = $"{action.Controller.RpcId}/{action.OperationId}",
            Line = tree.Line(action.Syntax),
        });
        foreach (var message in action.Dispatches)
        {
            var handler = tree.HandlerByMessage[message];
            if (handler.Module != module)
            {
                b.Add(new Step
                {
                    From = service,
                    To = b.Service(handler.Module),
                    Kind = "call",
                    Label = $"{handler.Module.Name} module: {message.Name}",
                    Ref = handler.Ref,
                    Note = "in process, through the module's facade; a boundary all the same",
                    Line = tree.Line(action.Syntax),
                });
            }
            b.Follow(handler.Module, handler.Handle, 1);
        }
        return b.Flow;
    }

    private static Flow OnDomainEvent(Tree tree, NotificationHandlerInfo handler)
    {
        var module = handler.Module;
        var domainEvent = handler.DomainEvent!;
        var b = new FlowBuilder(tree, new Flow
        {
            Slug = $"{module.Slug}-{Names.Kebab(handler.Handler.Name)}",
            Name = Names.Sentence(handler.Handler.Name),
            Source = tree.PathOf(handler.Handler),
            Owner = module.ContextId,
            Trigger = new Trigger { Kind = "event", Label = domainEvent.Type.Name, Confidence = "high" },
        });
        var service = b.Service(module);
        b.Add(new Step
        {
            From = service,
            To = service,
            Kind = "event",
            Label = domainEvent.Type.Name,
            Ref = domainEvent.Id,
            Note = handler.ViaNotification
                ? "heard as a notification after the unit of work commits, replayed from the outbox"
                : "heard in the same transaction, as a MediatR notification",
            Line = tree.Line(handler.Handle),
        });
        b.Follow(module, handler.Handle, 1);
        return b.Flow;
    }

    private static Flow OnIntegrationEvent(Tree tree, NotificationHandlerInfo handler)
    {
        var module = handler.Module;
        var ie = handler.IntegrationEvent!;
        var b = new FlowBuilder(tree, new Flow
        {
            Slug = $"{module.Slug}-{Names.Kebab(handler.Handler.Name)}",
            Name = Names.Sentence(handler.Handler.Name),
            Source = tree.PathOf(handler.Handler),
            Owner = module.ContextId,
            Trigger = new Trigger { Kind = "message", Label = ie.Type.Name, Confidence = "high" },
        });
        var service = b.Service(module);
        b.Add(new Step
        {
            From = b.Bus(),
            To = service,
            Kind = "event",
            Label = ie.Type.Name,
            Ref = ie.Id,
            Line = tree.Line(handler.Handle),
            Handoff = new Handoff { Kind = "message", Transport = "in-memory", Channel = Extract.BusAddress(tree, ie.Type), Message = ie.Type.Name, Direction = "receive" },
        });
        b.Follow(module, handler.Handle, 1);
        return b.Flow;
    }

    private static Flow Job(Tree tree, HandlerInfo handler)
    {
        var module = handler.Module;
        var b = new FlowBuilder(tree, new Flow
        {
            Slug = $"{module.Slug}-{handler.OpId}-job",
            Name = Names.Sentence(Names.Strip(handler.Message.Name, "Command")) + " (job)",
            Source = tree.PathOf(handler.Handler),
            Owner = module.ContextId,
            Trigger = new Trigger { Kind = "job", Label = handler.Message.Name, Confidence = "high" },
        });
        var service = b.Service(module);
        b.Add(new Step
        {
            From = b.Jobs(module),
            To = service,
            Kind = "call",
            Label = $"dequeue {handler.Message.Name}",
            Ref = handler.Ref,
            Note = "the ProcessInternalCommands job reads the row and hands the command to its handler",
            Line = tree.Line(handler.Handle),
            Handoff = new Handoff { Kind = "job", Transport = "internal-commands", Channel = $"{module.Slug}.internal-commands", Message = handler.Message.Name, Direction = "receive" },
        });
        b.Follow(module, handler.Handle, 1);
        return b.Flow;
    }

    private static Flow Scheduled(Tree tree, HandlerInfo handler)
    {
        var module = handler.Module;
        var b = new FlowBuilder(tree, new Flow
        {
            Slug = $"{module.Slug}-{handler.OpId}-scheduled",
            Name = Names.Sentence(Names.Strip(handler.Message.Name, "Command")) + " (scheduled)",
            Source = tree.PathOf(handler.Handler),
            Owner = module.ContextId,
            Trigger = new Trigger { Kind = "scheduled", Label = handler.Message.Name, Confidence = "medium" },
        });
        var service = b.Service(module);
        b.Add(new Step
        {
            From = service,
            To = service,
            Kind = "call",
            Label = handler.Message.Name,
            Ref = handler.Ref,
            Note = "a recurring command: a Quartz job in the module's infrastructure runs it on a schedule",
            Line = tree.Line(handler.Handle),
        });
        b.Follow(module, handler.Handle, 1);
        return b.Flow;
    }
}

public sealed class FlowBuilder
{
    private readonly Tree tree;
    private readonly HashSet<IMethodSymbol> visited = new(SymbolEqualityComparer.Default);
    private readonly HashSet<IMethodSymbol> dapperDone = new(SymbolEqualityComparer.Default);
    public Flow Flow { get; }

    public FlowBuilder(Tree tree, Flow flow)
    {
        this.tree = tree;
        Flow = flow;
    }

    private string Participant(string id, string kind, string? context, string? label = null)
    {
        if (Flow.Participants.All(p => p.Id != id))
        {
            Flow.Participants.Add(new Participant { Id = id, Kind = kind, Context = context, Label = label });
        }
        return id;
    }

    public string Client() => Participant("client", "actor", null);
    public string Service(Module module) => Participant(module.ServiceId, "service", module.ContextId);
    public string Store(StoreInfo store) => Participant(store.Store.Id.Replace('.', '-'), "store", store.Module.ContextId);
    public string Bus() => Participant(tree.Options.Bus, "broker", null, "Bus · " + tree.Options.Bus);
    public string Jobs(Module module) => Participant(module.Slug + "-internal-commands", "broker", null, "Internal commands · " + Names.Title(module.Name));

    public void Add(Step step)
    {
        var last = Flow.Steps.LastOrDefault();
        if (last != null && last.From == step.From && last.To == step.To && last.Kind == step.Kind && last.Label == step.Label && last.Ref == step.Ref) return;
        step.Id = $"s{Flow.Steps.Count + 1}";
        Flow.Steps.Add(step);
    }

    /// Walks a method body in source order and reads each call for what it is.
    public void Follow(Module module, IMethodSymbol method, int depth)
    {
        if (depth > Flows_MaxDepth || !visited.Add(method)) return;
        var reference = method.DeclaringSyntaxReferences.FirstOrDefault();
        if (reference == null) return;
        var node = reference.GetSyntax();
        SyntaxNode? body = node switch
        {
            MethodDeclarationSyntax m => (SyntaxNode?)m.Body ?? m.ExpressionBody,
            ConstructorDeclarationSyntax c => (SyntaxNode?)c.Body ?? c.ExpressionBody,
            LocalFunctionStatementSyntax l => (SyntaxNode?)l.Body ?? l.ExpressionBody,
            AccessorDeclarationSyntax a => (SyntaxNode?)a.Body ?? a.ExpressionBody,
            _ => null,
        };
        if (body == null) return;
        var model = tree.Model(node.SyntaxTree);
        var service = Service(module);
        foreach (var n in body.DescendantNodes())
        {
            switch (n)
            {
                case InvocationExpressionSyntax invocation:
                    Invocation(module, service, model, invocation, depth);
                    break;
                case BaseObjectCreationExpressionSyntax creation:
                {
                    if (model.GetTypeInfo(creation).Type is INamedTypeSymbol created && tree.AggregateOfType.ContainsKey(created)
                        && model.GetSymbolInfo(creation).Symbol is IMethodSymbol ctor && ctor.DeclaringSyntaxReferences.Length > 0)
                    {
                        Follow(module, ctor, depth + 1);
                    }
                    break;
                }
            }
        }
    }

    private const int Flows_MaxDepth = 8;

    private void Invocation(Module module, string service, SemanticModel model, InvocationExpressionSyntax invocation, int depth)
    {
        var method = Calls.Method(model, invocation);
        var (name, receiver) = Calls.Resolve(tree, model, invocation);
        var arguments = invocation.ArgumentList.Arguments;
        INamedTypeSymbol? FirstArgumentType() => arguments.Count > 0 ? model.GetTypeInfo(arguments[0].Expression).Type as INamedTypeSymbol : null;

        // A domain event, raised in process.
        if (name == "AddDomainEvent" && arguments.Count == 1)
        {
            if (FirstArgumentType() is { } eventType && tree.DomainEvents.TryGetValue(eventType, out var domainEvent))
            {
                Add(new Step
                {
                    From = service,
                    To = service,
                    Kind = "event",
                    Label = eventType.Name,
                    Ref = domainEvent.Id,
                    Note = "raised in process: a MediatR notification in the same transaction, and a notification from the outbox after it commits",
                    Line = tree.Line(invocation),
                });
            }
            return;
        }

        // An integration event, on the bus.
        if (name == "Publish" && receiver == "IEventsBus")
        {
            if (FirstArgumentType() is { } eventType && tree.IntegrationEvents.TryGetValue(eventType, out var ie))
            {
                Add(new Step
                {
                    From = service,
                    To = Bus(),
                    Kind = "event",
                    Label = eventType.Name,
                    Ref = ie.Id,
                    Line = tree.Line(invocation),
                    Handoff = new Handoff { Kind = "message", Transport = "in-memory", Channel = Extract.BusAddress(tree, eventType), Message = eventType.Name, Direction = "send" },
                });
            }
            return;
        }

        // A command on the module's own internal queue.
        if (name == "EnqueueAsync" && receiver == "ICommandsScheduler")
        {
            if (FirstArgumentType() is { } command)
            {
                tree.HandlerByMessage.TryGetValue(command, out var handler);
                Add(new Step
                {
                    From = service,
                    To = Jobs(module),
                    Kind = "call",
                    Label = $"enqueue {command.Name}",
                    Note = handler?.Module == module
                        ? $"a row in InternalCommands, in the same transaction; a Quartz job picks it up and runs {handler.OpId}"
                        : "a row in InternalCommands, in the same transaction; a Quartz job picks it up",
                    Line = tree.Line(invocation),
                    Handoff = new Handoff { Kind = "job", Transport = "internal-commands", Channel = $"{module.Slug}.internal-commands", Message = command.Name, Direction = "send" },
                });
            }
            return;
        }

        // A command or query handed to a module facade or the mediator.
        if ((name is "ExecuteCommandAsync" or "ExecuteQueryAsync" && receiver.EndsWith("Module", StringComparison.Ordinal)) || (name == "Send" && receiver is "IMediator" or "Mediator" or "ISender"))
        {
            if (FirstArgumentType() is { } message && tree.HandlerByMessage.TryGetValue(message, out var handler))
            {
                if (handler.Module != module)
                {
                    Add(new Step
                    {
                        From = service,
                        To = Service(handler.Module),
                        Kind = "call",
                        Label = $"{handler.Module.Name} module: {message.Name}",
                        Ref = handler.Ref,
                        Note = "in process, through the module's facade; a boundary all the same",
                        Line = tree.Line(invocation),
                    });
                }
                Follow(handler.Module, handler.Handle, depth + 1);
            }
            return;
        }

        // A port: the far end is the store. An event store, `IAggregateStore`,
        // is the module's own.
        if (method?.ContainingType is { } portType && (tree.PortAggregate.ContainsKey(portType.OriginalDefinition) || portType.Name == "IAggregateStore"))
        {
            var store = tree.PortAggregate.TryGetValue(portType.OriginalDefinition, out var aggregate) ? aggregate.Module.Store : module.Store;
            if (store != null)
            {
                Add(new Step
                {
                    From = service,
                    To = Store(store),
                    Kind = "call",
                    Label = $"{portType.Name}.{name}",
                    Line = tree.Line(invocation),
                    StoreAccess = new StoreAccess { Store = store.Store.Id, Method = $"{portType.Name}.{name}" },
                });
            }
            return;
        }

        // Dapper: the SQL in the enclosing method says which tables.
        if (name.StartsWith("Query", StringComparison.Ordinal) || name.StartsWith("Execute", StringComparison.Ordinal))
        {
            var enclosing = invocation.Ancestors().OfType<MethodDeclarationSyntax>().FirstOrDefault();
            if (enclosing != null && model.GetDeclaredSymbol(enclosing) is IMethodSymbol enclosingSymbol && tree.DapperByMethod.TryGetValue(enclosingSymbol, out var accesses) && dapperDone.Add(enclosingSymbol))
            {
                foreach (var access in accesses)
                {
                    Add(new Step
                    {
                        From = service,
                        To = Store(access.Store),
                        Kind = "call",
                        Label = $"{access.Operation} {access.Target}",
                        Line = tree.Line(invocation),
                        StoreAccess = new StoreAccess { Store = access.Store.Store.Id, Method = $"{enclosingSymbol.ContainingType.Name}.{enclosingSymbol.Name}" },
                    });
                }
            }
            return;
        }

        // Into the module's own code: a domain method, a factory, a helper.
        if (method != null && method.DeclaringSyntaxReferences.Length > 0 && method.ContainingType != null)
        {
            var owner = tree.ModuleOf(method.ContainingType);
            if (owner == module)
            {
                var path = method.DeclaringSyntaxReferences[0].SyntaxTree.FilePath;
                if (path.Contains("/Infrastructure/", StringComparison.Ordinal)) return;
                Follow(module, method, depth + 1);
            }
            return;
        }

        // The call did not bind - the receiver came out of a Dapper query or
        // another unreferenced package, so its type is an error - but the
        // name may still say which domain method it is: when exactly one
        // type of the module's model declares an instance method of that
        // name and arity, it is followed by name, the way extract-ts
        // resolves what its parser cannot.
        if (method == null && name != "" && invocation.Expression is MemberAccessExpressionSyntax)
        {
            var candidates = tree.AggregateOfType
                .Where(kv => kv.Value.Module == module)
                .Select(kv => kv.Key)
                .Distinct(SymbolEqualityComparer.Default)
                .Cast<INamedTypeSymbol>()
                .SelectMany(t => t.GetMembers(name).OfType<IMethodSymbol>())
                .Where(m => !m.IsStatic && m.MethodKind == MethodKind.Ordinary && m.Parameters.Length == arguments.Count && m.DeclaringSyntaxReferences.Length > 0)
                .ToList();
            if (candidates.Count == 1) Follow(module, candidates[0], depth + 1);
        }
    }
}
