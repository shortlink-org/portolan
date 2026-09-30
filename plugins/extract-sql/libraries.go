package extractsql

import (
	"go/ast"
	"go/token"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/internal/goscan"
	"github.com/shortlink-org/portolan/plugin"
)

// Table accesses that do not arrive as a SQL string in a repository package:
// the ORMs and query builders a Go service reaches its tables through.
//
// Each library is recognised by the import path of the file a call is in, and
// where the declarations say so, by the type of what the call is made on - a
// method name alone proves nothing, since Find, Get and Delete are on every
// cache and map in the tree. Because the import is the proof, these are read
// in every package of the module rather than only in repository packages: a
// sqlx query in a store package is as much an access as one in a repository.
//
// A table is taken from what the code names it by: a literal or a constant,
// a gorm model's TableName() or its type's name under gorm's naming rules, an
// ent schema's annotation or its type's name under ent's. What cannot be
// resolved that way is reported and left out, never guessed.

const (
	gormPath        = "gorm.io/gorm"
	gormLegacyPath  = "github.com/jinzhu/gorm"
	gormSchemaPath  = "gorm.io/gorm/schema"
	sqlxPath        = "github.com/jmoiron/sqlx"
	squirrelPath    = "github.com/Masterminds/squirrel"
	entPath         = "entgo.io/ent"
	entSQLPath      = "entgo.io/ent/dialect/entsql"
	entFieldPath    = "entgo.io/ent/schema/field"
	libraryGorm     = "gorm"
	librarySqlx     = "sqlx"
	librarySqlc     = "sqlc"
	libraryEnt      = "ent"
	librarySquirrel = "squirrel"
)

// libraryAccess is one access with how its table was named. named is true when
// the library's own model named the table - a gorm model, an ent schema, a
// builder's From - and false when it was read out of SQL text, where a CTE or
// a subquery alias reads like a table and an unknown name is not news.
type libraryAccess struct {
	table   string
	access  catalog.TableAccess
	library string
	named   bool
}

type libraryPass struct {
	root    string
	storeID string
	idx     *goscan.Index
	b       *plugin.Builder

	naming      gormNaming
	sqlc        map[string]map[string]*sqlcQuery
	sqlcConfigs []string
	ent         map[string]map[string]*entEntity

	callers map[string]map[string][]string
	out     []libraryAccess
	seen    map[string]bool
	warned  map[string]bool
}

// readLibraryAccesses runs every library reader over the module. entTables are
// the tables ent schemas declare, for the store to add where no migration
// creates them.
func readLibraryAccesses(root, storeID string, tree *goscan.Tree, b *plugin.Builder) ([]libraryAccess, []entEntity) {
	if tree == nil {
		return nil, nil
	}
	configs := sqlcConfigFiles(tree.Root)
	if len(configs) == 0 && !usesLibraries(tree) {
		// Nothing to read, and no reason to index the tree to find that out.
		return nil, nil
	}
	p := &libraryPass{
		root:        root,
		storeID:     storeID,
		idx:         goscan.NewIndex(tree),
		b:           b,
		sqlcConfigs: configs,
		callers:     map[string]map[string][]string{},
		seen:        map[string]bool{},
		warned:      map[string]bool{},
	}
	p.naming = p.readGormNaming()
	p.sqlc = p.readSqlcQueries()
	p.ent = p.readEntSchemas()

	// A library some file imports is looked for in every file: the struct
	// holding a *gorm.DB is often declared beside the imports and used in
	// files that have none. Only a file that imports the library itself is
	// read without a declared type to prove the call.
	libraries := map[string]bool{}
	for _, file := range tree.Files {
		for library := range p.librariesOf(file) {
			libraries[library] = true
		}
	}
	for _, file := range tree.Files {
		if file.Generated {
			continue
		}
		imported := p.librariesOf(file)
		for _, decl := range file.Node.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}
			s := p.site(file, fn)
			s.imported = imported
			consumed := map[*ast.CallExpr]bool{}
			ast.Inspect(fn.Body, func(node ast.Node) bool {
				call, ok := node.(*ast.CallExpr)
				if !ok || consumed[call] {
					return true
				}
				if libraries[libraryGorm] {
					s.gormCall(call)
				}
				if libraries[librarySqlx] {
					s.sqlxCall(call)
				}
				if libraries[librarySquirrel] {
					s.squirrelCall(call, consumed)
				}
				if libraries[libraryEnt] {
					s.entCall(call)
				}
				if libraries[librarySqlc] {
					s.sqlcCall(call)
				}
				return true
			})
		}
	}
	p.uncalledSqlcQueries()

	var tables []entEntity
	for _, pkg := range sortedKeys(p.ent) {
		for _, name := range sortedKeys(p.ent[pkg]) {
			if entity := p.ent[pkg][name]; entity.table != "" {
				tables = append(tables, *entity)
			}
		}
	}
	return p.out, tables
}

