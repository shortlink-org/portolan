// The tree as one compilation: every .cs file under the root parsed once and
// bound together, so that a partial class is one type, a base chain is
// followed across files and modules, and the type of `new X(...)` or of a
// variable is a fact rather than a guess. Nothing of the service's packages
// is restored: what comes from NuGet is an error type with a name, and every
// rule here that touches a package's type - MediatR's `INotificationHandler`,
// EF's `IEntityTypeConfiguration`, ASP.NET's `ControllerBase` - goes by that
// name, read off the base list as written.

using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Portolan.Extract.CSharp;

public sealed class Tree
{
    /// The input root as the request gave it, the prefix of every path written.
    public string Root { get; }
    public string AbsRoot { get; }
    public Options Options { get; }
    public Builder Out { get; }
    public CSharpCompilation Compilation { get; }
    public List<Module> Modules { get; } = new();
    public List<SyntaxTree> ApiTrees { get; } = new();

    // Indexes filled by the readers, keyed by symbol.
    public Dictionary<INamedTypeSymbol, AggregateInfo> AggregateOfType { get; } = new(SymbolEqualityComparer.Default);
    public Dictionary<INamedTypeSymbol, DomainEventInfo> DomainEvents { get; } = new(SymbolEqualityComparer.Default);
    public Dictionary<INamedTypeSymbol, IntegrationEventInfo> IntegrationEvents { get; } = new(SymbolEqualityComparer.Default);
    public Dictionary<INamedTypeSymbol, HandlerInfo> HandlerByMessage { get; } = new(SymbolEqualityComparer.Default);
    public Dictionary<INamedTypeSymbol, AggregateInfo> PortAggregate { get; } = new(SymbolEqualityComparer.Default);
    public Dictionary<string, StoreInfo> StoreBySchema { get; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<IMethodSymbol, List<DapperAccess>> DapperByMethod { get; } = new(SymbolEqualityComparer.Default);

    private readonly Dictionary<SyntaxTree, SemanticModel> models = new();
    private readonly Dictionary<SyntaxTree, List<INamedTypeSymbol>> typesByTree = new();

    private const string GlobalUsings = """
        global using System;
        global using System.Collections.Generic;
        global using System.IO;
        global using System.Linq;
        global using System.Net.Http;
        global using System.Threading;
        global using System.Threading.Tasks;
        """;

    public Tree(string cwd, Input input, Options options, Builder output)
    {
        Options = options;
        Out = output;
        Root = input.Root.Replace('\\', '/').TrimEnd('/');
        if (Root == "") Root = ".";
        AbsRoot = System.IO.Path.GetFullPath(System.IO.Path.Combine(cwd, Root));

        var files = Directory.Exists(AbsRoot)
            ? Directory.EnumerateFiles(AbsRoot, "*.cs", SearchOption.AllDirectories).Where(Keep).OrderBy(f => f, StringComparer.Ordinal).ToList()
            : new List<string>();
        var parse = new CSharpParseOptions(LanguageVersion.Preview);
        var trees = files.Select(f => CSharpSyntaxTree.ParseText(File.ReadAllText(f), parse, path: f)).ToList();
        trees.Add(CSharpSyntaxTree.ParseText(GlobalUsings, parse, path: "<global usings>"));
        Compilation = CSharpCompilation.Create(
            "portolan",
            trees,
            RuntimeReferences(),
            new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary, nullableContextOptions: NullableContextOptions.Disable));

        var modulesDir = System.IO.Path.Combine(AbsRoot, options.Modules);
        if (Directory.Exists(modulesDir))
        {
            foreach (var dir in Directory.GetDirectories(modulesDir).OrderBy(d => d, StringComparer.Ordinal))
            {
                if (Directory.Exists(System.IO.Path.Combine(dir, "Domain")) || Directory.Exists(System.IO.Path.Combine(dir, "Application")))
                {
                    Modules.Add(new Module(this, dir, trees));
                }
            }
        }
        if (Modules.Count == 0)
        {
            Out.Warn(Rel(modulesDir), "no module here: a module is a directory with Domain or Application under it");
        }
        var apiDir = System.IO.Path.Combine(AbsRoot, options.Api) + "/";
        ApiTrees = trees.Where(t => t.FilePath.StartsWith(apiDir, StringComparison.Ordinal)).ToList();
    }

    /// Build output and tests are not the service: bin/, obj/ and any
    /// directory whose name says Tests.
    private static bool Keep(string file)
    {
        var parts = file.Replace('\\', '/').Split('/');
        foreach (var part in parts[..^1])
        {
            if (part is "bin" or "obj" or ".git" or "node_modules") return false;
            if (part.EndsWith("Tests", StringComparison.Ordinal) || part == "Tests") return false;
        }
        return true;
    }

