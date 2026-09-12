// The HTTP edge: a controller under the API host's `Modules/<Module>`
// directory is that module's, its `[Route]` and `[HttpGet("...")]` templates
// make the paths, and the command or query an action news up is the
// operation the route exposes. One OpenAPI 3.1 document per module, the way
// extract-php-ddd infers one from Symfony's route files.

using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Portolan.Extract.CSharp;

public sealed class ControllerInfo
{
    public required Module Module { get; init; }
    public required INamedTypeSymbol Type { get; init; }
    public required string Slug { get; init; }
    public required string Route { get; init; }
    public List<ActionInfo> Actions { get; } = new();
    public string RpcId => Module.ServiceId + "." + Slug;
}

public sealed class ActionInfo
{
    public required ControllerInfo Controller { get; init; }
    public required IMethodSymbol Method { get; init; }
    public required MethodDeclarationSyntax Syntax { get; init; }
    public required string HttpMethod { get; init; }
    public required string Path { get; set; }
    public string OperationId { get; set; } = "";
    public List<string> PathParameters { get; } = new();
    public INamedTypeSymbol? Body { get; init; }
    public List<(int Status, string Type)> Responses { get; } = new();
    public string Permission { get; init; } = "";
    /// The messages the action news up, in order, each with its handler when
    /// the tree has one.
    public List<INamedTypeSymbol> Dispatches { get; } = new();
}

public static class Transport
{
    private static readonly string[] Verbs = { "HttpGet", "HttpPost", "HttpPut", "HttpPatch", "HttpDelete", "HttpHead", "HttpOptions" };