// usesLibraries says whether anything in the tree imports a library read
// here, or declares a query sqlc generated.
func usesLibraries(tree *goscan.Tree) bool {
	for _, file := range tree.Files {
		for _, importPath := range file.Imports {
			switch {
			case importPath == gormPath, importPath == gormLegacyPath, importPath == sqlxPath, importPath == squirrelPath,
				importPath == entPath, strings.HasPrefix(importPath, entPath+"/"):
				return true
			}
		}
	}
	for _, constant := range tree.Constants {
		if lit, ok := constant.Expr.(*ast.BasicLit); ok && lit.Kind == token.STRING && sqlcName.MatchString(unquote(lit.Value)) {
			return true
		}
	}
	return false
}

// librariesOf is which libraries a file can be using, by what it imports.
func (p *libraryPass) librariesOf(file *goscan.File) map[string]bool {
	out := map[string]bool{}
	imported := map[string]bool{}
	for _, importPath := range file.Imports {
		imported[importPath] = true
		switch importPath {
		case gormPath, gormLegacyPath:
			out[libraryGorm] = true
		case sqlxPath:
			out[librarySqlx] = true
		case squirrelPath:
			out[librarySquirrel] = true
		}
	}
	for pkg := range p.ent {
		if imported[pkg] {
			out[libraryEnt] = true
		}
	}
	for pkg := range p.sqlc {
		if imported[pkg] || file.Pkg == pkg {
			out[librarySqlc] = true
		}
	}
	return out
}

// site is one function being read: what its names are typed as and were
// assigned, and which repository methods an access inside it is credited to.
type site struct {
	p       *libraryPass
	file    *goscan.File
	fn      *goscan.Function
	locals  map[string]string
	assigns map[string][]assigned
	methods []string
	// imported is the libraries the function's file imports: the ones a
	// call may be taken for without a declared type saying so.
	imported map[string]bool
	// inheritedKind is the call that started a squirrel builder this chain
	// continues from a local.
	inheritedKind string
}

type assigned struct {
	expr  ast.Expr
	index int
}

func (p *libraryPass) site(file *goscan.File, decl *ast.FuncDecl) *site {
	key := file.Pkg + "." + decl.Name.Name
	if decl.Recv != nil && len(decl.Recv.List) > 0 {
		key = p.idx.TypeKey(decl.Recv.List[0].Type, file) + "." + decl.Name.Name
	}
	fn := p.idx.Functions[key]
	if fn == nil || fn.Decl != decl {
		fn = &goscan.Function{Key: key, Name: decl.Name.Name, File: file, Decl: decl, Types: map[string]string{}}
	}
	s := &site{p: p, file: file, fn: fn, locals: map[string]string{}, assigns: map[string][]assigned{}}
	s.readLocals(decl.Body)

	dir := path.Dir(file.Name)
	callers, ok := p.callers[dir]
	if !ok {
		var files []*ast.File
		for _, f := range p.idx.PackageFiles(dir) {
			files = append(files, f.Node)
		}
		callers = sqlMethodCallers(files)
		p.callers[dir] = callers
	}
	s.methods = outermostSQLMethods(sqlMethodName(decl), callers)
	return s
}

