package extractgoeventgrid

import (
	"go/ast"
	"net/url"
	"path"
	"strings"

	"github.com/shortlink-org/portolan/internal/goscan"
)

type publishCall struct {
	schema string
	batch  bool
}

var publishCalls = map[string]publishCall{
	eventGridPkg + ".Client.PublishEvents":            {schema: "Event Grid schema", batch: true},
	eventGridPkg + ".Client.PublishCloudEvents":       {schema: "CloudEvents 1.0", batch: true},
	eventGridPkg + ".Client.PublishCustomEventEvents": {schema: "custom schema", batch: true},
	namespacesPkg + ".SenderClient.SendEvent":         {schema: "CloudEvents 1.0"},
	namespacesPkg + ".SenderClient.SendEvents":        {schema: "CloudEvents 1.0", batch: true},
}

type site struct {
	fn     *goscan.Function
	method string
	schema string
	batch  bool
	client ast.Expr
	events ast.Expr
	at     goscan.Source
}

type clientConfig struct {
	address     string
	title       string
	packageName string
}

func (s *scanner) sites() []site {
	var out []site
	for _, fn := range s.SortedFunctions() {
		ast.Inspect(fn.Decl.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			spec, known := publishCalls[s.ExternalKey(call, fn)]
			if !known {
				return true
			}
			found := site{fn: fn, method: sel.Sel.Name, schema: spec.schema, batch: spec.batch, client: sel.X, at: s.At(call.Pos())}
			if len(call.Args) > 1 {
				found.events = call.Args[1]
			}
			out = append(out, found)
			return true
		})
	}
	return out
}

func (s *scanner) clientConfigs(expr ast.Expr, fn *goscan.Function) []clientConfig {
	return s.followClient(expr, fn, 0, map[string]bool{})
}

func (s *scanner) followClient(expr ast.Expr, fn *goscan.Function, depth int, visiting map[string]bool) []clientConfig {
	if expr == nil || fn == nil {
		return nil
	}
	switch value := goscan.Unwrap(expr).(type) {
	case *ast.CallExpr:
		key := s.ExternalKey(value, fn)
		switch key {
		case eventGridPkg + ".NewClient", eventGridPkg + ".NewClientWithSAS", eventGridPkg + ".NewClientWithSharedKeyCredential":
			if len(value.Args) == 0 {
				return nil
			}
			return configsForEndpoints(s.stringValues(value.Args[0], fn), "Azure Event Grid topic", eventGridPkg)
		case namespacesPkg + ".NewSenderClient", namespacesPkg + ".NewSenderClientWithSharedKeyCredential":
			if len(value.Args) < 2 {
				return nil
			}
			var out []clientConfig
			for _, endpoint := range s.stringValues(value.Args[0], fn) {
				for _, topic := range s.stringValues(value.Args[1], fn) {
					name := endpointName(endpoint.Value)
					if name != "" && topic.Value != "" {
						out = append(out, clientConfig{address: name + "/" + topic.Value, title: "Azure Event Grid namespace topic", packageName: namespacesPkg})
					}
				}
			}
			return out
		}
		var out []clientConfig
		for _, target := range s.Callees(value, fn) {
			if returned := goscan.SingleReturn(target); returned != nil {
				out = append(out, s.followClient(returned, target, depth, visiting)...)
			}
		}
		return out
	case *ast.Ident:
		guard := fn.Key + ":client:" + value.Name
		if visiting[guard] {
			return nil
		}
		visiting[guard] = true
		defer delete(visiting, guard)
		if given, ok := s.AssignedTo(fn, value.Name); ok && given.Index == 0 {
			return s.followClient(given.Expr, fn, depth, visiting)
		}
		if index := goscan.ParamIndex(fn, value.Name); index >= 0 && depth < hops {
			var out []clientConfig
			for _, arg := range s.ArgsFromCallers(fn, index) {
				out = append(out, s.followClient(arg.Expr, arg.Fn, depth+1, visiting)...)
			}
			return out
		}
	case *ast.SelectorExpr:
		key := s.TypeOf(value.X, fn)
		if s.Structs[key] == nil {
			return nil
		}
		guard := "client-field:" + key + "." + value.Sel.Name
		if visiting[guard] {
			return nil
		}
		visiting[guard] = true
		defer delete(visiting, guard)
		var out []clientConfig
		for _, ctor := range s.SortedFunctions() {
			if !returns(ctor, key) {
				continue
			}
			ast.Inspect(ctor.Decl.Body, func(node ast.Node) bool {
				var given ast.Expr
				switch item := node.(type) {
				case *ast.CompositeLit:
					if s.TypeKey(item.Type, ctor.File) == key {
						given = field(item, value.Sel.Name)
					}
				case *ast.AssignStmt:
					for i, lhs := range item.Lhs {
						target, ok := lhs.(*ast.SelectorExpr)
						if ok && target.Sel.Name == value.Sel.Name && s.TypeOf(target.X, ctor) == key && i < len(item.Rhs) && len(item.Lhs) == len(item.Rhs) {
							given = item.Rhs[i]
						}
					}
				}
				if given != nil {
					out = append(out, s.followClient(given, ctor, depth, visiting)...)
				}
				return true
			})
		}
		return out
	}
	return nil
}

func (s *scanner) stringValues(expr ast.Expr, fn *goscan.Function) []goscan.Resolved {
	expr = goscan.Unwrap(expr)
	if call, ok := expr.(*ast.CallExpr); ok && len(call.Args) == 1 {
		key := s.ExternalKey(call, fn)
		if strings.HasSuffix(key, ".Ptr") || strings.HasSuffix(key, ".String") {
			expr = call.Args[0]
		}
	}
	return s.Resolve(expr, fn, 0, map[string]bool{})
}

func configsForEndpoints(values []goscan.Resolved, title, packageName string) []clientConfig {
	var out []clientConfig
	for _, value := range values {
		if name := endpointName(value.Value); name != "" {
			out = append(out, clientConfig{address: name, title: title, packageName: packageName})
		}
	}
	return out
}

func endpointName(endpoint string) string {
	parsed, err := url.Parse(endpoint)
	if err == nil && parsed.Hostname() != "" {
		host := parsed.Hostname()
		if dot := strings.IndexByte(host, '.'); dot >= 0 {
			return host[:dot]
		}
		return host
	}
	trimmed := strings.TrimRight(endpoint, "/")
	if strings.Contains(trimmed, "/") {
		return path.Base(trimmed)
	}
	return trimmed
}

func returns(fn *goscan.Function, key string) bool {
	for _, result := range fn.Results {
		if result == key {
			return true
		}
	}
	return false
}

func field(lit *ast.CompositeLit, name string) ast.Expr {
	if lit == nil {
		return nil
	}
	for _, raw := range lit.Elts {
		pair, ok := raw.(*ast.KeyValueExpr)
		if !ok {
			continue
		}
		if key, ok := pair.Key.(*ast.Ident); ok && key.Name == name {
			return pair.Value
		}
	}
	return nil
}
