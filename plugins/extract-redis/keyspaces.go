package main

import (
	"go/ast"
	"go/token"
	"sort"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/internal/goscan"
)

type keyBuilder struct {
	file   *goscan.File
	params []string
	result ast.Expr
}

type keyspaceScanner struct {
	*goscan.Tree
	clientFields map[string]map[string]bool
	builders     map[string]keyBuilder
	keyspaces    map[string]*catalog.RedisKeyspace
}

func scanRedisKeyspaces(tree *goscan.Tree) []catalog.RedisKeyspace {
	s := &keyspaceScanner{
		Tree:         tree,
		clientFields: map[string]map[string]bool{},
		builders:     map[string]keyBuilder{},
		keyspaces:    map[string]*catalog.RedisKeyspace{},
	}
	s.index()
	for _, file := range tree.Files {
		for _, decl := range file.Node.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Recv == nil || fn.Body == nil {
				continue
			}
			receiverType := tree.TypeKey(fn.Recv.List[0].Type, file)
			fields := s.clientFields[receiverType]
			if len(fields) == 0 || len(fn.Recv.List[0].Names) == 0 {
				continue
			}
			s.scanMethod(file, fn, fn.Recv.List[0].Names[0].Name, fields)
		}
	}

	out := make([]catalog.RedisKeyspace, 0, len(s.keyspaces))
	for _, keyspace := range s.keyspaces {
		sort.SliceStable(keyspace.Operations, func(i, j int) bool {
			return redisOperationOrder(keyspace.Operations[i]) < redisOperationOrder(keyspace.Operations[j])
		})
		out = append(out, *keyspace)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Pattern < out[j].Pattern })
	return out
}

func (s *keyspaceScanner) index() {
	for _, file := range s.Files {
		for _, decl := range file.Node.Decls {
			switch value := decl.(type) {
			case *ast.GenDecl:
				if value.Tok != token.TYPE {
					continue
				}
				for _, raw := range value.Specs {
					spec := raw.(*ast.TypeSpec)
					body, ok := spec.Type.(*ast.StructType)
					if !ok {
						continue
					}
					key := file.Pkg + "." + spec.Name.Name
					for _, field := range body.Fields.List {
						if !isRedisClientType(file, field.Type) {
							continue
						}
						if s.clientFields[key] == nil {
							s.clientFields[key] = map[string]bool{}
						}
						for _, name := range field.Names {
							s.clientFields[key][name.Name] = true
						}
					}
				}
			case *ast.FuncDecl:
				if value.Recv != nil || value.Body == nil || value.Type.Results == nil || len(value.Type.Results.List) == 0 {
					continue
				}
				result := firstReturn(value.Body)
				if result == nil {
					continue
				}
				s.builders[file.Pkg+"."+value.Name.Name] = keyBuilder{file: file, params: parameterNames(value.Type.Params), result: result}
			}
		}
	}
}

func isRedisClientType(file *goscan.File, expr ast.Expr) bool {
	expr = goscan.Unwrap(expr)
	sel, ok := expr.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	pkg, ok := sel.X.(*ast.Ident)
	if !ok {
		return false
	}
	importPath := redisImportPath(file, pkg.Name)
	if !isRedisClientImport(importPath) {
		return false
	}
	switch sel.Sel.Name {
	case "Client", "ClusterClient":
		return true
	}
	return false
}

func firstReturn(body *ast.BlockStmt) ast.Expr {
	for _, stmt := range body.List {
		switch value := stmt.(type) {
		case *ast.ReturnStmt:
			if len(value.Results) == 1 {
				return value.Results[0]
			}
		case *ast.BlockStmt:
			if result := firstReturn(value); result != nil {
				return result
			}
		}
	}
	return nil
}

func parameterNames(fields *ast.FieldList) []string {
	if fields == nil {
		return nil
	}
	var out []string
	for _, field := range fields.List {
		for _, name := range field.Names {
			out = append(out, name.Name)
		}
	}
	return out
}

func (s *keyspaceScanner) scanMethod(file *goscan.File, fn *ast.FuncDecl, receiver string, fields map[string]bool) {
	patterns := map[string]string{}
	values := map[string]string{}
	for _, field := range fn.Type.Params.List {
		kind := s.PrintNode(field.Type)
		for _, name := range field.Names {
			patterns[name.Name] = "{" + name.Name + "}"
			values[name.Name] = kind
		}
	}

	for _, stmt := range fn.Body.List {
		s.applyAssignments(file, stmt, patterns, values)
		ast.Inspect(stmt, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			operation, keyArg, ttlArg, valueArg, ok := redisOperation(sel.Sel.Name)
			if !ok || len(call.Args) <= keyArg || !callsRedisField(sel.X, receiver, fields) {
				return true
			}
			pattern := s.patternOf(file, call.Args[keyArg], patterns, 0)
			if pattern == "" {
				return true
			}
			ttl := ""
			if ttlArg >= 0 && len(call.Args) > ttlArg {
				ttl = s.durationOf(file, call.Args[ttlArg], map[string]bool{})
			}
			value := ""
			if valueArg >= 0 && len(call.Args) > valueArg {
				value = valueType(call.Args[valueArg], values)
			}
			s.record(pattern, operation, ttl, value, s.At(call.Pos()).String())
			return true
		})
	}
}