// readLocals records what the function's own names are: the parameters of
// its closures, its typed var declarations, what each name was assigned and
// the element type a range loop walks - the places a transaction or a model
// variable is declared that the index, which reads declarations, does not.
func (s *site) readLocals(body *ast.BlockStmt) {
	idx, file := s.p.idx, s.file
	ast.Inspect(body, func(node ast.Node) bool {
		switch n := node.(type) {
		case *ast.FuncLit:
			if n.Type.Params != nil {
				for _, field := range n.Type.Params.List {
					key := idx.TypeKey(field.Type, file)
					for _, name := range field.Names {
						s.locals[name.Name] = key
					}
				}
			}
		case *ast.ValueSpec:
			if n.Type != nil {
				key := idx.TypeKey(n.Type, file)
				for _, name := range n.Names {
					s.locals[name.Name] = key
				}
			}
			for i, name := range n.Names {
				if len(n.Values) == len(n.Names) {
					s.assigns[name.Name] = append(s.assigns[name.Name], assigned{expr: n.Values[i]})
				} else if len(n.Values) == 1 {
					s.assigns[name.Name] = append(s.assigns[name.Name], assigned{expr: n.Values[0], index: i})
				}
			}
		case *ast.AssignStmt:
			for i, lhs := range n.Lhs {
				ident, ok := lhs.(*ast.Ident)
				if !ok || ident.Name == "_" {
					continue
				}
				var value assigned
				switch {
				case len(n.Rhs) == len(n.Lhs):
					value = assigned{expr: n.Rhs[i]}
				case len(n.Rhs) == 1:
					value = assigned{expr: n.Rhs[0], index: i}
				default:
					continue
				}
				s.assigns[ident.Name] = append(s.assigns[ident.Name], value)
				if value.index == 0 && n.Tok == token.DEFINE {
					if key := s.constructed(value.expr); key != "" {
						s.locals[ident.Name] = key
					}
				}
			}
		}
		return true
	})
	ast.Inspect(body, func(node ast.Node) bool {
		loop, ok := node.(*ast.RangeStmt)
		if !ok {
			return true
		}
		value, ok := loop.Value.(*ast.Ident)
		if !ok || value.Name == "_" {
			return true
		}
		if over := s.typeOf(loop.X); strings.HasPrefix(over, "[]") {
			s.locals[value.Name] = strings.TrimPrefix(over, "[]")
		}
		return true
	})
}

// constructed is the type an expression builds on the spot: T{}, &T{},
// []T{}, new(T), make([]T, n).
func (s *site) constructed(expr ast.Expr) string {
	switch value := goscan.Unwrap(expr).(type) {
	case *ast.CompositeLit:
		return s.p.idx.TypeKey(value.Type, s.file)
	case *ast.CallExpr:
		if ident, ok := value.Fun.(*ast.Ident); ok && len(value.Args) > 0 && (ident.Name == "new" || ident.Name == "make") {
			return s.p.idx.TypeKey(value.Args[0], s.file)
		}
	}
	return ""
}

// typeOf is the type key of an expression, as far as the declarations and
// the function's own names say. Empty when nothing does.
func (s *site) typeOf(expr ast.Expr) string {
	switch value := goscan.Unwrap(expr).(type) {
	case *ast.Ident:
		if key := s.fn.Types[value.Name]; key != "" {
			return key
		}
		if key := s.locals[value.Name]; key != "" {
			return key
		}
	case *ast.CompositeLit:
		return s.p.idx.TypeKey(value.Type, s.file)
	case *ast.SelectorExpr:
		if st := s.p.idx.Structs[s.typeOf(value.X)]; st != nil {
			return st.Fields[value.Sel.Name]
		}
	}
	if s.fn.Decl == nil {
		return ""
	}
	return s.p.idx.TypeOf(expr, s.fn)
}

