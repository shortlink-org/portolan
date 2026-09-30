package extractsql

import (
	"go/ast"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/internal/goscan"
)

// gorm: a chain on a *gorm.DB ends in the call that runs it, and that call
// says whether rows are read or written. The table is the chain's Table(...)
// when it has one, else its Model(...), else the value the final call is
// handed - First(&order) reads the orders table.
//
//	r.db.WithContext(ctx).Where("id = ?", id).First(&order)   read
//	r.db.Model(&Order{}).Where(...).Update("state", s)        write
//	tx.Delete(&OrderLine{}, "order_id = ?", id)               delete
//	r.db.Raw("SELECT ... FROM orders ...").Scan(&rows)        the SQL says

type gormTerminal struct {
	operations []catalog.TableOperation
	// dest says the call's first argument is the model when the chain names
	// none. Scan and Count take a destination that is not a model.
	dest bool
}

var (
	gormRead   = []catalog.TableOperation{catalog.TableOperationRead}
	gormWrite  = []catalog.TableOperation{catalog.TableOperationWrite}
	gormRemove = []catalog.TableOperation{catalog.TableOperationDelete}
)

var gormTerminals = map[string]gormTerminal{
	"Find":            {gormRead, true},
	"First":           {gormRead, true},
	"Last":            {gormRead, true},
	"Take":            {gormRead, true},
	"FirstOrInit":     {gormRead, true},
	"FindInBatches":   {gormRead, true},
	"Scan":            {gormRead, false},
	"Count":           {gormRead, false},
	"Pluck":           {gormRead, false},
	"Row":             {gormRead, false},
	"Rows":            {gormRead, false},
	"Create":          {gormWrite, true},
	"CreateInBatches": {gormWrite, true},
	"Save":            {gormWrite, true},
	"Updates":         {gormWrite, true},
	"UpdateColumns":   {gormWrite, true},
	"Update":          {gormWrite, false},
	"UpdateColumn":    {gormWrite, false},
	"FirstOrCreate":   {[]catalog.TableOperation{catalog.TableOperationRead, catalog.TableOperationWrite}, true},
	"Delete":          {gormRemove, true},
	"Exec":            {nil, false},
}

// gormBuilders are the chain methods that only a gorm chain has between its
// start and its end. They are what recognises a chain whose start no
// declaration types.
var gormBuilders = map[string]bool{
	"WithContext": true, "Model": true, "Table": true, "Preload": true, "Clauses": true,
	"Omit": true, "Unscoped": true, "Session": true, "Scopes": true, "Debug": true,
	"Raw": true, "Joins": true, "Where": true, "Not": true, "Or": true, "Order": true,
	"Limit": true, "Offset": true, "Distinct": true, "Group": true, "Having": true, "Select": true,
}

func isGormType(key string) bool {
	return key == gormPath+".DB" || key == gormLegacyPath+".DB"
}

func (s *site) gormCall(call *ast.CallExpr) {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return
	}
	terminal, ok := gormTerminals[sel.Sel.Name]
	if !ok {
		return
	}
	links, ok := s.gormChain(call, 0, map[string]bool{})
	if !ok || len(links) == 0 {
		return
	}
	// The terminal is the last link; everything before it shapes the query.
	shaping := links[:len(links)-1]

	// Raw and Exec carry the statement themselves.
	if sel.Sel.Name == "Exec" {
		s.gormSQL(call, call)
		return
	}
	for _, l := range shaping {
		if l.name == "Raw" {
			s.gormSQL(call, l.call)
			return
		}
	}

	var tables []string
	named := false
	for i := len(shaping) - 1; i >= 0 && !named; i-- {
		if shaping[i].name == "Table" && len(shaping[i].call.Args) > 0 {
			named = true
			values, _ := s.strings(shaping[i].call.Args[0])
			if len(values) == 0 {
				s.p.warn("gorm: the table given to Table() at " + s.at(shaping[i].call) + " is not a constant; the access is not recorded")
				return
			}
			for _, value := range values {
				if fields := strings.Fields(value); len(fields) > 0 && !strings.Contains(fields[0], "?") {
					tables = append(tables, fields[0])
				}
			}
		}
	}
	if !named {
		var model ast.Expr
		for i := len(shaping) - 1; i >= 0; i-- {
			if shaping[i].name == "Model" && len(shaping[i].call.Args) > 0 {
				model = shaping[i].call.Args[0]
				break
			}
		}
		if model == nil && terminal.dest && len(call.Args) > 0 {
			model = call.Args[0]
		}
		if model == nil {
			s.p.warn("gorm: " + sel.Sel.Name + " at " + s.at(call) + " names no model or table; the access is not recorded")
			return
		}
		table, why := s.gormModelTable(model)
		if table == "" {
			s.p.warn("gorm: " + why + "; the access at " + s.at(call) + " is not recorded")
			return
		}
		tables = append(tables, table)
	}

	for _, table := range tables {
		for _, operation := range terminal.operations {
			s.emit(call, table, operation, libraryGorm, true)
		}
	}
	// A join written as SQL names a table the chain reads as well.
	for _, l := range shaping {
		if l.name != "Joins" || len(l.call.Args) == 0 {
			continue
		}
		values, _ := s.strings(l.call.Args[0])
		for _, value := range values {
			for _, match := range readTarget.FindAllStringSubmatch(value, -1) {
				s.emit(call, match[1], catalog.TableOperationRead, libraryGorm, false)
			}
		}
	}
}

// gormSQL reads the statement a Raw or an Exec is given.
func (s *site) gormSQL(at, carrier *ast.CallExpr) {
	if len(carrier.Args) == 0 {
		return
	}
	values, built := s.strings(carrier.Args[0])
	if len(values) == 0 {
		if !built {
			s.p.warn("gorm: the statement at " + s.at(carrier) + " is not a constant; the access is not recorded")
		}
		return
	}
	for _, sql := range values {
		s.emitSQL(at, sql, libraryGorm)
	}
}