func callsRedisField(expr ast.Expr, receiver string, fields map[string]bool) bool {
	field, ok := goscan.Unwrap(expr).(*ast.SelectorExpr)
	if !ok || !fields[field.Sel.Name] {
		return false
	}
	base, ok := goscan.Unwrap(field.X).(*ast.Ident)
	return ok && base.Name == receiver
}

func redisOperation(name string) (catalog.RedisOperation, int, int, int, bool) {
	switch name {
	case "Get", "MGet", "HGet", "HGetAll", "SMembers", "SIsMember", "LRange", "ZRange", "ZScore":
		return catalog.RedisOperationRead, 1, -1, -1, true
	case "Set", "SetNX", "SetXX":
		return catalog.RedisOperationWrite, 1, 3, 2, true
	case "HSet", "MSet", "SAdd", "LPush", "RPush", "ZAdd":
		return catalog.RedisOperationWrite, 1, -1, 2, true
	case "Del", "HDel", "SRem", "LPop", "RPop", "ZRem":
		return catalog.RedisOperationDelete, 1, -1, -1, true
	case "Exists":
		return catalog.RedisOperationExists, 1, -1, -1, true
	case "Expire", "ExpireAt":
		return catalog.RedisOperationExpire, 1, 2, -1, true
	case "Incr", "IncrBy", "Decr", "DecrBy":
		return catalog.RedisOperationCount, 1, -1, -1, true
	default:
		return "", 0, 0, 0, false
	}
}

func (s *keyspaceScanner) applyAssignments(file *goscan.File, stmt ast.Stmt, patterns, values map[string]string) {
	switch value := stmt.(type) {
	case *ast.AssignStmt:
		for i, lhs := range value.Lhs {
			name, ok := lhs.(*ast.Ident)
			if !ok || len(value.Rhs) == 0 {
				continue
			}
			rhs := value.Rhs[min(i, len(value.Rhs)-1)]
			if pattern := s.patternOf(file, rhs, patterns, 0); pattern != "" {
				patterns[name.Name] = pattern
			}
			if kind := s.valueOf(file, rhs, values); kind != "" {
				values[name.Name] = kind
			}
		}
	case *ast.IfStmt:
		branchPatterns := cloneStrings(patterns)
		branchValues := cloneStrings(values)
		for _, nested := range value.Body.List {
			s.applyAssignments(file, nested, branchPatterns, branchValues)
		}
		for name, branch := range branchPatterns {
			base := patterns[name]
			if base == "" || branch == base {
				continue
			}
			if suffix, ok := strings.CutPrefix(branch, base); ok {
				patterns[name] = base + "[" + suffix + "]"
			}
		}
	}
}

func cloneStrings(values map[string]string) map[string]string {
	out := make(map[string]string, len(values))
	for key, value := range values {
		out[key] = value
	}
	return out
}

func (s *keyspaceScanner) patternOf(file *goscan.File, expr ast.Expr, env map[string]string, depth int) string {
	if expr == nil || depth > 8 {
		return ""
	}
	switch value := goscan.Unwrap(expr).(type) {
	case *ast.BasicLit:
		if value.Kind == token.STRING {
			text, _ := strconv.Unquote(value.Value)
			return text
		}
	case *ast.Ident:
		if known := env[value.Name]; known != "" {
			return known
		}
		return s.StringOf(value, file, nil)
	case *ast.SelectorExpr:
		return s.StringOf(value, file, nil)
	case *ast.BinaryExpr:
		if value.Op == token.ADD {
			left := s.patternOf(file, value.X, env, depth+1)
			right := s.patternOf(file, value.Y, env, depth+1)
			if left != "" && right != "" {
				return left + right
			}
		}
	case *ast.CallExpr:
		if sel, ok := value.Fun.(*ast.SelectorExpr); ok && sel.Sel.Name == "Sprintf" {
			if pkg, ok := sel.X.(*ast.Ident); ok && file.Imports[pkg.Name] == "fmt" && len(value.Args) > 0 {
				format := s.patternOf(file, value.Args[0], env, depth+1)
				args := make([]string, 0, len(value.Args)-1)
				for _, arg := range value.Args[1:] {
					args = append(args, s.patternOf(file, arg, env, depth+1))
				}
				return sprintfPattern(format, args)
			}
		}
		if name, ok := value.Fun.(*ast.Ident); ok {
			if builder, found := s.builders[file.Pkg+"."+name.Name]; found {
				bound := map[string]string{}
				for i, param := range builder.params {
					if i < len(value.Args) {
						bound[param] = s.patternOf(file, value.Args[i], env, depth+1)
					}
				}
				return s.patternOf(builder.file, builder.result, bound, depth+1)
			}
		}
	}
	return ""
}

