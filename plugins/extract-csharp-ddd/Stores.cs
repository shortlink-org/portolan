// The database, read from the database project: `Structure/<schema>/Tables/*.sql`
// is the truth about a table, the EF configuration under a module's
// infrastructure says which aggregate it holds and which column is which
// field, and the repository adapters and Dapper strings say who reads and
// writes it. A schema belongs to the module whose configurations map tables
// into it; one store per schema, owned by that module's service.

using System.Text;
using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Portolan.Extract.CSharp;

public sealed class StoreInfo
{
    public required Store Store { get; init; }
    public required Module Module { get; init; }
    public required string Schema { get; init; }
    public Dictionary<string, Table> Tables { get; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, View> Views { get; } = new(StringComparer.OrdinalIgnoreCase);
    /// The table that holds each block type, by the EF configuration.
    public Dictionary<INamedTypeSymbol, Table> TableOfBlock { get; } = new(SymbolEqualityComparer.Default);
    public HashSet<string> WrittenByApplication { get; } = new(StringComparer.OrdinalIgnoreCase);
}

public sealed record DapperAccess(StoreInfo Store, string Target, string Operation, Table? Table, View? View);

public static partial class Stores
{
    public static void Read(Tree tree)
    {
        var databaseDir = Path.Combine(tree.AbsRoot, tree.Options.Database);
        if (!Directory.Exists(databaseDir)) return;
        var structure = Directory.GetDirectories(databaseDir, "Structure", SearchOption.AllDirectories).OrderBy(d => d, StringComparer.Ordinal).FirstOrDefault();
        if (structure == null)
        {
            tree.Out.Warn(tree.Rel(databaseDir), "no Structure directory under the database project; no store is read");
            return;
        }
        var schemas = Directory.GetDirectories(structure).Where(d => Directory.Exists(Path.Combine(d, "Tables")) || Directory.Exists(Path.Combine(d, "Views"))).OrderBy(d => d, StringComparer.Ordinal).ToList();
        if (schemas.Count == 0) return;

        var byToTable = ToTableCounts(tree);
        var byWrite = DapperWriteCounts(tree);
        var owners = new Dictionary<string, Module>(StringComparer.Ordinal);
        foreach (var schemaDir in schemas)
        {
            var schema = Path.GetFileName(schemaDir);
            var module = Owner(tree, schema, byToTable, byWrite);
            if (module == null)
            {
                var count = Directory.Exists(Path.Combine(schemaDir, "Tables")) ? Directory.GetFiles(Path.Combine(schemaDir, "Tables"), "*.sql").Length : 0;
                tree.Out.Warn(tree.Rel(schemaDir), $"schema {schema}: no module maps a table into it or writes one, so {(count == 1 ? "its one table belongs" : $"its {count} tables belong")} to nobody and {(count == 1 ? "is" : "are")} not read");
                continue;
            }
            owners[schema] = module;
        }
        // A module's home schema, the one its configurations map into, is
        // its `db`; any other it owns keeps the schema's name.
        var primary = new Dictionary<Module, string>();
        foreach (var module in tree.Modules)
        {
            var home = owners.Where(kv => kv.Value == module).Select(kv => kv.Key)
                .OrderByDescending(s => byToTable.GetValueOrDefault((module, s)))
                .ThenByDescending(s => NameMatches(module, s) ? 1 : 0)
                .ThenBy(s => s, StringComparer.Ordinal)
                .FirstOrDefault();
            if (home != null) primary[module] = home;
        }
        foreach (var schemaDir in schemas)
        {
            var schema = Path.GetFileName(schemaDir);
            if (!owners.TryGetValue(schema, out var module)) continue;
            var isHome = primary[module] == schema;
            var slug = isHome ? "db" : schema.ToLowerInvariant();
            var store = new StoreInfo
            {
                Module = module,
                Schema = schema,
                Store = new Store
                {
                    Id = module.ServiceId + "." + slug,
                    Slug = slug,
                    Name = isHome ? Names.Title(module.Name) + " database" : schema + " schema",
                    Kind = tree.Options.StoreKind,
                    Owner = module.ServiceId,
                    Source = tree.Rel(schemaDir),
                },
            };
            module.Stores.Add(store);
            tree.StoreBySchema[schema] = store;
            ReadTables(tree, store, schemaDir);
        }
        foreach (var store in tree.StoreBySchema.Values) ReadViews(tree, store, Path.Combine(structure, store.Schema));
        foreach (var module in tree.Modules) ReadConfigurations(tree, module);
        foreach (var store in tree.StoreBySchema.Values) ViewPersists(tree, store);
        foreach (var module in tree.Modules) ReadAdapters(tree, module);
        foreach (var module in tree.Modules) ReadDapper(tree, module);
        foreach (var store in tree.StoreBySchema.Values) Roles(store);
    }