    /// The runtime's own assemblies, so that `string`, `Guid`, `List<T>` and
    /// `Task` are types rather than errors. They come from the .NET running
    /// this plugin, not from the service's target, which is close enough for
    /// names.
    private static List<MetadataReference> RuntimeReferences()
    {
        var refs = new List<MetadataReference>();
        if (AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES") is not string tpa) return refs;
        foreach (var path in tpa.Split(System.IO.Path.PathSeparator).OrderBy(p => p, StringComparer.Ordinal))
        {
            var name = System.IO.Path.GetFileName(path);
            if (name.StartsWith("System.", StringComparison.Ordinal) || name is "netstandard.dll" or "mscorlib.dll")
            {
                refs.Add(MetadataReference.CreateFromFile(path));
            }
        }
        return refs;
    }

    public SemanticModel Model(SyntaxTree tree)
    {
        if (!models.TryGetValue(tree, out var model))
        {
            model = Compilation.GetSemanticModel(tree);
            models[tree] = model;
        }
        return model;
    }

    /// The top-level types a file declares, in source order: classes, records,
    /// interfaces and enums, at namespace level. Nested types are read only
    /// where a rule asks for them.
    public List<INamedTypeSymbol> TypesIn(SyntaxTree tree)
    {
        if (typesByTree.TryGetValue(tree, out var cached)) return cached;
        var model = Model(tree);
        var types = new List<INamedTypeSymbol>();
        foreach (var node in tree.GetRoot().DescendantNodes(n => n is CompilationUnitSyntax or BaseNamespaceDeclarationSyntax))
        {
            if (node is BaseTypeDeclarationSyntax decl && model.GetDeclaredSymbol(decl) is INamedTypeSymbol symbol)
            {
                types.Add(symbol);
            }
        }
        typesByTree[tree] = types;
        return types;
    }

    public string Rel(string absolute)
    {
        var rel = System.IO.Path.GetRelativePath(AbsRoot, absolute).Replace('\\', '/');
        return Root == "." ? rel : Root + "/" + rel;
    }

    public string PathOf(SyntaxNode node) => Rel(node.SyntaxTree.FilePath);

    public string PathOf(ISymbol symbol)
    {
        var reference = symbol.DeclaringSyntaxReferences.FirstOrDefault();
        return reference == null ? "" : Rel(reference.SyntaxTree.FilePath);
    }

    public string Line(SyntaxNode node) => $"{PathOf(node)}:{node.GetLocation().GetLineSpan().StartLinePosition.Line + 1}";

    public string Line(ISymbol symbol)
    {
        var reference = symbol.DeclaringSyntaxReferences.FirstOrDefault();
        return reference == null ? "" : Line(reference.GetSyntax());
    }

    public string Doc(ISymbol symbol) => Names.Summary(symbol.GetDocumentationCommentXml());

    /// The module a type is declared in, by its file, or null for the
    /// building blocks, the API host and everything else.
    public Module? ModuleOf(ISymbol symbol)
    {
        var reference = symbol.DeclaringSyntaxReferences.FirstOrDefault();
        if (reference == null) return null;
        var path = reference.SyntaxTree.FilePath;
        return Modules.FirstOrDefault(m => path.StartsWith(m.Dir + "/", StringComparison.Ordinal));
    }

    // Symbol helpers, in one place.

    public static IEnumerable<INamedTypeSymbol> Bases(INamedTypeSymbol type)
    {
        for (var b = type.BaseType; b != null && b.SpecialType != SpecialType.System_Object; b = b.BaseType) yield return b;
    }

    /// The type extends a class of one of these names, resolved or not.
    public static bool Derives(INamedTypeSymbol type, params string[] names) => Bases(type).Any(b => names.Contains(b.Name));

    public static INamedTypeSymbol? Base(INamedTypeSymbol type, string name) => Bases(type).FirstOrDefault(b => b.Name == name);

    /// The type implements an interface of this name: a resolved one anywhere
    /// up the chain, or an unresolved one written on its own base list.
    public bool Implements(INamedTypeSymbol type, string name)
    {
        if (type.AllInterfaces.Any(i => i.Name == name)) return true;
        return SyntaxBases(type).Any(b => b.Name == name);
    }

    /// The base list as written, each entry with its type arguments bound:
    /// `INotificationHandler<MeetingCreatedDomainEvent>` is ("INotificationHandler",
    /// [MeetingCreatedDomainEvent]) whether MediatR is referenced or not.
    public List<(string Name, List<ITypeSymbol?> Args)> SyntaxBases(INamedTypeSymbol type)
    {
        var result = new List<(string, List<ITypeSymbol?>)>();
        foreach (var reference in type.DeclaringSyntaxReferences)
        {
            if (reference.GetSyntax() is not TypeDeclarationSyntax decl || decl.BaseList == null) continue;
            var model = Model(decl.SyntaxTree);
            foreach (var baseType in decl.BaseList.Types)
            {
                var syntax = baseType.Type;
                if (syntax is QualifiedNameSyntax q) syntax = q.Right;
                switch (syntax)
                {
                    case GenericNameSyntax g:
                        result.Add((g.Identifier.Text, g.TypeArgumentList.Arguments.Select(a => model.GetTypeInfo(a).Type).ToList()));
                        break;
                    case IdentifierNameSyntax id:
                        result.Add((id.Identifier.Text, new List<ITypeSymbol?>()));
                        break;
                }
            }
        }
        return result;
    }

    private static readonly SymbolDisplayFormat TypeFormat = new(
        typeQualificationStyle: SymbolDisplayTypeQualificationStyle.NameOnly,
        genericsOptions: SymbolDisplayGenericsOptions.IncludeTypeParameters,
        miscellaneousOptions: SymbolDisplayMiscellaneousOptions.UseSpecialTypes);

    /// A type as a reader would write it: `List<MeetingAttendee>`, `DateTime?`.
    public static string TypeName(ITypeSymbol? type) => type == null ? "" : type.ToDisplayString(TypeFormat);

    public static bool HasAttribute(ISymbol symbol, string name) =>
        symbol.GetAttributes().Any(a => AttributeName(a) == name);

    public static string AttributeName(AttributeData attribute)
    {
        var name = attribute.AttributeClass?.Name ?? "";
        if (name == "" && attribute.ApplicationSyntaxReference?.GetSyntax() is AttributeSyntax syntax)
        {
            name = syntax.Name is QualifiedNameSyntax q ? q.Right.ToString() : syntax.Name.ToString();
            if (syntax.Name is GenericNameSyntax g) name = g.Identifier.Text;
        }
        return Names.Strip(name, "Attribute");
    }
}

/// One module: a bounded context with one service, `<slug>.module`.
public sealed class Module
{
    public Tree Tree { get; }
    public string Name { get; }
    public string Slug { get; }
    public string Dir { get; }
    public List<SyntaxTree> Domain { get; }
    public List<SyntaxTree> Application { get; }
    public List<SyntaxTree> Infrastructure { get; }
    public List<SyntaxTree> IntegrationEvents { get; }
    public List<SyntaxTree> All { get; }