// gormChain is the part of the chain that runs on a *gorm.DB, following a
// local the chain was started in: q := r.db.Model(&Order{}); q.Count(&n).
func (s *site) gormChain(expr ast.Expr, depth int, visiting map[string]bool) ([]link, bool) {
	root, links := unroll(expr)
	if start, ok := s.libraryStart(root, links, isGormType); ok {
		return links[start:], true
	}
	if ident, ok := root.(*ast.Ident); ok && depth < 3 && !visiting[ident.Name] && s.fn.Types[ident.Name] == "" && s.locals[ident.Name] == "" {
		visiting[ident.Name] = true
		defer delete(visiting, ident.Name)
		var prefix []link
		found := false
		for _, value := range s.assigns[ident.Name] {
			if value.index != 0 {
				continue
			}
			valueRoot, valueLinks := unroll(value.expr)
			if len(valueLinks) > 0 {
				if _, ran := gormTerminals[valueLinks[len(valueLinks)-1].name]; ran {
					// rows := db.Raw(q).Rows(): what a run query hands back is
					// not a query, and its Scan is not another access.
					continue
				}
			}
			if self, ok := valueRoot.(*ast.Ident); ok && self.Name == ident.Name {
				// q = q.Where(...): an update of the chain, not its start.
				prefix = append(prefix, valueLinks...)
				continue
			}
			if more, ok := s.gormChain(value.expr, depth+1, visiting); ok {
				prefix = append(more, prefix...)
				found = true
			}
		}
		if found {
			return append(prefix, links...), true
		}
	}
	// Nothing declares what the chain starts on. It is still gorm's when the
	// file imports gorm, the start is not another package, and the chain
	// uses a method only a gorm query has before the call that runs it.
	if !s.imported[libraryGorm] || s.typeOf(root) != "" || s.packageName(root) != "" || len(links) < 2 {
		return nil, false
	}
	for _, l := range links[:len(links)-1] {
		if gormBuilders[l.name] {
			return links, true
		}
	}
	return nil, false
}

// gormModelTable is the table of the model an expression holds: the value of
// its TableName() when it declares one, gorm's name for its type otherwise.
// Empty with the reason when neither can be told.
func (s *site) gormModelTable(expr ast.Expr) (string, string) {
	key := s.typeOf(expr)
	for strings.HasPrefix(key, "[]") {
		key = strings.TrimPrefix(key, "[]")
	}
	if key == "" || key == "interface" || goscan.IsBuiltin(key) || strings.HasPrefix(key, "map[") {
		return "", "the model's type cannot be told"
	}
	name := key[strings.LastIndex(key, ".")+1:]
	for _, method := range s.p.idx.Methods[key] {
		if method.Name != "TableName" {
			continue
		}
		ret := goscan.SingleReturn(method)
		if ret == nil {
			return "", name + ".TableName() is not a single return"
		}
		var values []string
		for _, resolved := range s.p.idx.Resolve(ret, method, 0, map[string]bool{}) {
			values = append(values, resolved.Value)
		}
		if len(values) != 1 || values[0] == "" {
			return "", name + ".TableName() does not return a constant"
		}
		return values[0], ""
	}
	if !s.declared(key) {
		return "", "the model " + name + " is not declared in this module"
	}
	if s.p.naming.unknown != "" {
		return "", s.p.naming.unknown
	}
	return s.p.naming.table(name), ""
}

// readGormNaming reads the NamingStrategy a gorm.Config is given. Only a
// literal is believed; anything else leaves default names underivable, since
// the prefix a config file supplies is not in the tree.
func (p *libraryPass) readGormNaming() gormNaming {
	var found []gormNaming
	for _, file := range p.idx.Files {
		if file.Generated {
			continue
		}
		ast.Inspect(file.Node, func(node ast.Node) bool {
			lit, ok := node.(*ast.CompositeLit)
			if !ok || p.idx.TypeKey(lit.Type, file) != gormSchemaPath+".NamingStrategy" {
				return true
			}
			naming := gormNaming{}
			for _, element := range lit.Elts {
				kv, ok := element.(*ast.KeyValueExpr)
				if !ok {
					naming.unknown = "the NamingStrategy at " + p.idx.At(lit.Pos()).String() + " is not written with field names"
					break
				}
				key, _ := kv.Key.(*ast.Ident)
				if key == nil {
					continue
				}
				switch key.Name {
				case "TablePrefix":
					value := p.idx.StringOf(kv.Value, file, nil)
					if lit, ok := kv.Value.(*ast.BasicLit); value == "" && !(ok && lit.Value == `""`) {
						naming.unknown = "the NamingStrategy's TablePrefix at " + p.idx.At(kv.Pos()).String() + " is not a constant"
					}
					naming.prefix = value
				case "SingularTable":
					ident, ok := kv.Value.(*ast.Ident)
					if !ok || (ident.Name != "true" && ident.Name != "false") {
						naming.unknown = "the NamingStrategy's SingularTable at " + p.idx.At(kv.Pos()).String() + " is not a literal"
					} else {
						naming.singular = ident.Name == "true"
					}
				case "NameReplacer", "NoLowerCase":
					naming.unknown = "the NamingStrategy at " + p.idx.At(lit.Pos()).String() + " sets " + key.Name + ", which this reader does not apply"
				}
			}
			found = append(found, naming)
			return true
		})
	}
	if len(found) == 0 {
		return gormNaming{}
	}
	for _, other := range found[1:] {
		if other != found[0] {
			return gormNaming{unknown: "the module configures NamingStrategies that disagree"}
		}
	}
	return found[0]
}
