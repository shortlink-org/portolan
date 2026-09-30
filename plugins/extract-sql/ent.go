package extractsql

import (
	"go/ast"
	"path"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/internal/goscan"
)

// ent: the schema is Go. A type in ent/schema that embeds ent.Schema is a
// table - named by its entsql.Annotation when it has one, by ent's rule for
// its type name otherwise - and its Fields() are the columns. The client ent
// generates beside the schema has one field per type:
//
//	client.Order.Query().Where(...).All(ctx)   read
//	tx.Order.Create().SetState(s).Save(ctx)    write
//	client.Order.DeleteOneID(id).Exec(ctx)     delete

type entEntity struct {
	name    string
	table   string
	source  string
	columns []catalog.Column
}

var entOperations = map[string]catalog.TableOperation{
	"Query": catalog.TableOperationRead, "Get": catalog.TableOperationRead, "GetX": catalog.TableOperationRead,
	"Create": catalog.TableOperationWrite, "CreateBulk": catalog.TableOperationWrite, "MapCreateBulk": catalog.TableOperationWrite,
	"Update": catalog.TableOperationWrite, "UpdateOne": catalog.TableOperationWrite, "UpdateOneID": catalog.TableOperationWrite,
	"Delete": catalog.TableOperationDelete, "DeleteOne": catalog.TableOperationDelete, "DeleteOneID": catalog.TableOperationDelete,
}

// readEntSchemas reads every schema package, by the import path of the ent
// package generated beside it: the one the client is imported from.
func (p *libraryPass) readEntSchemas() map[string]map[string]*entEntity {
	out := map[string]map[string]*entEntity{}
	for _, file := range p.idx.Files {
		dir := path.Dir(file.Name)
		if file.Generated || (dir != "ent/schema" && !strings.HasSuffix(dir, "/ent/schema")) {
			continue
		}
		pkg := p.idx.PackagePath(p.idx.Root + "/" + path.Dir(dir))
		for _, decl := range file.Node.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok {
				continue
			}
			for _, raw := range gen.Specs {
				spec, ok := raw.(*ast.TypeSpec)
				if !ok {
					continue
				}
				body, ok := spec.Type.(*ast.StructType)
				if !ok || !p.embedsEntSchema(body, file) {
					continue
				}
				key := file.Pkg + "." + spec.Name.Name
				entity := &entEntity{name: spec.Name.Name, source: file.Name}
				entity.table = p.entTableOf(key, spec.Name.Name)
				entity.columns = p.entColumns(key)
				if out[pkg] == nil {
					out[pkg] = map[string]*entEntity{}
				}
				out[pkg][spec.Name.Name] = entity
			}
		}
	}
	return out
}

func (p *libraryPass) embedsEntSchema(body *ast.StructType, file *goscan.File) bool {
	for _, field := range body.Fields.List {
		if len(field.Names) == 0 && p.idx.TypeKey(field.Type, file) == entPath+".Schema" {
			return true
		}
	}
	return false
}

// entTableOf is the table an entity is stored in: the Table of its
// entsql.Annotation, or of the ent.Config its Config() returns, when either
// says; ent's name for the type when neither does. Empty, and reported, when
// one says through something that is not a constant.
func (p *libraryPass) entTableOf(key, name string) string {
	for _, method := range p.idx.Methods[key] {
		if (method.Name != "Annotations" && method.Name != "Config") || method.Decl.Body == nil {
			continue
		}
		table, unresolved := "", false
		ast.Inspect(method.Decl.Body, func(node ast.Node) bool {
			lit, ok := node.(*ast.CompositeLit)
			if !ok {
				return true
			}
			switch p.idx.TypeKey(lit.Type, method.File) {
			case entSQLPath + ".Annotation", entPath + ".Config":
			default:
				return true
			}
			for _, element := range lit.Elts {
				kv, ok := element.(*ast.KeyValueExpr)
				if !ok {
					continue
				}
				if ident, ok := kv.Key.(*ast.Ident); !ok || ident.Name != "Table" {
					continue
				}
				values := p.idx.Resolve(kv.Value, method, 0, map[string]bool{})
				if len(values) != 1 || values[0].Value == "" {
					unresolved = true
					p.warn("ent: the table of " + name + " at " + p.idx.At(kv.Pos()).String() + " is not a constant; its accesses are not recorded")
					continue
				}
				table = values[0].Value
			}
			return true
		})
		if unresolved {
			return ""
		}
		if table != "" {
			return table
		}
	}
	return entTable(name)
}

