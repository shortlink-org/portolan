// The run: read the tree in passes, then write the fragment, the store
// fragment and one OpenAPI document per module with controllers.

using Microsoft.CodeAnalysis;

namespace Portolan.Extract.CSharp;

public static class Extract
{
    public static Builder Run(string cwd, Request request)
    {
        var output = new Builder();
        var options = Options.From(request.Options);
        var tree = new Tree(cwd, request.Input, options, output);
        Model.Read(tree);
        Application.Read(tree);
        Transport.Read(tree);
        Stores.Read(tree);
        var flows = Flows.Read(tree);
        LooseGroups(tree);

        var outputDir = request.Input.Output.Replace('\\', '/').TrimEnd('/');
        var catalog = new Catalog { Flows = flows };
        var storesCatalog = new Catalog();
        var stores = new List<Store>();
        foreach (var module in tree.Modules)
        {
            var service = new Service
            {
                Id = module.ServiceId,
                Slug = "module",
                Name = module.ServiceName,
                Repo = options.Repo,
                Path = tree.Rel(module.Dir),
                Readme = "",
            };
            if (module.Controllers.Count > 0)
            {
                var name = options.OpenapiOut.Replace("{service}", module.Slug);
                output.File(name, Transport.OpenApi(tree, module));
                service.Provides = Transport.Provides(tree, module, outputDir == "" ? name : outputDir + "/" + name);
            }
            foreach (var aggregate in module.Aggregates.OrderBy(a => a.Slug, StringComparer.Ordinal))
            {
                var built = BuildAggregate(tree, aggregate);
                if (built != null) service.Aggregates.Add(built);
            }
            var channels = Channels(tree, module);
            if (channels.Count > 0) service.Channels = channels;
            if (module.Stores.Count > 0) service.Stores = module.Stores.Select(s => s.Store.Id).ToList();

            var context = new Context
            {
                Id = module.ContextId,
                Slug = module.ContextId,
                Name = Names.Title(module.Name),
                Summary = "",
                Classification = options.Classification,
                Services = { service },
            };
            catalog.Contexts.Add(context);

            if (module.Stores.Count > 0)
            {
                storesCatalog.Contexts.Add(new Context
                {
                    Id = module.ContextId,
                    Slug = module.ContextId,
                    Services =
                    {
                        new Service { Id = module.ServiceId, Slug = "module", Stores = module.Stores.Select(s => s.Store.Id).ToList() },
                    },
                });
                stores.AddRange(module.Stores.Select(s => s.Store));
            }
        }
        output.File(options.Out, Json.Pretty(catalog));
        if (stores.Count > 0)
        {
            storesCatalog.Stores = stores;
            output.File(options.StoresOut, Json.Pretty(storesCatalog));
        }
        return output;
    }

    private static void LooseGroups(Tree tree)
    {
        foreach (var module in tree.Modules)
        {
            foreach (var (name, types) in module.LooseGroups.OrderBy(kv => kv.Key, StringComparer.Ordinal))
            {
                var dir = Path.Combine(module.Dir, "Domain", name);
                tree.Out.Warn(tree.Rel(dir), $"Domain/{name} has no aggregate root and no application group of its name; {types.Count} {(types.Count == 1 ? "type" : "types")} ({string.Join(", ", types.Select(t => t.Name).Take(4))}{(types.Count > 4 ? ", …" : "")}) {(types.Count == 1 ? "is" : "are")} read nowhere");
            }
        }
    }

