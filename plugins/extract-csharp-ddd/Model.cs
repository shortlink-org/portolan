// The domain layer, read by what a class extends: `IAggregateRoot` or an
// `AggregateRoot` base makes a root, `Entity` an entity, `ValueObject`,
// `TypedIdValueBase` and `AggregateId` a value object, `DomainEventBase` or
// `IDomainEvent` an event, an `I*Repository` interface a port. The directory
// a root sits in is the aggregate; a directory with no root is a group the
// application layer may claim.

using Microsoft.CodeAnalysis;

namespace Portolan.Extract.CSharp;

public sealed class AggregateInfo
{
    public Module Module { get; }
    public string DirName { get; }
    public string Dir { get; set; } = "";
    public string Slug { get; }
    public string Name { get; set; }
    public bool ModelGroup { get; }
    public INamedTypeSymbol? Root { get; }
    public List<INamedTypeSymbol> Entities { get; } = new();
    public List<INamedTypeSymbol> ValueObjects { get; } = new();
    public List<INamedTypeSymbol> Events { get; } = new();
    public List<INamedTypeSymbol> Enums { get; } = new();
    public List<INamedTypeSymbol> Ports { get; } = new();
    public List<HandlerInfo> Operations { get; } = new();
    public List<IntegrationEventInfo> IntegrationEvents { get; } = new();

    public string Id => Module.ServiceId + "." + Slug;

    public AggregateInfo(Module module, string dirName, string slug, string name, INamedTypeSymbol? root, bool modelGroup)
    {
        Module = module;
        DirName = dirName;
        Slug = slug;
        Name = name;
        Root = root;
        ModelGroup = modelGroup;
    }

    public string BlockId(INamedTypeSymbol type) => Id + "." + Names.Kebab(type.Name);
}

public sealed class DomainEventInfo
{
    public INamedTypeSymbol Type { get; }
    public AggregateInfo Aggregate { get; }
    public List<NotificationHandlerInfo> Handlers { get; } = new();
    public string Id => Aggregate.Id + "." + Type.Name;

    public DomainEventInfo(INamedTypeSymbol type, AggregateInfo aggregate)
    {
        Type = type;
        Aggregate = aggregate;
    }
}

public static class Model
{
    private static readonly HashSet<string> SkippedDirs = new(StringComparer.OrdinalIgnoreCase)
    {
        "SharedKernel", "SeedWork", "Shared", "Rules", "Events", "Exceptions", "Specifications",
    };

    public static void Read(Tree tree)
    {
        foreach (var module in tree.Modules) ReadModule(tree, module);
    }

    private static void ReadModule(Tree tree, Module module)
    {
        var domainDir = Path.Combine(module.Dir, "Domain");
        if (!Directory.Exists(domainDir)) return;
        foreach (var dir in Directory.GetDirectories(domainDir).OrderBy(d => d, StringComparer.Ordinal))
        {
            if (SkippedDirs.Contains(Path.GetFileName(dir))) continue;
            Collect(tree, module, dir);
        }
    }

    private static List<INamedTypeSymbol> TypesUnder(Tree tree, Module module, string dir, bool recursive)
    {
        var prefix = dir + "/";
        var types = new List<INamedTypeSymbol>();
        foreach (var syntaxTree in module.Domain)
        {
            if (!syntaxTree.FilePath.StartsWith(prefix, StringComparison.Ordinal)) continue;
            if (!recursive && Path.GetDirectoryName(syntaxTree.FilePath) != dir) continue;
            types.AddRange(tree.TypesIn(syntaxTree));
        }
        return types;
    }