func sprintfPattern(format string, args []string) string {
	if format == "" {
		return ""
	}
	var out strings.Builder
	arg := 0
	for i := 0; i < len(format); i++ {
		if format[i] != '%' || i+1 >= len(format) {
			out.WriteByte(format[i])
			continue
		}
		if format[i+1] == '%' {
			out.WriteByte('%')
			i++
			continue
		}
		if strings.ContainsRune("sdvq", rune(format[i+1])) {
			if arg < len(args) {
				out.WriteString(args[arg])
			}
			arg++
			i++
			continue
		}
		out.WriteByte(format[i])
	}
	return out.String()
}

func (s *keyspaceScanner) durationOf(file *goscan.File, expr ast.Expr, visiting map[string]bool) string {
	switch value := goscan.Unwrap(expr).(type) {
	case *ast.BasicLit:
		if value.Value == "0" {
			return "none"
		}
		return value.Value
	case *ast.Ident:
		key := file.Pkg + "." + value.Name
		if known, ok := s.Constants[key]; ok && !visiting[key] {
			visiting[key] = true
			result := s.durationOf(known.File, known.Expr, visiting)
			delete(visiting, key)
			return result
		}
		return "caller-provided (" + value.Name + ")"
	case *ast.SelectorExpr:
		if pkg, ok := value.X.(*ast.Ident); ok && file.Imports[pkg.Name] == "time" {
			switch value.Sel.Name {
			case "Nanosecond":
				return "1ns"
			case "Microsecond":
				return "1µs"
			case "Millisecond":
				return "1ms"
			case "Second":
				return "1s"
			case "Minute":
				return "1m"
			case "Hour":
				return "1h"
			}
		}
		return "configured"
	case *ast.BinaryExpr:
		if value.Op == token.MUL {
			left := s.durationOf(file, value.X, visiting)
			right := s.durationOf(file, value.Y, visiting)
			if strings.HasPrefix(right, "1") {
				return left + strings.TrimPrefix(right, "1")
			}
		}
	}
	return s.PrintNode(expr)
}

func (s *keyspaceScanner) valueOf(file *goscan.File, expr ast.Expr, values map[string]string) string {
	switch value := goscan.Unwrap(expr).(type) {
	case *ast.Ident:
		return values[value.Name]
	case *ast.CompositeLit:
		return s.PrintNode(value.Type)
	case *ast.CallExpr:
		sel, ok := value.Fun.(*ast.SelectorExpr)
		if !ok || sel.Sel.Name != "Marshal" || len(value.Args) == 0 {
			return ""
		}
		pkg, ok := sel.X.(*ast.Ident)
		if !ok || file.Imports[pkg.Name] != "encoding/json" {
			return ""
		}
		return valueType(value.Args[0], values)
	}
	return ""
}

func valueType(expr ast.Expr, values map[string]string) string {
	switch value := goscan.Unwrap(expr).(type) {
	case *ast.Ident:
		return values[value.Name]
	case *ast.BasicLit:
		if value.Kind == token.STRING {
			return "string"
		}
	}
	return ""
}

func (s *keyspaceScanner) record(pattern string, operation catalog.RedisOperation, ttl, value, source string) {
	found := s.keyspaces[pattern]
	if found == nil {
		found = &catalog.RedisKeyspace{Pattern: pattern, Operations: []catalog.RedisOperation{}, Source: source}
		s.keyspaces[pattern] = found
	}
	if !containsOperation(found.Operations, operation) {
		found.Operations = append(found.Operations, operation)
	}
	if found.TTL == "" && ttl != "" {
		found.TTL = ttl
	}
	if found.Value == "" && value != "" {
		found.Value = value
	}
}

func containsOperation(operations []catalog.RedisOperation, wanted catalog.RedisOperation) bool {
	for _, operation := range operations {
		if operation == wanted {
			return true
		}
	}
	return false
}

func redisOperationOrder(operation catalog.RedisOperation) int {
	switch operation {
	case catalog.RedisOperationRead:
		return 0
	case catalog.RedisOperationWrite:
		return 1
	case catalog.RedisOperationDelete:
		return 2
	case catalog.RedisOperationExists:
		return 3
	case catalog.RedisOperationExpire:
		return 4
	case catalog.RedisOperationCount:
		return 5
	default:
		return 6
	}
}
