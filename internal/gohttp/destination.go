package gohttp

import (
	"go/ast"
	"go/token"
	"net/url"
	"reflect"
	"sort"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

type destinationObject map[string]catalog.HTTPBaseURL

// Keep constructor settings on the owning adapter field, never on the shared
// HTTP client type. Conflicting or unreadable construction sites invalidate
// the field instead of borrowing another instance's destination.
func (s *scanner) indexDestinations() {
	s.destinations = map[string]destinationObject{}
	candidates := map[string][]destinationObject{}
	keys := make([]string, 0, len(s.functions))
	for key := range s.functions {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		caller := s.functions[key]
		ast.Inspect(caller.fn.Body, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			target := s.functions[s.localTarget(caller, call.Fun)]
			if target == nil {
				return true
			}
			results := s.expressionResultTypes(caller, call, nil)
			if len(results) == 0 || results[0].name == "" {
				return true
			}
			object := s.destinationObject(caller, call, nil, map[string]bool{})
			// A wrapper receives a configured client; a bare Client constructor must
			// not establish a type-wide base URL shared by all its instances.
			nested := destinationObject{}
			for field, base := range object {
				if strings.Contains(field, ".") {
					nested[field] = base
				}
			}
			owner := fieldTypeKey(results[0], "")
			candidates[owner] = append(candidates[owner], nested)
			return true
		})
	}
	for owner, objects := range candidates {
		if len(objects) == 0 {
			continue
		}
		common := objects[0]
		for field, base := range common {
			for _, object := range objects[1:] {
				other, ok := object[field]
				if !ok || base.Value != other.Value || base.ConfigField != other.ConfigField || base.EnvironmentVariable != other.EnvironmentVariable || base.Kind != other.Kind {
					delete(common, field)
					break
				}
			}
		}
		if len(common) > 0 {
			s.destinations[owner] = common
		}
	}
}

// Read returned struct fields and the narrow functional-option shape
// func(value string) Option { return func(c *Client) { c.baseURL = value } }.
func (s *scanner) destinationObject(owner *functionDecl, expr ast.Expr, bound map[string]destinationObject, seen map[string]bool) destinationObject {
	if id, ok := expr.(*ast.Ident); ok {
		return bound[id.Name]
	}
	if literal := compositeLiteral(expr); literal != nil {
		result := destinationObject{}
		for _, element := range literal.Elts {
			pair, ok := element.(*ast.KeyValueExpr)
			if !ok {
				continue
			}
			for field, base := range s.destinationObject(owner, pair.Value, bound, seen) {
				result[expression(pair.Key)+"."+field] = base
			}
		}
		return result
	}
	call, ok := expr.(*ast.CallExpr)
	if !ok {
		return nil
	}
	key := s.localTarget(owner, call.Fun)
	target := s.functions[key]
	if target == nil || seen[key] {
		return nil
	}
	seen[key] = true
	defer delete(seen, key)
	args := map[string]destinationObject{}
	for i, param := range functionParams(target.fn) {
		if i < len(call.Args) {
			args[param] = s.destinationObject(owner, call.Args[i], bound, seen)
		}
	}
	// Only apply options if the constructor actually invokes each option on
	// the same local object it returns.
	var returned string
	for _, statement := range target.fn.Body.List {
		if ret, ok := statement.(*ast.ReturnStmt); ok && len(ret.Results) == 1 {
			returned = expression(ret.Results[0])
		}
	}
	optionsApplied := false
	variadic := ""
	if functionVariadic(target.fn) {
		params := functionParams(target.fn)
		variadic = params[len(params)-1]
	}
	ast.Inspect(target.fn.Body, func(n ast.Node) bool {
		loop, ok := n.(*ast.RangeStmt)
		if !ok || variadic == "" || expression(loop.X) != variadic {
			return true
		}
		for _, stmt := range loop.Body.List {
			statement, ok := stmt.(*ast.ExprStmt)
			if !ok {
				continue
			}
			invocation, ok := statement.X.(*ast.CallExpr)
			if ok && expression(invocation.Fun) == expression(loop.Value) && len(invocation.Args) == 1 && expression(invocation.Args[0]) == returned {
				optionsApplied = true
			}
		}
		return false
	})
	for _, statement := range target.fn.Body.List {
		if assign, ok := statement.(*ast.AssignStmt); ok {
			for i, left := range assign.Lhs {
				if i < len(assign.Rhs) {
					args[expression(left)] = s.destinationObject(target, assign.Rhs[i], args, seen)
				}
			}
		}
	}
	var result destinationObject
	for _, statement := range target.fn.Body.List {
		if ret, ok := statement.(*ast.ReturnStmt); ok && len(ret.Results) == 1 {
			result = s.destinationObject(target, ret.Results[0], args, seen)
		}
	}
	if result == nil {
		result = destinationObject{}
	}
	if optionsApplied && len(call.Args) >= len(functionParams(target.fn))-1 {
		start := len(functionParams(target.fn)) - 1
		for _, argument := range call.Args[start:] {
			option, ok := argument.(*ast.CallExpr)
			if !ok {
				continue
			}
			setter := s.functions[s.localTarget(owner, option.Fun)]
			if setter == nil {
				continue
			}
			params := functionParams(setter.fn)
			for _, statement := range setter.fn.Body.List {
				ret, ok := statement.(*ast.ReturnStmt)
				if !ok || len(ret.Results) != 1 {
					continue
				}
				closure, ok := ret.Results[0].(*ast.FuncLit)
				if !ok || len(closure.Type.Params.List) != 1 || len(closure.Type.Params.List[0].Names) != 1 {
					continue
				}
				receiver := closure.Type.Params.List[0].Names[0].Name
				for _, stmt := range closure.Body.List {
					assign, ok := stmt.(*ast.AssignStmt)
					if !ok || assign.Tok != token.ASSIGN || len(assign.Lhs) != 1 || len(assign.Rhs) != 1 {
						continue
					}
					field, ok := assign.Lhs[0].(*ast.SelectorExpr)
					if !ok || expression(field.X) != receiver || !looksLikeURLName(field.Sel.Name) {
						continue
					}
					for i, param := range params {
						if expression(assign.Rhs[0]) == param && i < len(option.Args) {
							base := s.destinationBase(owner, option.Args[i])
							base.OptionSource = s.source(owner.file, option.Pos()).String()
							result[field.Sel.Name] = base
						}
					}
				}
			}
		}
	}
	return result
}