    /// A directory whose own files declare a root is an aggregate, with every
    /// subdirectory that declares no root of its own folded in - `Events/`,
    /// `Rules/`. A subdirectory with a root is an aggregate in its own right,
    /// `Members/MemberSubscriptions`.
    private static void Collect(Tree tree, Module module, string dir)
    {
        var own = TypesUnder(tree, module, dir, recursive: false);
        var subdirs = Directory.GetDirectories(dir).OrderBy(d => d, StringComparer.Ordinal).ToList();
        var nested = subdirs.Where(d => TypesUnder(tree, module, d, recursive: true).Any(t => IsRoot(tree, t))).ToList();
        var types = new List<INamedTypeSymbol>(own);
        foreach (var attached in subdirs.Except(nested)) types.AddRange(TypesUnder(tree, module, attached, recursive: true));

        var roots = types.Where(t => IsRoot(tree, t)).OrderBy(t => t.Name, StringComparer.Ordinal).ToList();
        var dirName = Path.GetFileName(dir);
        if (roots.Count == 0)
        {
            if (types.Count > 0) module.LooseGroups[dirName] = types;
        }
        else
        {
            if (roots.Count > 1)
            {
                tree.Out.Warn(tree.Rel(dir), $"{roots.Count} aggregate roots in one directory ({string.Join(", ", roots.Select(r => r.Name))}); {roots[0].Name} is read as the root and the others as entities");
            }
            var root = roots[0];
            var aggregate = new AggregateInfo(module, dirName, Names.Kebab(dirName), root.Name, root, modelGroup: false) { Dir = tree.Rel(dir) };
            foreach (var type in types) Classify(tree, aggregate, type);
            module.Aggregates.Add(aggregate);
        }
        foreach (var sub in nested) Collect(tree, module, sub);
    }

    /// Files one type at a time into what the aggregate holds.
    public static void Classify(Tree tree, AggregateInfo aggregate, INamedTypeSymbol type)
    {
        if (type.TypeKind == TypeKind.Enum)
        {
            aggregate.Enums.Add(type);
            return;
        }
        if (type.TypeKind == TypeKind.Interface)
        {
            if (IsPort(type))
            {
                aggregate.Ports.Add(type);
                tree.PortAggregate[type] = aggregate;
            }
            return;
        }
        if (type.TypeKind != TypeKind.Class) return;
        if (IsRoot(tree, type) || IsEntity(type))
        {
            if (SymbolEqualityComparer.Default.Equals(type, aggregate.Root)) aggregate.Entities.Insert(0, type);
            else if (!type.IsAbstract) aggregate.Entities.Add(type);
            tree.AggregateOfType[type] = aggregate;
        }
        else if (IsDomainEvent(tree, type))
        {
            if (type.IsAbstract) return;
            aggregate.Events.Add(type);
            tree.DomainEvents[type] = new DomainEventInfo(type, aggregate);
        }
        else if (IsValueObject(type))
        {
            if (type.IsAbstract) return;
            aggregate.ValueObjects.Add(type);
            tree.AggregateOfType[type] = aggregate;
        }
    }

    public static bool IsRoot(Tree tree, INamedTypeSymbol type) =>
        type.TypeKind == TypeKind.Class && !type.IsAbstract && (tree.Implements(type, "IAggregateRoot") || Tree.Derives(type, "AggregateRoot"));

    public static bool IsEntity(INamedTypeSymbol type) => type.TypeKind == TypeKind.Class && Tree.Derives(type, "Entity");

    public static bool IsValueObject(INamedTypeSymbol type) =>
        type.TypeKind == TypeKind.Class && Tree.Derives(type, "ValueObject", "TypedIdValueBase", "AggregateId");

    public static bool IsDomainEvent(Tree tree, INamedTypeSymbol type) =>
        type.TypeKind == TypeKind.Class && (Tree.Derives(type, "DomainEventBase") || tree.Implements(type, "IDomainEvent"));

    public static bool IsIntegrationEvent(INamedTypeSymbol type) =>
        type.TypeKind == TypeKind.Class && !type.IsAbstract && Tree.Derives(type, "IntegrationEvent");

    public static bool IsPort(INamedTypeSymbol type) =>
        type.TypeKind == TypeKind.Interface && ((type.Name.StartsWith('I') && type.Name.EndsWith("Repository", StringComparison.Ordinal)) || type.Name == "IAggregateStore");

    private static readonly HashSet<string> FrameworkBases = new(StringComparer.Ordinal)
    {
        "Entity", "ValueObject", "DomainEventBase", "IntegrationEvent", "Object",
    };