    public static void Read(Tree tree)
    {
        var apiDir = System.IO.Path.Combine(tree.AbsRoot, tree.Options.Api);
        foreach (var syntaxTree in tree.ApiTrees)
        {
            foreach (var type in tree.TypesIn(syntaxTree))
            {
                if (type.TypeKind != TypeKind.Class || type.IsAbstract || !Tree.Derives(type, "ControllerBase", "Controller")) continue;
                var rel = System.IO.Path.GetRelativePath(apiDir, syntaxTree.FilePath).Replace('\\', '/');
                var marker = rel.IndexOf("/Modules/", StringComparison.Ordinal);
                var moduleName = marker < 0 ? "" : rel[(marker + "/Modules/".Length)..].Split('/')[0];
                var module = tree.Modules.FirstOrDefault(m => m.Name == moduleName);
                if (module == null)
                {
                    tree.Out.Warn(tree.Line(type), $"{type.Name} sits under no module's directory of the API host, so no module answers on it");
                    continue;
                }
                var controllerName = Names.Strip(type.Name, "Controller");
                var route = AttributeString(type, "Route").Replace("[controller]", controllerName, StringComparison.OrdinalIgnoreCase);
                var controller = new ControllerInfo { Module = module, Type = type, Slug = Names.Kebab(controllerName), Route = route };
                foreach (var method in type.GetMembers().OfType<IMethodSymbol>())
                {
                    if (method.MethodKind != MethodKind.Ordinary || method.DeclaredAccessibility != Accessibility.Public || method.IsStatic) continue;
                    var verb = method.GetAttributes().Select(Tree.AttributeName).FirstOrDefault(n => Verbs.Contains(n));
                    if (verb == null) continue;
                    if (method.DeclaringSyntaxReferences.FirstOrDefault()?.GetSyntax() is not MethodDeclarationSyntax syntax) continue;
                    var template = AttributeString(method, verb);
                    var path = "/" + string.Join("/", new[] { route, template }.Where(s => s != "").Select(s => s.Trim('/')));
                    path = path.Replace("[action]", method.Name, StringComparison.OrdinalIgnoreCase);
                    var body = method.Parameters.FirstOrDefault(p => Tree.HasAttribute(p, "FromBody"))?.Type as INamedTypeSymbol
                               ?? (verb is "HttpPost" or "HttpPut" or "HttpPatch" ? method.Parameters.FirstOrDefault(p => p.Type is INamedTypeSymbol { TypeKind: TypeKind.Class } t && t.SpecialType == SpecialType.None && !Tree.HasAttribute(p, "FromRoute") && !Tree.HasAttribute(p, "FromQuery"))?.Type as INamedTypeSymbol : null);
                    var action = new ActionInfo
                    {
                        Controller = controller,
                        Method = method,
                        Syntax = syntax,
                        HttpMethod = verb["Http".Length..].ToUpperInvariant(),
                        Path = path,
                        OperationId = method.Name,
                        Body = body,
                        Permission = Permission(method),
                    };
                    foreach (System.Text.RegularExpressions.Match m in System.Text.RegularExpressions.Regex.Matches(path, @"\{([A-Za-z_][A-Za-z0-9_]*)(?::[^}]*)?\}"))
                    {
                        action.PathParameters.Add(m.Groups[1].Value);
                    }
                    action.Path = System.Text.RegularExpressions.Regex.Replace(path, @"\{([A-Za-z_][A-Za-z0-9_]*):[^}]*\}", "{$1}");
                    foreach (var attribute in method.GetAttributes().Where(a => Tree.AttributeName(a) == "ProducesResponseType"))
                    {
                        var typeName = attribute.ConstructorArguments.FirstOrDefault(a => a.Kind == TypedConstantKind.Type).Value is ITypeSymbol t ? Tree.TypeName(t) : "";
                        var status = attribute.ConstructorArguments.FirstOrDefault(a => a.Kind == TypedConstantKind.Primitive && a.Value is int).Value as int? ?? 0;
                        if (status == 0 && attribute.ApplicationSyntaxReference?.GetSyntax() is AttributeSyntax attrSyntax)
                        {
                            // `StatusCodes.Status200OK` is ASP.NET's, unresolved: the number is in the name.
                            var text = attrSyntax.ArgumentList?.Arguments.Select(a => a.ToString()).FirstOrDefault(s => s.Contains("Status")) ?? "";
                            var digits = new string(text.SkipWhile(c => !char.IsDigit(c)).TakeWhile(char.IsDigit).ToArray());
                            if (digits != "") status = int.Parse(digits);
                            if (typeName == "")
                            {
                                var typeofArg = attrSyntax.ArgumentList?.Arguments.Select(a => a.Expression).OfType<TypeOfExpressionSyntax>().FirstOrDefault();
                                if (typeofArg != null) typeName = Tree.TypeName(tree.Model(syntax.SyntaxTree).GetTypeInfo(typeofArg.Type).Type) is var n && n != "" ? n : typeofArg.Type.ToString();
                            }
                        }
                        if (status != 0) action.Responses.Add((status, typeName));
                    }
                    var model = tree.Model(syntax.SyntaxTree);
                    foreach (var creation in syntax.DescendantNodes().OfType<BaseObjectCreationExpressionSyntax>())
                    {
                        if (model.GetTypeInfo(creation).Type is INamedTypeSymbol created && tree.HandlerByMessage.ContainsKey(created))
                        {
                            action.Dispatches.Add(created);
                        }
                    }
                    controller.Actions.Add(action);
                }
                if (controller.Actions.Count == 0) continue;
                module.Controllers.Add(controller);
            }
        }
        foreach (var module in tree.Modules)
        {
            module.Controllers.Sort((a, b) => string.CompareOrdinal(a.Slug, b.Slug));
            var taken = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (var action in module.Controllers.SelectMany(c => c.Actions)) taken[action.OperationId] = taken.GetValueOrDefault(action.OperationId) + 1;
            foreach (var controller in module.Controllers)
            {
                foreach (var action in controller.Actions)
                {
                    if (taken[action.OperationId] > 1) action.OperationId = Names.Strip(controller.Type.Name, "Controller") + "_" + action.Method.Name;
                    foreach (var message in action.Dispatches)
                    {
                        var handler = tree.HandlerByMessage[message];
                        if (handler.Module == module && !handler.ExposedBy.Contains(action.OperationId)) handler.ExposedBy.Add(action.OperationId);
                    }
                }
            }
        }
    }