    public string ContextId => Slug;
    public string ServiceId => Slug + ".module";
    public string ServiceName => Names.Title(Name) + " module";

    public List<AggregateInfo> Aggregates { get; } = new();
    /// Domain directories with types but no root, by directory name: read
    /// into a model-group when an application group asks for them.
    public Dictionary<string, List<INamedTypeSymbol>> LooseGroups { get; } = new(StringComparer.Ordinal);
    public List<HandlerInfo> Handlers { get; } = new();
    public List<NotificationHandlerInfo> NotificationHandlers { get; } = new();
    public List<IntegrationEventInfo> Published { get; } = new();
    public List<INamedTypeSymbol> Subscribed { get; } = new();
    public List<INamedTypeSymbol> Enqueued { get; } = new();
    public string SubscriptionSource { get; set; } = "";
    public string EnqueueSource { get; set; } = "";
    public List<ControllerInfo> Controllers { get; } = new();
    public List<StoreInfo> Stores { get; } = new();

    public StoreInfo? Store => Stores.FirstOrDefault();

    public Module(Tree tree, string dir, List<SyntaxTree> trees)
    {
        Tree = tree;
        Dir = dir;
        Name = Path.GetFileName(dir);
        Slug = Names.Kebab(Name);
        List<SyntaxTree> Under(string layer) => trees.Where(t => t.FilePath.StartsWith(Path.Combine(dir, layer) + "/", StringComparison.Ordinal)).ToList();
        Domain = Under("Domain");
        Application = Under("Application");
        Infrastructure = Under("Infrastructure");
        IntegrationEvents = Under("IntegrationEvents");
        All = trees.Where(t => t.FilePath.StartsWith(dir + "/", StringComparison.Ordinal)).ToList();
    }

    /// The model-group an application group falls into when no domain
    /// directory has its name: made once, named after the group.
    public AggregateInfo ModelGroup(string group)
    {
        var slug = Names.Kebab(group);
        var existing = Aggregates.FirstOrDefault(a => a.Slug == slug);
        if (existing != null) return existing;
        var aggregate = new AggregateInfo(this, group, slug, Names.Title(group), root: null, modelGroup: true);
        if (LooseGroups.Remove(group, out var loose))
        {
            foreach (var type in loose) Model.Classify(Tree, aggregate, type);
            aggregate.Dir = "";
        }
        Aggregates.Add(aggregate);
        return aggregate;
    }
}