    /// What an entity or value object holds: the public properties it
    /// inherits from a base that is not the framework's, then its own
    /// members in source order, a private field `_title` read as `title`.
    public static List<Field> Fields(Tree tree, INamedTypeSymbol type)
    {
        var fields = new List<Field>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        void Add(string name, ITypeSymbol fieldType, ISymbol symbol)
        {
            var key = Names.Camel(name);
            if (!seen.Add(key)) return;
            fields.Add(new Field { Name = key, Type = Tree.TypeName(fieldType), Doc = tree.Doc(symbol) });
        }
        foreach (var b in Tree.Bases(type).Reverse())
        {
            if (FrameworkBases.Contains(b.Name)) continue;
            foreach (var member in b.GetMembers().OfType<IPropertySymbol>())
            {
                if (member.IsStatic || member.DeclaredAccessibility != Accessibility.Public || member.IsIndexer) continue;
                if (member.Name == "DomainEvents") continue;
                Add(member.Name, member.Type, member);
            }
        }
        foreach (var member in type.GetMembers())
        {
            if (member.IsStatic || member.IsImplicitlyDeclared) continue;
            switch (member)
            {
                case IFieldSymbol f when !f.IsConst && !IsEventList(f.Type):
                    Add(f.Name, f.Type, f);
                    break;
                case IPropertySymbol p when p.DeclaredAccessibility == Accessibility.Public && !p.IsIndexer && p.Name != "DomainEvents":
                    Add(p.Name, p.Type, p);
                    break;
            }
        }
        return fields;
    }

    private static bool IsEventList(ITypeSymbol type) =>
        type is INamedTypeSymbol { IsGenericType: true } n && n.TypeArguments.Any(a => a.Name is "IDomainEvent" or "DomainEventBase");

    /// What an event carries: its own public properties, the base's `Id` and
    /// `OccurredOn` being the envelope rather than the fact.
    public static List<Field> EventFields(Tree tree, INamedTypeSymbol type)
    {
        var fields = new List<Field>();
        foreach (var p in type.GetMembers().OfType<IPropertySymbol>())
        {
            if (p.IsStatic || p.DeclaredAccessibility != Accessibility.Public || p.IsIndexer) continue;
            fields.Add(new Field { Name = p.Name, Type = Tree.TypeName(p.Type), Doc = tree.Doc(p) });
        }
        if (fields.Count == 0)
        {
            foreach (var p in WidestConstructor(type)?.Parameters ?? Enumerable.Empty<IParameterSymbol>())
            {
                fields.Add(new Field { Name = p.Name, Type = Tree.TypeName(p.Type), Doc = "" });
            }
        }
        return fields;
    }

    public static IMethodSymbol? WidestConstructor(INamedTypeSymbol type) =>
        type.InstanceConstructors.Where(c => !c.IsImplicitlyDeclared).OrderByDescending(c => c.Parameters.Length).ThenBy(c => c.Parameters.Length == 0 ? 1 : 0).FirstOrDefault();

    /// What a command or query hands in: the parameters of its widest
    /// constructor, or its settable properties when it has none.
    public static List<Field> MessageFields(Tree tree, INamedTypeSymbol type)
    {
        var ctor = WidestConstructor(type);
        var fields = new List<Field>();
        if (ctor != null && ctor.Parameters.Length > 0)
        {
            foreach (var p in ctor.Parameters) fields.Add(new Field { Name = p.Name, Type = Tree.TypeName(p.Type), Doc = "" });
            return fields;
        }
        foreach (var p in type.GetMembers().OfType<IPropertySymbol>())
        {
            if (p.IsStatic || p.DeclaredAccessibility != Accessibility.Public || p.SetMethod == null) continue;
            fields.Add(new Field { Name = p.Name, Type = Tree.TypeName(p.Type), Doc = tree.Doc(p) });
        }
        return fields;
    }

    public static Enum ReadEnum(Tree tree, AggregateInfo aggregate, INamedTypeSymbol type)
    {
        var values = new List<EnumValue>();
        foreach (var member in type.GetMembers().OfType<IFieldSymbol>())
        {
            if (!member.HasConstantValue) continue;
            var deprecated = Tree.HasAttribute(member, "Obsolete");
            values.Add(new EnumValue { Name = member.Name, Doc = tree.Doc(member), Deprecated = deprecated ? true : null });
        }
        return new Enum
        {
            Id = aggregate.Id + "." + Names.Kebab(type.Name),
            Slug = Names.Kebab(type.Name),
            Name = type.Name,
            Doc = tree.Doc(type),
            Deprecated = Tree.HasAttribute(type, "Obsolete") ? true : null,
            Values = values,
        };
    }
}