    private static string AttributeString(ISymbol symbol, string name)
    {
        var attribute = symbol.GetAttributes().FirstOrDefault(a => Tree.AttributeName(a) == name);
        if (attribute == null) return "";
        var value = attribute.ConstructorArguments.FirstOrDefault(a => a.Value is string).Value as string;
        if (value != null) return value;
        if (attribute.ApplicationSyntaxReference?.GetSyntax() is AttributeSyntax syntax)
        {
            var literal = syntax.ArgumentList?.Arguments.Select(a => a.Expression).OfType<LiteralExpressionSyntax>().FirstOrDefault(l => l.Token.Value is string);
            if (literal != null) return (string)literal.Token.Value!;
        }
        return "";
    }

    private static string Permission(IMethodSymbol method)
    {
        var attribute = method.GetAttributes().FirstOrDefault(a => Tree.AttributeName(a) == "HasPermission");
        if (attribute?.ApplicationSyntaxReference?.GetSyntax() is not AttributeSyntax syntax) return "";
        var text = syntax.ArgumentList?.Arguments.FirstOrDefault()?.ToString() ?? "";
        return text.Contains('.') ? text[(text.LastIndexOf('.') + 1)..] : text;
    }

    /// The interfaces a module answers on, for the fragment.
    public static List<RpcService> Provides(Tree tree, Module module, string documentPath)
    {
        var provides = new List<RpcService>();
        foreach (var controller in module.Controllers)
        {
            var service = new RpcService { Id = controller.RpcId, Source = documentPath };
            foreach (var action in controller.Actions.OrderBy(a => a.Path, StringComparer.Ordinal).ThenBy(a => a.HttpMethod, StringComparer.Ordinal))
            {
                service.Methods.Add(new RpcMethod
                {
                    Name = action.OperationId,
                    Doc = Summary(tree, action),
                    Http = new HttpRoute { Method = action.HttpMethod, Path = action.Path },
                });
            }
            provides.Add(service);
        }
        return provides;
    }

    private static string Summary(Tree tree, ActionInfo action)
    {
        var doc = tree.Doc(action.Method);
        return doc != "" ? doc : Names.Sentence(action.Method.Name);
    }

    /// One document per module, paths in order, every operation marked as
    /// inferred with where it was read from.
    public static string OpenApi(Tree tree, Module module)
    {
        var document = new YamlMap()
            .Set("openapi", "3.1.0")
            .Set("info", new YamlMap()
                .Set("title", Names.Title(module.Name) + " HTTP API")
                .Set("version", "inferred")
                .Set("description", "Generated statically from ASP.NET Core controller attributes. Unknown details are left unspecified."));
        var tags = module.Controllers.Select(c => c.Slug).Distinct().OrderBy(t => t, StringComparer.Ordinal)
            .Select(t => (object?)new YamlMap().Set("name", t)).ToList();
        document.Set("tags", tags);
        var paths = new YamlMap();
        var byPath = module.Controllers.SelectMany(c => c.Actions).GroupBy(a => a.Path).OrderBy(g => g.Key, StringComparer.Ordinal);
        foreach (var group in byPath)
        {
            var item = new YamlMap();
            foreach (var action in group.OrderBy(a => a.HttpMethod, StringComparer.Ordinal))
            {
                var operation = new YamlMap()
                    .Set("operationId", action.OperationId)
                    .Set("summary", Summary(tree, action))
                    .Set("tags", new List<object?> { action.Controller.Slug });
                if (action.PathParameters.Count > 0)
                {
                    operation.Set("parameters", action.PathParameters.Select(p => (object?)new YamlMap()
                        .Set("name", p)
                        .Set("in", "path")
                        .Set("required", true)
                        .Set("schema", ParameterSchema(action, p))).ToList());
                }
                if (action.Body != null)
                {
                    operation.Set("requestBody", new YamlMap()
                        .Set("required", true)
                        .Set("content", new YamlMap().Set("application/json", new YamlMap().Set("schema", Schema(action.Body, 0)))));
                }
                var responses = new YamlMap();
                foreach (var (status, type) in action.Responses.OrderBy(r => r.Status))
                {
                    var response = new YamlMap().Set("description", type == "" ? "Declared by the action." : type);
                    if (type != "") response.Set("x-portolan-type", type);
                    responses.Set(status.ToString(), response);
                }
                if (responses.Entries.Count == 0)
                {
                    responses.Set("default", new YamlMap().Set("description", "Response schema and status are not available from static controller analysis."));
                }
                operation.Set("responses", responses);
                if (action.Permission != "") operation.Set("x-portolan-permission", action.Permission);
                operation.Set("x-portolan-inferred", true);
                operation.Set("x-portolan-source", tree.Line(action.Syntax));
                operation.Set("x-portolan-controller", action.Controller.Type.Name);
                item.Set(action.HttpMethod.ToLowerInvariant(), operation);
            }
            paths.Set(group.Key, item);
        }
        document.Set("paths", paths);
        return Yaml.Write(document);
    }