    private static Aggregate? BuildAggregate(Tree tree, AggregateInfo info)
    {
        var aggregate = new Aggregate
        {
            Id = info.Id,
            Slug = info.Slug,
            Name = info.Name,
            Readme = "",
            Kind = info.ModelGroup ? "model-group" : null,
            Root = info.Root?.Name ?? "",
        };
        foreach (var entity in info.Entities.Take(1).Concat(info.Entities.Skip(1).OrderBy(e => e.Name, StringComparer.Ordinal)))
        {
            aggregate.Entities.Add(new Block
            {
                Id = info.BlockId(entity),
                Slug = Names.Kebab(entity.Name),
                Name = entity.Name,
                Doc = tree.Doc(entity),
                Fields = Model.Fields(tree, entity),
            });
        }
        foreach (var vo in info.ValueObjects.OrderBy(v => v.Name, StringComparer.Ordinal))
        {
            var fields = Model.Fields(tree, vo);
            if (fields.Count == 0)
            {
                tree.Out.Warn(tree.Line(vo), $"{vo.Name} is a value object with no fields; it is not written");
                continue;
            }
            aggregate.ValueObjects.Add(new Block
            {
                Id = info.BlockId(vo),
                Slug = Names.Kebab(vo.Name),
                Name = vo.Name,
                Doc = tree.Doc(vo),
                Fields = fields,
            });
        }
        foreach (var handler in info.Operations.OrderBy(h => h.OpId, StringComparer.Ordinal).ThenBy(h => h.Kind, StringComparer.Ordinal))
        {
            var doc = tree.Doc(handler.Handler);
            if (doc == "") doc = tree.Doc(handler.Message);
            aggregate.Operations.Add(new Operation
            {
                Id = handler.OpId,
                Kind = handler.Kind,
                Doc = doc,
                ExposedBy = handler.ExposedBy.Count > 0 ? handler.ExposedBy.OrderBy(e => e, StringComparer.Ordinal).ToList() : null,
                Fields = Model.MessageFields(tree, handler.Message),
                Source = tree.Line(handler.Handle),
            });
        }
        foreach (var eventType in info.Events.OrderBy(e => e.Name, StringComparer.Ordinal))
        {
            var domainEvent = tree.DomainEvents[eventType];
            var consumers = domainEvent.Handlers
                .OrderBy(h => h.Handler.Name, StringComparer.Ordinal)
                .Select(h => new EventConsumer { Service = h.Module.ServiceId, Status = "declared", Note = h.Handler.Name })
                .ToList();
            aggregate.Events.Add(new Event
            {
                Id = domainEvent.Id,
                Slug = Names.Kebab(eventType.Name),
                Name = eventType.Name,
                Versions = { new EventVersion { Version = "v1", Doc = tree.Doc(eventType), Source = tree.PathOf(eventType), Fields = Model.EventFields(tree, eventType) } },
                Consumers = consumers,
            });
        }
        foreach (var ie in info.IntegrationEvents.OrderBy(e => e.Type.Name, StringComparer.Ordinal))
        {
            var consumers = new List<EventConsumer>();
            foreach (var module in tree.Modules)
            {
                var subscribed = module.Subscribed.Contains(ie.Type, SymbolEqualityComparer.Default);
                var handlers = module.NotificationHandlers.Where(h => h.IntegrationEvent == ie).OrderBy(h => h.Handler.Name, StringComparer.Ordinal).ToList();
                if (!subscribed && handlers.Count == 0) continue;
                if (handlers.Count == 0)
                {
                    consumers.Add(new EventConsumer { Service = module.ServiceId, Status = "unresolved", Note = "subscribed, and no handler" });
                    continue;
                }
                foreach (var handler in handlers)
                {
                    consumers.Add(new EventConsumer
                    {
                        Service = module.ServiceId,
                        Status = subscribed ? "declared" : "unresolved",
                        Note = subscribed ? handler.Handler.Name : handler.Handler.Name + ", never subscribed",
                    });
                }
            }
            aggregate.Events.Add(new Event
            {
                Id = ie.Id,
                Slug = Names.Kebab(ie.Type.Name),
                Name = ie.Type.Name,
                Versions = { new EventVersion { Version = "v1", Doc = tree.Doc(ie.Type), Source = tree.PathOf(ie.Type), Fields = Model.EventFields(tree, ie.Type) } },
                Consumers = consumers,
                Wire = new Wire { Name = ie.Type.Name, Channel = BusAddress(tree, ie.Type) },
            });
        }
        var enums = info.Enums.OrderBy(e => e.Name, StringComparer.Ordinal).Select(e => Model.ReadEnum(tree, info, e)).ToList();
        if (enums.Count > 0) aggregate.Enums = enums;

        if (info.ModelGroup && aggregate.Entities.Count == 0 && aggregate.ValueObjects.Count == 0 && aggregate.Operations.Count == 0 && aggregate.Events.Count == 0 && enums.Count == 0)
        {
            return null;
        }
        return aggregate;
    }

    public static string BusAddress(Tree tree, INamedTypeSymbol eventType) => $"{tree.Options.Bus}.{eventType.Name}";

    private static Channel BusChannel(Tree tree, INamedTypeSymbol eventType, string direction, string source) => new()
    {
        Address = BusAddress(tree, eventType),
        Kind = "event",
        Title = "Bus · " + Names.Sentence(Names.Strip(eventType.Name, "IntegrationEvent")),
        Doc = "One integration event on the in-memory events bus: the bus routes by type, so each event is a channel with the module that publishes it and the modules that subscribe. One process, no broker.",
        Messages = { new ChannelMessage { Name = eventType.Name, Title = Names.Sentence(Names.Strip(eventType.Name, "IntegrationEvent")), Doc = tree.Doc(eventType), Direction = direction } },
        Source = source,
    };

    /// The bus has no named channels: `InMemoryEventBus` routes by type, a
    /// module subscribes to a type, and so each integration event is a
    /// channel of its own, `<bus>.<Event>`, with one publisher and its
    /// subscribers - which is what a channel is.
    private static List<Channel> Channels(Tree tree, Module module)
    {
        var channels = new List<Channel>();
        foreach (var ie in module.Published.OrderBy(e => e.Type.Name, StringComparer.Ordinal))
        {
            channels.Add(BusChannel(tree, ie.Type, "send", ie.PublishSource.Split(':')[0]));
        }
        foreach (var type in module.Subscribed.OrderBy(t => t.Name, StringComparer.Ordinal))
        {
            if (module.Published.Any(p => SymbolEqualityComparer.Default.Equals(p.Type, type))) continue;
            channels.Add(BusChannel(tree, type, "receive", module.SubscriptionSource));
        }
        var jobs = new List<ChannelMessage>();
        foreach (var command in module.Enqueued.OrderBy(t => t.Name, StringComparer.Ordinal))
        {
            var title = Names.Sentence(Names.Strip(command.Name, "Command"));
            jobs.Add(new ChannelMessage { Name = command.Name, Title = title, Doc = tree.Doc(command), Direction = "send" });
            if (tree.HandlerByMessage.TryGetValue(command, out var handler) && handler.Module == module)
            {
                jobs.Add(new ChannelMessage { Name = command.Name, Title = title, Doc = tree.Doc(command), Direction = "receive" });
            }
            else
            {
                tree.Out.Warn(module.EnqueueSource, $"{module.Name} enqueues {command.Name}, which no handler in the module takes");
            }
        }
        if (jobs.Count > 0)
        {
            channels.Add(new Channel
            {
                Address = $"{module.Slug}.internal-commands",
                Kind = "job",
                Title = "Internal commands · " + Names.Title(module.Name),
                Doc = "The module's own queue: a command written to its InternalCommands table in the same transaction as the change that asked for it, read by the ProcessInternalCommands job and handed to its handler.",
                Messages = jobs,
                Source = module.EnqueueSource.Split(':')[0],
            });
        }
        return channels;
    }
}