// packageName is the import path a bare name refers to, when it is an
// imported package rather than a variable of the same name.
func (s *site) packageName(expr ast.Expr) string {
	ident, ok := expr.(*ast.Ident)
	if !ok {
		return ""
	}
	if s.fn.Types[ident.Name] != "" || s.locals[ident.Name] != "" || len(s.assigns[ident.Name]) > 0 {
		return ""
	}
	return s.file.Imports[ident.Name]
}

// declared says whether a type key is one the module itself declares.
func (s *site) declared(key string) bool {
	return s.p.idx.Named[key]
}

// link is one call of a method chain: db.Where(...).First(&o) is Where, then
// First.
type link struct {
	name string
	call *ast.CallExpr
}

// unroll takes a chain apart, innermost call first, down to the expression
// the first call is made on.
func unroll(expr ast.Expr) (ast.Expr, []link) {
	var links []link
	for {
		call, ok := expr.(*ast.CallExpr)
		if !ok {
			break
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			break
		}
		links = append(links, link{name: sel.Sel.Name, call: call})
		expr = sel.X
	}
	for i, j := 0, len(links)-1; i < j; i, j = i+1, j-1 {
		links[i], links[j] = links[j], links[i]
	}
	return expr, links
}

// libraryStart is where in a chain the library's own value begins: the first
// link whose receiver is typed as one of the library's types. r.conn().
// Where(...) starts at Where when conn is declared to return *gorm.DB.
func (s *site) libraryStart(root ast.Expr, links []link, library func(string) bool) (int, bool) {
	receiver := s.typeOf(root)
	for i := range links {
		if library(receiver) {
			return i, true
		}
		results := s.p.idx.ResultsOf(links[i].call, s.fn)
		if len(results) == 0 {
			return 0, false
		}
		receiver = results[0]
	}
	return 0, false
}

// strings is every value an expression can be: a literal, a constant, a
// local, a parameter by what its callers pass. built says it was produced by
// a query builder's ToSql, which that builder's own reader accounts for.
func (s *site) strings(expr ast.Expr) (values []string, built bool) {
	return s.stringsDepth(expr, 0)
}

func (s *site) stringsDepth(expr ast.Expr, depth int) ([]string, bool) {
	if depth > 3 {
		return nil, false
	}
	expr = goscan.Unwrap(expr)
	if call, ok := expr.(*ast.CallExpr); ok {
		if sel, ok := call.Fun.(*ast.SelectorExpr); ok {
			switch sel.Sel.Name {
			case "Rebind":
				if len(call.Args) > 0 {
					return s.stringsDepth(call.Args[len(call.Args)-1], depth+1)
				}
			case "In", "Named":
				if len(call.Args) > 0 && s.packageName(sel.X) == sqlxPath {
					return s.stringsDepth(call.Args[0], depth+1)
				}
			case "ToSql", "ToSQL":
				return nil, true
			}
		}
	}
	if ident, ok := expr.(*ast.Ident); ok && s.fn.Types[ident.Name] == "" {
		values := s.assigns[ident.Name]
		for i := len(values) - 1; i >= 0; i-- {
			value := values[i]
			// query = db.Rebind(query) changes the placeholders, not the
			// statement: what it was before is what it is.
			if call, ok := goscan.Unwrap(value.expr).(*ast.CallExpr); ok && len(call.Args) > 0 {
				if sel, ok := call.Fun.(*ast.SelectorExpr); ok && sel.Sel.Name == "Rebind" {
					if same, ok := call.Args[len(call.Args)-1].(*ast.Ident); ok && same.Name == ident.Name {
						continue
					}
				}
			}
			if value.index != 0 {
				// Only the first result of a call - query, args, err :=
				// sqlx.In(...) - is followed; a later one is not a statement.
				return nil, false
			}
			return s.stringsDepth(value.expr, depth+1)
		}
	}

	var out []string
	for _, resolved := range s.p.idx.Resolve(expr, s.fn, 0, map[string]bool{}) {
		out = append(out, resolved.Value)
	}
	if len(out) > 0 {
		return out, false
	}
	// `SELECT ... FROM orders ` + where still names its table: the literal
	// parts are kept and an unknown part reads as a space, the way the raw
	// reader reads a statement.
	if binary, ok := expr.(*ast.BinaryExpr); ok && binary.Op == token.ADD {
		left, _ := s.stringsDepth(binary.X, depth+1)
		right, _ := s.stringsDepth(binary.Y, depth+1)
		if len(left) == 0 && len(right) == 0 {
			return nil, false
		}
		if len(left) == 0 {
			left = []string{""}
		}
		if len(right) == 0 {
			right = []string{""}
		}
		for _, a := range left {
			for _, b := range right {
				out = append(out, a+" "+b)
			}
		}
	}
	return out, false
}