    private static YamlMap ParameterSchema(ActionInfo action, string name)
    {
        var parameter = action.Method.Parameters.FirstOrDefault(p => string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase));
        return parameter == null ? new YamlMap().Set("type", "string") : Schema(parameter.Type, 2);
    }

    /// A type as a JSON schema, one level of properties for a class the tree
    /// declares, and an honest `object` past that.
    public static YamlMap Schema(ITypeSymbol type, int depth)
    {
        if (type is INamedTypeSymbol { IsGenericType: true } nullable && nullable.OriginalDefinition.SpecialType == SpecialType.System_Nullable_T)
        {
            return Schema(nullable.TypeArguments[0], depth);
        }
        switch (type.SpecialType)
        {
            case SpecialType.System_String: return new YamlMap().Set("type", "string");
            case SpecialType.System_Boolean: return new YamlMap().Set("type", "boolean");
            case SpecialType.System_Int32:
            case SpecialType.System_Int16:
            case SpecialType.System_Byte: return new YamlMap().Set("type", "integer");
            case SpecialType.System_Int64: return new YamlMap().Set("type", "integer").Set("format", "int64");
            case SpecialType.System_Decimal:
            case SpecialType.System_Double:
            case SpecialType.System_Single: return new YamlMap().Set("type", "number");
            case SpecialType.System_DateTime: return new YamlMap().Set("type", "string").Set("format", "date-time");
        }
        switch (type.Name)
        {
            case "Guid": return new YamlMap().Set("type", "string").Set("format", "uuid");
            case "DateTimeOffset": return new YamlMap().Set("type", "string").Set("format", "date-time");
            case "DateOnly": return new YamlMap().Set("type", "string").Set("format", "date");
            case "TimeSpan": return new YamlMap().Set("type", "string");
        }
        if (type is IArrayTypeSymbol array) return new YamlMap().Set("type", "array").Set("items", Schema(array.ElementType, depth + 1));
        if (type is INamedTypeSymbol { IsGenericType: true } generic && generic.TypeArguments.Length == 1
            && generic.Name is "List" or "IList" or "IEnumerable" or "ICollection" or "IReadOnlyList" or "IReadOnlyCollection" or "HashSet")
        {
            return new YamlMap().Set("type", "array").Set("items", Schema(generic.TypeArguments[0], depth + 1));
        }
        if (type.TypeKind == TypeKind.Enum && type is INamedTypeSymbol enumType)
        {
            return new YamlMap().Set("type", "string").Set("enum", enumType.GetMembers().OfType<IFieldSymbol>().Where(f => f.HasConstantValue).Select(f => (object?)f.Name).ToList());
        }
        if (type is INamedTypeSymbol { TypeKind: TypeKind.Class } cls && cls.DeclaringSyntaxReferences.Length > 0 && depth < 2)
        {
            var properties = new YamlMap();
            foreach (var p in cls.GetMembers().OfType<IPropertySymbol>())
            {
                if (p.IsStatic || p.DeclaredAccessibility != Accessibility.Public || p.IsIndexer) continue;
                properties.Set(Names.Camel(p.Name), Schema(p.Type, depth + 1));
            }
            return new YamlMap().Set("type", "object").Set("x-portolan-type", cls.Name).Set("properties", properties);
        }
        return new YamlMap().Set("type", "object");
    }
}