    private static Dictionary<(Module, string), int> ToTableCounts(Tree tree)
    {
        var counts = new Dictionary<(Module, string), int>();
        foreach (var module in tree.Modules)
        {
            foreach (var syntaxTree in module.Infrastructure)
            {
                foreach (var invocation in syntaxTree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
                {
                    if (invocation.Expression is not MemberAccessExpressionSyntax { Name.Identifier.Text: "ToTable" }) continue;
                    var strings = invocation.ArgumentList.Arguments.Select(a => a.Expression).OfType<LiteralExpressionSyntax>().Where(l => l.Token.Value is string).Select(l => (string)l.Token.Value!).ToList();
                    if (strings.Count < 2) continue;
                    counts[(module, strings[1])] = counts.GetValueOrDefault((module, strings[1])) + 1;
                }
            }
        }
        return counts;
    }

    /// INSERT, UPDATE and DELETE in a module's SQL strings, by schema. A read
    /// says nothing about ownership: every module reads the others' views.
    private static Dictionary<(Module, string), int> DapperWriteCounts(Tree tree)
    {
        var counts = new Dictionary<(Module, string), int>();
        foreach (var module in tree.Modules)
        {
            foreach (var syntaxTree in module.Application.Concat(module.Infrastructure))
            {
                foreach (Match m in SqlTarget().Matches(SqlText(syntaxTree.GetRoot())))
                {
                    var verb = m.Groups[1].Value.ToUpperInvariant();
                    if (verb is "FROM" or "JOIN") continue;
                    counts[(module, m.Groups[2].Value)] = counts.GetValueOrDefault((module, m.Groups[2].Value)) + 1;
                }
            }
        }
        return counts;
    }

    private static bool NameMatches(Module module, string schema) =>
        string.Equals(module.Slug.Replace("-", ""), schema, StringComparison.OrdinalIgnoreCase) || string.Equals(module.Name, schema, StringComparison.OrdinalIgnoreCase);

    /// Who a schema belongs to: the module whose EF configurations map tables
    /// into it, else the module named like it, else the module that writes it.
    private static Module? Owner(Tree tree, string schema, Dictionary<(Module, string), int> byToTable, Dictionary<(Module, string), int> byWrite)
    {
        Module? Best(Dictionary<(Module, string), int> counts) => tree.Modules
            .Select(m => (m, n: counts.GetValueOrDefault((m, schema))))
            .Where(x => x.n > 0)
            .OrderByDescending(x => x.n).ThenBy(x => x.m.Name, StringComparer.Ordinal)
            .Select(x => x.m).FirstOrDefault();
        return Best(byToTable)
               ?? tree.Modules.FirstOrDefault(m => NameMatches(m, schema))
               ?? Best(byWrite);
    }

    // T-SQL, as the database project writes it.

    [GeneratedRegex(@"CREATE\s+TABLE\s+(?:\[?(\w+)\]?\.)?\[?(\w+)\]?\s*\(", RegexOptions.IgnoreCase)]
    private static partial Regex CreateTable();

    [GeneratedRegex(@"CREATE\s+(UNIQUE\s+)?(?:CLUSTERED\s+|NONCLUSTERED\s+)?INDEX\s+\[?(\w+)\]?\s+ON\s+(?:\[?(\w+)\]?\.)?\[?(\w+)\]?\s*\(([^)]*)\)", RegexOptions.IgnoreCase)]
    private static partial Regex CreateIndex();

    [GeneratedRegex(@"PRIMARY\s+KEY\s*(?:CLUSTERED|NONCLUSTERED)?\s*\(([^)]*)\)", RegexOptions.IgnoreCase)]
    private static partial Regex PrimaryKey();

    [GeneratedRegex(@"FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+(?:\[?(\w+)\]?\.)?\[?(\w+)\]?\s*\(([^)]*)\)", RegexOptions.IgnoreCase)]
    private static partial Regex ForeignKeyRe();

    [GeneratedRegex(@"^(?:CONSTRAINT\s+\[?(\w+)\]?\s+)?UNIQUE\s*(?:CLUSTERED|NONCLUSTERED)?\s*\(([^)]*)\)", RegexOptions.IgnoreCase)]
    private static partial Regex UniqueConstraint();

    [GeneratedRegex(@"^\[?(\w+)\]?\s+(\w+(?:\s*\([^)]*\))?)(.*)$", RegexOptions.Singleline)]
    private static partial Regex ColumnDef();

    [GeneratedRegex(@"CREATE\s+VIEW\s+(?:\[?(\w+)\]?\.)?\[?(\w+)\]?\s+(?:WITH\s+\w+\s+)?AS\s+(.*)$", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex CreateView();

    [GeneratedRegex(@"\b(FROM|JOIN)\s+(?:\[?(\w+)\]?\.)?\[?(\w+)\]?(?:\s+(?:AS\s+)?\[?(\w+)\]?)?", RegexOptions.IgnoreCase)]
    private static partial Regex FromJoin();

    [GeneratedRegex(@"\b(DELETE\s+FROM|FROM|JOIN|INSERT\s+INTO|INTO|UPDATE)\s+\[?(\w+)\]?\.\[?(\w+)\]?", RegexOptions.IgnoreCase)]
    private static partial Regex SqlTarget();

    private static void ReadTables(Tree tree, StoreInfo store, string schemaDir)
    {
        var tablesDir = Path.Combine(schemaDir, "Tables");
        if (!Directory.Exists(tablesDir)) return;
        var indexes = new List<(string Table, TableIndex Index)>();
        foreach (var file in Directory.GetFiles(tablesDir, "*.sql").OrderBy(f => f, StringComparer.Ordinal))
        {
            var text = File.ReadAllText(file).TrimStart('﻿');
            foreach (Match m in CreateTable().Matches(text))
            {
                var body = Parenthesized(text, m.Index + m.Length - 1);
                if (body == null) continue;
                var name = m.Groups[2].Value;
                var table = new Table { Id = store.Store.Id + "." + name, Name = name };
                var pk = new List<string>();
                foreach (var raw in SplitTopLevel(body, ','))
                {
                    var item = raw.Trim();
                    if (item == "") continue;
                    var upper = item.ToUpperInvariant();
                    if (upper.StartsWith("CONSTRAINT") || upper.StartsWith("PRIMARY KEY") || upper.StartsWith("FOREIGN KEY") || upper.StartsWith("UNIQUE") || upper.StartsWith("CHECK") || upper.StartsWith("INDEX"))
                    {
                        var pkMatch = PrimaryKey().Match(item);
                        if (pkMatch.Success) pk.AddRange(Columns(pkMatch.Groups[1].Value));
                        var fk = ForeignKeyRe().Match(item);
                        if (fk.Success)
                        {
                            var column = Columns(fk.Groups[1].Value).FirstOrDefault() ?? "";
                            var targetSchema = fk.Groups[2].Success && fk.Groups[2].Value != "" ? fk.Groups[2].Value : store.Schema;
                            var targetStore = tree.StoreBySchema.GetValueOrDefault(targetSchema)?.Store.Id ?? store.Store.Id;
                            var fkColumn = table.Columns.FirstOrDefault(c => string.Equals(c.Name, column, StringComparison.OrdinalIgnoreCase));
                            if (fkColumn != null)
                            {
                                fkColumn.Fk = new ForeignKey
                                {
                                    Table = targetStore + "." + fk.Groups[3].Value,
                                    Column = Columns(fk.Groups[4].Value).FirstOrDefault() ?? "",
                                };
                            }
                            // The column may be declared after the constraint; fixed below.
                            if (table.Columns.All(c => !string.Equals(c.Name, column, StringComparison.OrdinalIgnoreCase)))
                            {
                                indexes.Add((name, new TableIndex { Name = "__fk__" + column + "__" + targetStore + "." + fk.Groups[3].Value + "__" + (Columns(fk.Groups[4].Value).FirstOrDefault() ?? ""), Unique = false }));
                            }
                        }
                        var unique = UniqueConstraint().Match(item);
                        if (unique.Success)
                        {
                            var index = new TableIndex { Name = unique.Groups[1].Success && unique.Groups[1].Value != "" ? unique.Groups[1].Value : "UQ_" + name, Unique = true };
                            index.Columns.AddRange(Columns(unique.Groups[2].Value));
                            indexes.Add((name, index));
                        }
                        continue;
                    }
                    var col = ColumnDef().Match(item);
                    if (!col.Success) continue;
                    var rest = col.Groups[3].Value;
                    var column2 = new Column
                    {
                        Name = col.Groups[1].Value,
                        Type = NormalizeType(col.Groups[2].Value),
                        Nullable = !Regex.IsMatch(rest, @"\bNOT\s+NULL\b", RegexOptions.IgnoreCase),
                        Pk = Regex.IsMatch(rest, @"\bPRIMARY\s+KEY\b", RegexOptions.IgnoreCase) ? true : null,
                    };
                    table.Columns.Add(column2);
                }
                foreach (var key in pk)
                {
                    var column = table.Columns.FirstOrDefault(c => string.Equals(c.Name, key, StringComparison.OrdinalIgnoreCase));
                    if (column != null) column.Pk = true;
                }
                if (store.Tables.ContainsKey(name))
                {
                    tree.Out.Warn(tree.Rel(file), $"table {store.Schema}.{name} is created twice; the first is kept");
                    continue;
                }
                store.Tables[name] = table;
            }
            foreach (Match m in CreateIndex().Matches(text))
            {
                var index = new TableIndex { Name = m.Groups[2].Value, Unique = m.Groups[1].Success && m.Groups[1].Value != "" };
                index.Columns.AddRange(Columns(m.Groups[5].Value));
                indexes.Add((m.Groups[4].Value, index));
            }
        }
        foreach (var (tableName, index) in indexes)
        {
            if (!store.Tables.TryGetValue(tableName, out var table)) continue;
            if (index.Name.StartsWith("__fk__", StringComparison.Ordinal))
            {
                var parts = index.Name.Split("__", StringSplitOptions.RemoveEmptyEntries);
                var column = table.Columns.FirstOrDefault(c => string.Equals(c.Name, parts[1], StringComparison.OrdinalIgnoreCase));
                if (column != null && column.Fk == null) column.Fk = new ForeignKey { Table = parts[2], Column = parts.Length > 3 ? parts[3] : "" };
                continue;
            }
            table.Indexes ??= new List<TableIndex>();
            if (index.Columns.All(c => table.Columns.Any(tc => string.Equals(tc.Name, c, StringComparison.OrdinalIgnoreCase))))
            {
                table.Indexes.Add(index);
            }
            if (table.Indexes.Count == 0) table.Indexes = null;
        }
    }

    private static void ReadViews(Tree tree, StoreInfo store, string schemaDir)
    {
        var viewsDir = Path.Combine(schemaDir, "Views");
        if (!Directory.Exists(viewsDir)) return;
        foreach (var file in Directory.GetFiles(viewsDir, "*.sql").OrderBy(f => f, StringComparer.Ordinal))
        {
            var text = File.ReadAllText(file).TrimStart('﻿');
            var m = CreateView().Match(text);
            if (!m.Success) continue;
            var body = m.Groups[3].Value;
            var go = Regex.Match(body, @"^\s*GO\s*$", RegexOptions.Multiline);
            if (go.Success) body = body[..go.Index];
            body = body.Trim().TrimEnd(';').Trim();
            var name = m.Groups[2].Value;
            var view = new View { Id = store.Store.Id + "." + name, Name = name, Definition = body, Source = tree.Rel(file) };

            // Aliases, and the tables read.
            var aliases = new Dictionary<string, Table>(StringComparer.OrdinalIgnoreCase);
            var reads = new List<string>();
            var readTables = new List<Table>();
            foreach (Match fj in FromJoin().Matches(body))
            {
                var schema = fj.Groups[2].Success && fj.Groups[2].Value != "" ? fj.Groups[2].Value : store.Schema;
                var target = tree.StoreBySchema.GetValueOrDefault(schema);
                if (target == null || !target.Tables.TryGetValue(fj.Groups[3].Value, out var table))
                {
                    if (target?.Views.TryGetValue(fj.Groups[3].Value, out var inner) == true)
                    {
                        if (!reads.Contains(inner.Id)) reads.Add(inner.Id);
                    }
                    continue;
                }
                if (!reads.Contains(table.Id)) { reads.Add(table.Id); readTables.Add(table); }
                var alias = fj.Groups[4].Success ? fj.Groups[4].Value : "";
                if (alias != "" && !IsKeyword(alias)) aliases[alias] = table;
            }

            // The select list.
            var select = Regex.Match(body, @"\bSELECT\b\s*(?:DISTINCT\s+)?(?:TOP\s*\(?\s*\d+\s*\)?\s+)?", RegexOptions.IgnoreCase);
            var fromAt = TopLevelKeyword(body, "FROM", select.Success ? select.Index + select.Length : 0);
            if (select.Success && fromAt > select.Index)
            {
                var list = body[(select.Index + select.Length)..fromAt];
                foreach (var raw in SplitTopLevel(list, ','))
                {
                    var item = raw.Trim();
                    if (item == "") continue;
                    var aliasMatch = Regex.Match(item, @"\bAS\s+\[?(\w+)\]?\s*$", RegexOptions.IgnoreCase);
                    var expression = aliasMatch.Success ? item[..aliasMatch.Index].Trim() : item;
                    var source = Regex.Match(expression, @"^\[?(\w+)\]?\.\[?(\w+)\]?$");
                    var columnName = aliasMatch.Success ? aliasMatch.Groups[1].Value : (source.Success ? source.Groups[2].Value : Regex.Match(expression, @"\[?(\w+)\]?\s*$").Groups[1].Value);
                    if (columnName == "") continue;
                    Column? origin = null;
                    if (source.Success)
                    {
                        if (aliases.TryGetValue(source.Groups[1].Value, out var aliased)) origin = aliased.Columns.FirstOrDefault(c => string.Equals(c.Name, source.Groups[2].Value, StringComparison.OrdinalIgnoreCase));
                        origin ??= readTables.Select(t => t.Columns.FirstOrDefault(c => string.Equals(c.Name, source.Groups[2].Value, StringComparison.OrdinalIgnoreCase))).FirstOrDefault(c => c != null);
                    }
                    view.Columns.Add(new Column { Name = columnName, Type = origin?.Type ?? "unknown", Nullable = origin?.Nullable ?? true });
                }
            }
            view.Reads = reads.Count > 0 ? reads : null;
            store.Views[name] = view;
        }
        if (store.Views.Count > 0) store.Store.Views = store.Views.Values.OrderBy(v => v.Name, StringComparer.Ordinal).ToList();
    }

    /// A view over one aggregate's tables presents that aggregate: the root
    /// when the root's table is among them, else the one block it reads.
    private static void ViewPersists(Tree tree, StoreInfo store)
    {
        var tables = tree.StoreBySchema.Values.SelectMany(s => s.Tables.Values).ToDictionary(t => t.Id, StringComparer.Ordinal);
        foreach (var view in store.Views.Values)
        {
            var persisted = (view.Reads ?? new List<string>()).Select(id => tables.GetValueOrDefault(id)?.Persists).Where(p => p != null).Select(p => p!).ToList();
            if (persisted.Count == 0 || persisted.Select(p => p.Aggregate).Distinct().Count() != 1) continue;
            var root = persisted.FirstOrDefault(p => (view.Reads ?? new List<string>()).Any(id => tables.GetValueOrDefault(id) is { Role: "aggregate-root" } t && t.Persists == p));
            view.Persists = new Persists { Aggregate = persisted[0].Aggregate, Block = (root ?? persisted[0]).Block };
        }
    }

    private static bool IsKeyword(string word) => word.ToUpperInvariant() is "ON" or "WHERE" or "LEFT" or "RIGHT" or "INNER" or "OUTER" or "FULL" or "CROSS" or "JOIN" or "GROUP" or "ORDER" or "UNION" or "HAVING" or "WITH" or "AS";

    private static int TopLevelKeyword(string text, string keyword, int from)
    {
        var depth = 0;
        for (var i = from; i < text.Length; i++)
        {
            var c = text[i];
            if (c == '(') depth++;
            else if (c == ')') depth--;
            else if (depth == 0 && (i == 0 || !char.IsLetterOrDigit(text[i - 1])) && string.Compare(text, i, keyword, 0, keyword.Length, StringComparison.OrdinalIgnoreCase) == 0
                     && (i + keyword.Length >= text.Length || !char.IsLetterOrDigit(text[i + keyword.Length])))
            {
                return i;
            }
        }
        return -1;
    }

    private static string? Parenthesized(string text, int open)
    {
        if (open < 0 || open >= text.Length || text[open] != '(') return null;
        var depth = 0;
        for (var i = open; i < text.Length; i++)
        {
            if (text[i] == '(') depth++;
            else if (text[i] == ')' && --depth == 0) return text[(open + 1)..i];
        }
        return null;
    }

    private static List<string> SplitTopLevel(string text, char separator)
    {
        var parts = new List<string>();
        var depth = 0;
        var start = 0;
        for (var i = 0; i < text.Length; i++)
        {
            if (text[i] == '(') depth++;
            else if (text[i] == ')') depth--;
            else if (text[i] == separator && depth == 0)
            {
                parts.Add(text[start..i]);
                start = i + 1;
            }
        }
        parts.Add(text[start..]);
        return parts;
    }

    private static List<string> Columns(string list) =>
        list.Split(',').Select(c => Regex.Replace(c, @"\b(ASC|DESC)\b", "", RegexOptions.IgnoreCase).Replace("[", "").Replace("]", "").Trim()).Where(c => c != "").ToList();

    private static string NormalizeType(string type) => Regex.Replace(type.ToLowerInvariant(), @"\s+", "");

    // EF Core configurations.

    private static void ReadConfigurations(Tree tree, Module module)
    {
        foreach (var syntaxTree in module.Infrastructure)
        {
            var model = tree.Model(syntaxTree);
            foreach (var type in tree.TypesIn(syntaxTree))
            {
                var configured = tree.SyntaxBases(type).FirstOrDefault(b => b.Name == "IEntityTypeConfiguration");
                if (configured.Name == null || configured.Args.Count != 1 || configured.Args[0] is not INamedTypeSymbol block) continue;
                var configure = type.DeclaringSyntaxReferences.Select(r => r.GetSyntax()).OfType<TypeDeclarationSyntax>()
                    .SelectMany(d => d.Members.OfType<MethodDeclarationSyntax>()).FirstOrDefault(m => m.Identifier.Text == "Configure");
                if (configure?.Body == null) continue;
                var mappings = new List<Mapping>();
                var top = new Mapping { Block = block };
                mappings.Add(top);
                ReadScope(tree, model, configure.Body, scopeLambda: null, top, block, prefixField: null, mappings);
                foreach (var mapping in mappings) Apply(tree, module, mapping, syntaxTree);
            }
        }
    }

    private sealed class Mapping
    {
        public required INamedTypeSymbol Block { get; init; }
        public string? TableName { get; set; }
        public string? Schema { get; set; }
        public List<(string Column, string Maps)> Columns { get; } = new();
        public SyntaxNode? Source { get; set; }
    }

    /// One builder scope: the Configure body, or the lambda of an OwnsOne or
    /// OwnsMany. Invocations whose nearest lambda is this scope's belong to it.
    private static void ReadScope(Tree tree, SemanticModel model, SyntaxNode body, LambdaExpressionSyntax? scopeLambda, Mapping mapping, INamedTypeSymbol owner, string? prefixField, List<Mapping> mappings)
    {
        foreach (var invocation in body.DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            var nearest = invocation.Ancestors().OfType<LambdaExpressionSyntax>().FirstOrDefault();
            if (!ReferenceEquals(nearest, scopeLambda)) continue;
            if (invocation.Expression is not MemberAccessExpressionSyntax access) continue;
            var name = access.Name.Identifier.Text;
            switch (name)
            {
                case "ToTable":
                {
                    var strings = invocation.ArgumentList.Arguments.Select(a => a.Expression).OfType<LiteralExpressionSyntax>().Where(l => l.Token.Value is string).Select(l => (string)l.Token.Value!).ToList();
                    if (strings.Count > 0) { mapping.TableName = strings[0]; mapping.Source = invocation; }
                    if (strings.Count > 1) mapping.Schema = strings[1];
                    break;
                }
                case "OwnsOne":
                case "OwnsMany":
                {
                    var owned = access.Name is GenericNameSyntax g && g.TypeArgumentList.Arguments.Count == 1 ? model.GetTypeInfo(g.TypeArgumentList.Arguments[0]).Type as INamedTypeSymbol : null;
                    var field = FieldName(invocation.ArgumentList.Arguments.FirstOrDefault()?.Expression);
                    var lambda = invocation.ArgumentList.Arguments.Select(a => a.Expression).OfType<LambdaExpressionSyntax>().FirstOrDefault();
                    if (lambda == null) break;
                    var lambdaBody = (SyntaxNode?)lambda.Body;
                    if (lambdaBody == null) break;
                    if (name == "OwnsOne")
                    {
                        // A value object's parts land in the owner's table, on the owner's field.
                        ReadScope(tree, model, lambdaBody, lambda, mapping, owner, prefixField ?? (field == "" ? null : field), mappings);
                    }
                    else if (owned != null)
                    {
                        var child = new Mapping { Block = owned, Source = invocation };
                        mappings.Add(child);
                        ReadScope(tree, model, lambdaBody, lambda, child, owned, prefixField: null, mappings);
                    }
                    break;
                }
                case "Property":
                case "HasKey":
                {
                    var field = FieldName(invocation.ArgumentList.Arguments.FirstOrDefault()?.Expression);
                    if (field == "") break;
                    var column = ColumnNameIn(invocation) ?? field.TrimStart('_');
                    var maps = prefixField == null ? $"{owner.Name}.{Names.Camel(field)}" : $"{owner.Name}.{Names.Camel(prefixField)}";
                    mapping.Columns.Add((column, maps));
                    break;
                }
            }
        }
    }

    /// `"_title"` or `x => x.Title` or `"Title"`.
    private static string FieldName(ExpressionSyntax? expression) => expression switch
    {
        LiteralExpressionSyntax { Token.Value: string s } => s,
        SimpleLambdaExpressionSyntax { Body: MemberAccessExpressionSyntax ma } => ma.Name.Identifier.Text,
        ParenthesizedLambdaExpressionSyntax { Body: MemberAccessExpressionSyntax ma } => ma.Name.Identifier.Text,
        _ => "",
    };

    /// Up the chain from `Property(...)`: `.HasColumnName("Title")`.
    private static string? ColumnNameIn(InvocationExpressionSyntax property)
    {
        SyntaxNode node = property;
        while (node.Parent is MemberAccessExpressionSyntax { Parent: InvocationExpressionSyntax outer } access)
        {
            if (access.Name.Identifier.Text == "HasColumnName" && outer.ArgumentList.Arguments.FirstOrDefault()?.Expression is LiteralExpressionSyntax { Token.Value: string column }) return column;
            node = outer;
        }
        return null;
    }

    private static void Apply(Tree tree, Module module, Mapping mapping, SyntaxTree syntaxTree)
    {
        if (mapping.TableName == null) return;
        var store = mapping.Schema != null ? tree.StoreBySchema.GetValueOrDefault(mapping.Schema) : module.Store;
        if (store == null || !store.Tables.TryGetValue(mapping.TableName, out var table))
        {
            tree.Out.Warn(mapping.Source != null ? tree.Line(mapping.Source) : tree.Rel(syntaxTree.FilePath), $"{mapping.Block.Name} is mapped to table {(mapping.Schema != null ? mapping.Schema + "." : "")}{mapping.TableName}, which the database project does not declare");
            return;
        }
        if (tree.AggregateOfType.TryGetValue(mapping.Block, out var aggregate))
        {
            table.Persists ??= new Persists { Aggregate = aggregate.Id, Block = aggregate.BlockId(mapping.Block) };
            table.Role ??= SymbolEqualityComparer.Default.Equals(aggregate.Root, mapping.Block) ? "aggregate-root" : "child";
            store.TableOfBlock[mapping.Block] = table;
        }
        foreach (var (columnName, maps) in mapping.Columns)
        {
            var column = table.Columns.FirstOrDefault(c => string.Equals(c.Name, columnName, StringComparison.OrdinalIgnoreCase));
            if (column != null && column.Maps == null && tree.AggregateOfType.ContainsKey(mapping.Block)) column.Maps = maps;
        }
    }

    // Who reads and writes.

    private static void ReadAdapters(Tree tree, Module module)
    {
        foreach (var syntaxTree in module.Infrastructure)
        {
            foreach (var type in tree.TypesIn(syntaxTree))
            {
                if (type.TypeKind != TypeKind.Class || type.IsAbstract) continue;
                var ports = type.AllInterfaces.Where(i => tree.PortAggregate.ContainsKey(i) || i.Name == "IAggregateStore").ToList();
                foreach (var port in ports)
                {
                    var table = tree.PortAggregate.TryGetValue(port, out var aggregate) ? TableOf(aggregate, port) : EventStoreTable(module);
                    if (table == null) continue;
                    foreach (var method in type.GetMembers().OfType<IMethodSymbol>())
                    {
                        if (method.MethodKind != MethodKind.Ordinary || method.DeclaredAccessibility != Accessibility.Public || method.IsStatic) continue;
                        AddAccess(table, OperationOf(method.Name), $"{type.Name}.{method.Name}", tree.Line(method));
                    }
                }
            }
        }
    }

    /// The table a port's calls reach: the one holding the aggregate's root,
    /// or, for an event store, the module's `Messages` table.
    public static Table? TableOf(AggregateInfo aggregate, INamedTypeSymbol port)
    {
        var store = aggregate.Module.Store;
        if (store == null) return null;
        if (aggregate.Root != null && store.TableOfBlock.TryGetValue(aggregate.Root, out var table)) return table;
        return port.Name == "IAggregateStore" ? EventStoreTable(aggregate.Module) : null;
    }

    /// Where an event-sourced module keeps its streams: SqlStreamStore's
    /// `Messages`, or `Streams` when that is all there is.
    public static Table? EventStoreTable(Module module)
    {
        var store = module.Store;
        if (store == null) return null;
        return store.Tables.GetValueOrDefault("Messages") ?? store.Tables.GetValueOrDefault("Streams");
    }

    public static string OperationOf(string method)
    {
        if (Regex.IsMatch(method, @"^(Add|Save|Insert|Update|Append|Create|Store|Put|Set|Upsert|Write)", RegexOptions.IgnoreCase)) return "write";
        if (Regex.IsMatch(method, @"^(Remove|Delete|Clear|Purge)", RegexOptions.IgnoreCase)) return "delete";
        return "read";
    }

    private static void AddAccess(Table table, string operation, string method, string source)
    {
        table.Accesses ??= new List<TableAccess>();
        if (table.Accesses.Any(a => a.Operation == operation && a.Method == method && a.Source == source)) return;
        table.Accesses.Add(new TableAccess { Operation = operation, Method = method, Source = source });
    }

    /// Every string in a node, in source order, as one SQL-ish text: plain,
    /// verbatim, raw and interpolated literals, the holes marked.
    public static string SqlText(SyntaxNode node)
    {
        var sb = new StringBuilder();
        foreach (var n in node.DescendantNodes())
        {
            switch (n)
            {
                case LiteralExpressionSyntax { Token.Value: string s }:
                    sb.Append(s).Append(' ');
                    break;
                case InterpolatedStringExpressionSyntax interpolated:
                    foreach (var content in interpolated.Contents)
                    {
                        sb.Append(content is InterpolatedStringTextSyntax text ? text.TextToken.ValueText : "?");
                    }
                    sb.Append(' ');
                    break;
            }
        }
        return sb.ToString();
    }

    private static void ReadDapper(Tree tree, Module module)
    {
        foreach (var syntaxTree in module.Application.Concat(module.Infrastructure))
        {
            var model = tree.Model(syntaxTree);
            foreach (var method in syntaxTree.GetRoot().DescendantNodes().OfType<MethodDeclarationSyntax>())
            {
                if (model.GetDeclaredSymbol(method) is not IMethodSymbol symbol) continue;
                var text = SqlText(method);
                var accesses = new List<DapperAccess>();
                var line = tree.Line(method);
                foreach (Match m in SqlTarget().Matches(text))
                {
                    var verb = m.Groups[1].Value.ToUpperInvariant();
                    var operation = verb.StartsWith("DELETE") ? "delete" : verb is "FROM" or "JOIN" ? "read" : "write";
                    var schema = m.Groups[2].Value;
                    var targetName = m.Groups[3].Value;
                    var store = tree.StoreBySchema.GetValueOrDefault(schema);
                    if (store == null) continue;
                    var target = $"{schema}.{targetName}";
                    if (accesses.Any(a => a.Target.Equals(target, StringComparison.OrdinalIgnoreCase) && a.Operation == operation)) continue;
                    var methodName = $"{symbol.ContainingType.Name}.{symbol.Name}";
                    if (store.Tables.TryGetValue(targetName, out var table))
                    {
                        AddAccess(table, operation, methodName, line);
                        if (operation != "read" && syntaxTree.FilePath.Contains("/Application/", StringComparison.Ordinal)) store.WrittenByApplication.Add(table.Name);
                        accesses.Add(new DapperAccess(store, target, operation, table, null));
                    }
                    else if (store.Views.TryGetValue(targetName, out var view))
                    {
                        foreach (var read in view.Reads ?? new List<string>())
                        {
                            var readTable = tree.StoreBySchema.Values.SelectMany(s => s.Tables.Values).FirstOrDefault(t => t.Id == read);
                            if (readTable != null) AddAccess(readTable, "read", methodName, line);
                        }
                        accesses.Add(new DapperAccess(store, target, operation, null, view));
                    }
                    else
                    {
                        tree.Out.Warn(line, $"{methodName} {(operation == "read" ? "reads" : "writes")} {target}, which the database project does not declare");
                    }
                }
                if (accesses.Count > 0) tree.DapperByMethod[symbol] = accesses;
            }
        }
    }

    /// What a table is for, when no aggregate claims it.
    private static void Roles(StoreInfo store)
    {
        foreach (var table in store.Tables.Values)
        {
            if (table.Role != null) continue;
            if (Regex.IsMatch(table.Name, @"^OutboxMessages?$", RegexOptions.IgnoreCase)) table.Role = "outbox";
            else if (store.WrittenByApplication.Contains(table.Name)) table.Role = "projection";
            else if (table.Accesses is { Count: > 0 } && table.Accesses.All(a => a.Operation == "read")) table.Role = "lookup";
            else table.Role = "other";
        }
        store.Store.Tables = store.Tables.Values.OrderBy(t => t.Name, StringComparer.Ordinal).ToList();
    }
}