// source is where a call is, spelled the way the raw reader spells it.
func (s *site) source(node ast.Node) string {
	position := s.p.idx.Fset.Position(node.Pos())
	return filepath.ToSlash(filepath.Join(s.p.root, filepath.FromSlash(s.file.Name))) + ":" + itoa(position.Line)
}

// at is where a node is relative to the root, for a warning.
func (s *site) at(node ast.Node) string {
	return s.p.idx.At(node.Pos()).String()
}

func (s *site) emit(node ast.Node, table string, operation catalog.TableOperation, library string, named bool) {
	s.p.emit(s.methods, s.source(node), table, operation, library, named)
}

func (p *libraryPass) emit(methods []string, source, table string, operation catalog.TableOperation, library string, named bool) {
	table = sqlRelationName(table)
	if table == "" {
		return
	}
	for _, method := range methods {
		key := table + "\x00" + string(operation) + "\x00" + method + "\x00" + source
		if p.seen[key] {
			continue
		}
		p.seen[key] = true
		p.out = append(p.out, libraryAccess{
			table:   table,
			access:  catalog.TableAccess{Operation: operation, Method: method, Source: source},
			library: library,
			named:   named,
		})
	}
}

// emitSQL records what a statement does to each table it names.
func (s *site) emitSQL(node ast.Node, sql, library string) {
	for _, found := range sqlTableAccesses(sql, "", s.source(node)) {
		s.p.emit(s.methods, found.access.Source, found.table, found.access.Operation, library, false)
	}
}

func (p *libraryPass) warn(message string) {
	if p.warned[message] {
		return
	}
	p.warned[message] = true
	p.b.Warn(p.storeID, message)
}

// mergeLibraryAccesses adds what the libraries prove to what the raw SQL
// readers proved. A method the raw reader already credits with an operation
// on a table gains nothing from a second proof of it.
func mergeLibraryAccesses(into map[string][]catalog.TableAccess, found []libraryAccess) {
	known := map[string]bool{}
	for table, accesses := range into {
		for _, access := range accesses {
			known[table+"\x00"+string(access.Operation)+"\x00"+access.Method] = true
		}
	}
	for _, access := range found {
		key := access.table + "\x00" + string(access.access.Operation) + "\x00" + access.access.Method
		if known[key] {
			continue
		}
		known[key] = true
		into[access.table] = append(into[access.table], access.access)
	}
}

// warnUnknownTables reports an ORM-named table no migration or schema here
// creates: the access is real, and silence would read as a model mapped to
// nothing. Tables read out of SQL text are left alone - a CTE reads like a
// table there.
func warnUnknownTables(tables []catalog.Table, found []libraryAccess, b *plugin.Builder, storeID string) {
	if len(tables) == 0 {
		return
	}
	known := map[string]bool{}
	for _, table := range tables {
		known[table.Name] = true
		known[lastNamePart(table.Name)] = true
	}
	reported := map[string]bool{}
	for _, access := range found {
		if !access.named || known[access.table] || reported[access.table] {
			continue
		}
		reported[access.table] = true
		b.Warn(storeID, access.library+" in "+access.access.Method+" names table "+access.table+", which no migration or schema here creates")
	}
}

func sortedKeys[T any](values map[string]T) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