func (s *scanner) destinationBase(owner *functionDecl, expr ast.Expr) catalog.HTTPBaseURL {
	base := catalog.HTTPBaseURL{Expression: expression(expr), Kind: "symbolic", Source: s.source(owner.file, expr.Pos()).String()}
	if literal, ok := expr.(*ast.BasicLit); ok && literal.Kind == token.STRING {
		base.Value, _ = strconv.Unquote(literal.Value)
		base.Kind = "literal"
		return base
	}
	selector, ok := expr.(*ast.SelectorExpr)
	if !ok {
		return base
	}
	base.ConfigField = s.symbolicValue(owner, expr, nil, map[string]bool{})
	typ, ok := s.destinationExprType(owner, selector.X)
	if !ok {
		return base
	}
	for _, file := range s.files {
		if file.dir != typ.dir {
			continue
		}
		for _, decl := range file.node.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok {
				continue
			}
			for _, spec := range gen.Specs {
				named, ok := spec.(*ast.TypeSpec)
				if !ok || named.Name.Name != typ.name {
					continue
				}
				structure, ok := named.Type.(*ast.StructType)
				if !ok {
					continue
				}
				for _, field := range structure.Fields.List {
					for _, name := range field.Names {
						if name.Name != selector.Sel.Name {
							continue
						}
						base.ConfigField = typ.name + "." + name.Name
						base.Source = s.source(file, field.Pos()).String()
						if field.Tag != nil {
							tag, _ := strconv.Unquote(field.Tag.Value)
							base.EnvironmentVariable = reflect.StructTag(tag).Get("envconfig")
							if value, exists := reflect.StructTag(tag).Lookup("default"); exists {
								base.Value = value
								base.Kind = "config-default"
							}
						}
					}
				}
			}
		}
	}
	return base
}