// entColumns reads Fields(): field.String("email").Optional() is a nullable
// email column. The id ent adds is the key, unless a field replaces it.
func (p *libraryPass) entColumns(key string) []catalog.Column {
	var columns []catalog.Column
	hasID := false
	for _, method := range p.idx.Methods[key] {
		if method.Name != "Fields" || method.Decl.Body == nil {
			continue
		}
		ast.Inspect(method.Decl.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			root, links := unroll(call)
			ident, ok := root.(*ast.Ident)
			if !ok || len(links) == 0 || method.File.Imports[ident.Name] != entFieldPath || len(links[0].call.Args) == 0 {
				return true
			}
			name := p.idx.StringOf(links[0].call.Args[0], method.File, nil)
			if name == "" {
				p.warn("ent: a field of " + key[strings.LastIndex(key, ".")+1:] + " at " + p.idx.At(call.Pos()).String() + " is not named by a constant; it is left out")
				return false
			}
			column := catalog.Column{Name: name, Type: strings.ToLower(links[0].name)}
			var values []string
			for _, l := range links[1:] {
				switch l.name {
				case "Optional", "Nillable":
					column.Nullable = true
				case "StorageKey":
					if len(l.call.Args) > 0 {
						if storage := p.idx.StringOf(l.call.Args[0], method.File, nil); storage != "" {
							column.Name = storage
						}
					}
				case "Values":
					for _, arg := range l.call.Args {
						if value := p.idx.StringOf(arg, method.File, nil); value != "" {
							values = append(values, value)
						}
					}
				}
			}
			if column.Type == "enum" && len(values) > 0 {
				column.Type = "enum(" + strings.Join(values, " | ") + ")"
			}
			if name == "id" {
				column.PK = true
				hasID = true
			}
			columns = append(columns, column)
			// The chain is read whole from its outermost call.
			return false
		})
	}
	if !hasID {
		columns = append([]catalog.Column{{Name: "id", Type: "int", PK: true}}, columns...)
	}
	return columns
}

// entCall reads client.<Type>.<Operation>(...).
func (s *site) entCall(call *ast.CallExpr) {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return
	}
	operation, ok := entOperations[sel.Sel.Name]
	if !ok {
		return
	}
	typed, ok := sel.X.(*ast.SelectorExpr)
	if !ok {
		return
	}
	client := s.typeOf(typed.X)
	for _, pkg := range sortedKeys(s.p.ent) {
		entity := s.p.ent[pkg][typed.Sel.Name]
		if entity == nil {
			continue
		}
		switch {
		case strings.HasPrefix(client, pkg+"."):
		case client == "" && s.imports(pkg):
		default:
			continue
		}
		if entity.table == "" {
			continue
		}
		s.emit(call, entity.table, operation, libraryEnt, true)
	}
}

// entTables adds the tables ent schemas declare that no migration creates:
// an ent service with no SQL migrations keeps its schema in Go.
func entTables(tables []catalog.Table, entities []entEntity, storeID string) []catalog.Table {
	known := map[string]bool{}
	for _, table := range tables {
		known[table.Name] = true
	}
	for _, entity := range entities {
		if known[entity.table] {
			continue
		}
		known[entity.table] = true
		tables = append(tables, catalog.Table{
			Evidence: []catalog.RelationEvidence{{Kind: "contract", Rule: "ent-schema", Source: entity.source, Symbol: entity.table}},
			ID:       storeID + "." + entity.table,
			Name:     entity.table,
			Columns:  entity.columns,
		})
	}
	return tables
}