func (s *scanner) destinationExprType(owner *functionDecl, expr ast.Expr) (endpointType, bool) {
	if id, ok := expr.(*ast.Ident); ok {
		if owner.fn.Type.Params != nil {
			for _, field := range owner.fn.Type.Params.List {
				for _, name := range field.Names {
					if name.Name == id.Name {
						return s.typeExpression(owner.file, field.Type)
					}
				}
			}
		}
		typ, exists := s.localConcreteTypes(owner)[id.Name]
		return typ, exists
	}
	if selector, ok := expr.(*ast.SelectorExpr); ok {
		parent, exists := s.destinationExprType(owner, selector.X)
		if !exists {
			return endpointType{}, false
		}
		for _, file := range s.files {
			if file.dir != parent.dir {
				continue
			}
			for _, decl := range file.node.Decls {
				gen, ok := decl.(*ast.GenDecl)
				if !ok {
					continue
				}
				for _, spec := range gen.Specs {
					named, ok := spec.(*ast.TypeSpec)
					if !ok || named.Name.Name != parent.name {
						continue
					}
					structure, ok := named.Type.(*ast.StructType)
					if !ok {
						continue
					}
					for _, field := range structure.Fields.List {
						for _, name := range field.Names {
							if name.Name == selector.Sel.Name {
								return s.typeExpression(file, field.Type)
							}
						}
					}
				}
			}
		}
		types := s.fieldTypes[fieldTypeKey(parent, selector.Sel.Name)]
		if len(types) == 1 {
			return types[0], true
		}
	}
	return endpointType{}, false
}

func (s *scanner) destinationFor(call Call, declaration *functionDecl, origins destinationObject) *catalog.HTTPDestination {
	if call.Protocol != "HTTP" || call.template == nil {
		return nil
	}
	d := &catalog.HTTPDestination{CallSite: call.Source.String(), EndpointExpression: expression(call.template.endpoint), Method: call.Method, LocalPath: call.Path}
	// A recovered receiver binding only proves a join when source explicitly
	// concatenates that field with a path. Later runtime transformations are
	// retained separately; the full path describes this source-backed join.
	receiver := receiverVariable(declaration.fn)
	for field, base := range origins {
		if strings.Contains(field, ".") {
			continue
		}
		var join *ast.BinaryExpr
		ast.Inspect(declaration.fn.Body, func(n ast.Node) bool {
			binary, ok := n.(*ast.BinaryExpr)
			if ok && binary.Op == token.ADD && expression(binary.X) == receiver+"."+field {
				join = binary
			}
			return true
		})
		if join == nil {
			continue
		}
		ast.Inspect(declaration.fn.Body, func(n ast.Node) bool {
			assign, ok := n.(*ast.AssignStmt)
			if !ok || assign.Pos() <= join.Pos() || assign.Pos() >= call.template.endpoint.Pos() || len(assign.Lhs) != 1 || len(assign.Rhs) != 1 || expression(assign.Lhs[0]) != d.EndpointExpression {
				return true
			}
			if _, ok := assign.Rhs[0].(*ast.CallExpr); ok {
				d.Transforms = append(d.Transforms, catalog.HTTPDestinationJoin{Expression: expression(assign.Rhs[0]), Source: s.source(declaration.file, assign.Pos()).String()})
			}
			return true
		})
		d.BaseURL = &base
		d.Join = &catalog.HTTPDestinationJoin{Expression: expression(join), Source: s.source(declaration.file, join.Pos()).String()}
		if base.Value != "" && strings.HasPrefix(call.Endpoint, base.Value) {
			d.LocalPath = strings.TrimPrefix(call.Endpoint, base.Value)
			parsed, err := url.Parse(call.Endpoint)
			if err == nil && parsed.Host != "" && parsed.Path != "" && strings.HasPrefix(d.LocalPath, "/") {
				d.FullPath = parsed.Path
				host := parsed.Hostname()
				if host != "localhost" && host != "127.0.0.1" {
					d.ServiceDiscoveryAlias = host
				}
			}
		}
		return d
	}
	if parsed, err := url.Parse(call.Endpoint); err == nil && parsed.Host != "" && (parsed.Scheme == "http" || parsed.Scheme == "https") {
		d.FullPath = parsed.Path
		d.ServiceDiscoveryAlias = parsed.Hostname()
	}
	return d
}
