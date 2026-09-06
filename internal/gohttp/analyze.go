// Package gohttp reads outbound HTTP-shaped calls from Go syntax without
// loading packages or downloading modules. Every result points back to the
// source expression that proves it.
package gohttp

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"go/ast"
	"go/parser"
	"go/printer"
	"go/token"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/plugins/openapi"
)

type Source struct {
	File string
	Line int
}

func (s Source) String() string {
	if s.Line == 0 {
		return s.File
	}
	return fmt.Sprintf("%s:%d", s.File, s.Line)
}

type Contract struct {
	Protocol    string
	API         string
	External    string
	Name        string
	Summary     string
	URL         string
	Source      string
	Operations  []openapi.Operation
	SOAP        []SOAPOperation
	MethodCalls map[string]openapi.Operation
}

type SOAPOperation struct {
	ID     string
	Action string
}

type Call struct {
	Function   string
	Source     Source
	Protocol   string
	Method     string
	Path       string
	Endpoint   string
	Action     string
	Request    string
	Response   string
	API        string
	ID         string
	External   string
	Contract   string
	Conditions []string
	Chain      []string
}

type FlowGroup struct {
	Function string
	Calls    []Call
	Source   Source
}

type Result struct {
	Calls     []Call
	Contracts []Contract
	Flows     []FlowGroup
	Warnings  []string
}

type parsedFile struct {
	abs       string
	rel       string
	dir       string
	pkg       string
	imports   map[string]string
	node      *ast.File
	generated bool
}

type constValue struct {
	expr ast.Expr
	file *parsedFile
}

type scanner struct {
	root      string
	fset      *token.FileSet
	files     []*parsedFile
	constants map[string]constValue
	contracts []Contract
	warnings  []string
	functions map[string]*functionDecl
	methods   map[string][]string
}

type functionDecl struct {
	key  string
	file *parsedFile
	fn   *ast.FuncDecl
}

type localEdge struct {
	target string
	line   int
}

func Analyze(root string) (Result, error) {
	s := &scanner{root: root, fset: token.NewFileSet(), constants: map[string]constValue{}, functions: map[string]*functionDecl{}, methods: map[string][]string{}}
	if err := s.read(); err != nil {
		return Result{}, err
	}
	s.indexConstants()
	s.indexFunctions()
	s.readContracts()
	s.readWSDLContracts()

	var calls []Call
	for _, file := range s.files {
		if file.generated {
			continue
		}
		for _, decl := range file.node.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}
			locals := s.localStrings(file, fn)
			function := functionKey(file, fn)
			s.walkStatements(file, function, fn.Body.List, nil, locals, &calls)
		}
	}

	sort.Slice(calls, func(i, j int) bool {
		if calls[i].Source.File != calls[j].Source.File {
			return calls[i].Source.File < calls[j].Source.File
		}
		if calls[i].Source.Line != calls[j].Source.Line {
			return calls[i].Source.Line < calls[j].Source.Line
		}
		return calls[i].ID < calls[j].ID
	})
	calls = uniqueCalls(calls)
	sort.Strings(s.warnings)
	return Result{Calls: calls, Contracts: s.contracts, Flows: s.flowGroups(calls), Warnings: s.warnings}, nil
}

func functionKey(file *parsedFile, fn *ast.FuncDecl) string {
	name := fn.Name.Name
	if fn.Recv != nil && len(fn.Recv.List) > 0 {
		name = receiverName(fn.Recv.List[0].Type) + "." + name
	}
	if file.dir != "." && file.dir != "" {
		name = file.dir + ":" + name
	}
	return name
}

func (s *scanner) indexFunctions() {
	for _, file := range s.files {
		if file.generated {
			continue
		}
		for _, decl := range file.node.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}
			key := functionKey(file, fn)
			s.functions[key] = &functionDecl{key: key, file: file, fn: fn}
			if fn.Recv != nil {
				s.methods[fn.Name.Name] = append(s.methods[fn.Name.Name], key)
			}
		}
	}
}

type wsdlDefinitions struct {
	Name            string        `xml:"name,attr"`
	TargetNamespace string        `xml:"targetNamespace,attr"`
	Bindings        []wsdlBinding `xml:"binding"`
	Services        []wsdlService `xml:"service"`
}

type wsdlBinding struct {
	Name       string          `xml:"name,attr"`
	Operations []wsdlOperation `xml:"operation"`
}

type wsdlOperation struct {
	Name    string       `xml:"name,attr"`
	Actions []wsdlAction `xml:"operation"`
}

type wsdlAction struct {
	Action string `xml:"soapAction,attr"`
}

type wsdlService struct {
	Name  string     `xml:"name,attr"`
	Ports []wsdlPort `xml:"port"`
}

type wsdlPort struct {
	Addresses []wsdlAddress `xml:"address"`
}

type wsdlAddress struct {
	Location string `xml:"location,attr"`
}

func (s *scanner) readWSDLContracts() {
	var names []string
	_ = filepath.WalkDir(s.root, func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if name != s.root && (strings.HasPrefix(entry.Name(), ".") || entry.Name() == "vendor" || entry.Name() == "node_modules") {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(strings.ToLower(entry.Name()), ".wsdl") {
			names = append(names, name)
		}
		return nil
	})
	sort.Strings(names)
	for _, name := range names {
		contents, err := os.ReadFile(name)
		if err != nil {
			continue
		}
		var doc wsdlDefinitions
		if err := xml.Unmarshal(contents, &doc); err != nil {
			s.warnings = append(s.warnings, name+": "+err.Error())
			continue
		}
		var operations []SOAPOperation
		for _, binding := range doc.Bindings {
			for _, operation := range binding.Operations {
				action := ""
				for _, candidate := range operation.Actions {
					if candidate.Action != "" {
						action = candidate.Action
						break
					}
				}
				if operation.Name != "" {
					operations = append(operations, SOAPOperation{ID: operation.Name, Action: action})
				}
			}
		}
		if len(operations) == 0 {
			continue
		}
		serviceName := doc.Name
		endpoint := ""
		for _, service := range doc.Services {
			if service.Name != "" {
				serviceName = service.Name
			}
			for _, port := range service.Ports {
				for _, address := range port.Addresses {
					if address.Location != "" {
						endpoint = address.Location
					}
				}
			}
		}
		if serviceName == "" {
			serviceName = strings.TrimSuffix(filepath.Base(name), filepath.Ext(name))
		}
		external := openapi.ExternalID(serviceName)
		rel, _ := filepath.Rel(s.root, name)
		s.contracts = append(s.contracts, Contract{
			Protocol: "SOAP", API: external + ".soap", External: external, Name: serviceName,
			URL: endpoint, Source: filepath.ToSlash(rel), SOAP: operations,
		})
	}
}

func (s *scanner) read() error {
	var names []string
	err := filepath.WalkDir(s.root, func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if name != s.root && (strings.HasPrefix(entry.Name(), ".") || entry.Name() == "vendor" || entry.Name() == "node_modules") {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(entry.Name(), ".go") || strings.HasSuffix(entry.Name(), "_test.go") {
			return nil
		}
		names = append(names, name)
		return nil
	})
	if err != nil {
		return err
	}
	sort.Strings(names)
	for _, name := range names {
		node, err := parser.ParseFile(s.fset, name, nil, parser.ParseComments)
		if err != nil {
			return fmt.Errorf("parse %s: %w", name, err)
		}
		rel, _ := filepath.Rel(s.root, name)
		file := &parsedFile{
			abs:       name,
			rel:       filepath.ToSlash(rel),
			dir:       filepath.ToSlash(filepath.Dir(rel)),
			pkg:       node.Name.Name,
			imports:   importsOf(node),
			node:      node,
			generated: generatedFile(name, node),
		}
		s.files = append(s.files, file)
	}
	return nil
}

func generatedFile(name string, node *ast.File) bool {
	base := filepath.Base(name)
	if strings.HasSuffix(base, ".gen.go") || strings.HasSuffix(base, ".generated.go") || strings.HasSuffix(base, "_generated.go") {
		return true
	}
	for _, group := range node.Comments {
		if strings.Contains(group.Text(), "Code generated") && strings.Contains(group.Text(), "DO NOT EDIT") {
			return true
		}
	}
	return false
}

func importsOf(node *ast.File) map[string]string {
	out := map[string]string{}
	for _, spec := range node.Imports {
		path, err := strconv.Unquote(spec.Path.Value)
		if err != nil {
			continue
		}
		name := filepath.Base(path)
		if spec.Name != nil {
			name = spec.Name.Name
		}
		out[name] = path
	}
	return out
}

func (s *scanner) indexConstants() {
	for _, file := range s.files {
		for _, decl := range file.node.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok || gen.Tok != token.CONST {
				continue
			}
			for _, item := range gen.Specs {
				value, ok := item.(*ast.ValueSpec)
				if !ok {
					continue
				}
				for i, name := range value.Names {
					if i >= len(value.Values) {
						continue
					}
					v := constValue{expr: value.Values[i], file: file}
					s.constants[file.dir+"."+name.Name] = v
					s.constants[file.pkg+"."+name.Name] = v
				}
			}
		}
	}
}

func (s *scanner) readContracts() {
	byDir := map[string][]*parsedFile{}
	for _, file := range s.files {
		byDir[file.dir] = append(byDir[file.dir], file)
	}
	for dir, files := range byDir {
		if !looksLikeOAPIGeneratedClient(files) {
			continue
		}
		for _, base := range []string{"openapi.yaml", "openapi.yml", "openapi.json", "swagger.yaml", "swagger.yml", "swagger.json"} {
			name := filepath.Join(s.root, filepath.FromSlash(dir), base)
			if _, err := os.Stat(name); err != nil {
				continue
			}
			spec, err := openapi.Read(name)
			if err != nil {
				s.warnings = append(s.warnings, err.Error())
				break
			}
			rel, _ := filepath.Rel(s.root, name)
			contract := Contract{
				Protocol: "HTTP",
				API:      spec.API, External: openapi.ExternalID(spec.Title), Name: spec.Title,
				Summary: spec.Description, URL: spec.DocsURL, Source: filepath.ToSlash(rel),
				Operations: spec.Operations, MethodCalls: map[string]openapi.Operation{},
			}
			matched := 0
			firstBuilder := ""
			for _, file := range files {
				for _, decl := range file.node.Decls {
					fn, ok := decl.(*ast.FuncDecl)
					if !ok || fn.Recv != nil {
						continue
					}
					opName := requestBuilderOp(fn.Name.Name)
					if opName == "" {
						continue
					}
					method, path := routeOf(fn)
					if firstBuilder == "" && (method != "" || path != "") {
						firstBuilder = method + " " + path
					}
					op, ok := spec.Find(method, path)
					if !ok {
						continue
					}
					matched++
					for _, variant := range []string{opName, opName + "WithBody", opName + "WithResponse", opName + "WithBodyWithResponse"} {
						contract.MethodCalls[variant] = op
					}
				}
			}
			if matched == 0 {
				sample := ""
				if len(spec.Operations) > 0 {
					sample = "; for example client `" + firstBuilder + "`, document `" + spec.Operations[0].Verb + " " + spec.Operations[0].Path + "`"
				}
				s.warnings = append(s.warnings, "the generated client in "+dir+" could not be matched to any route in "+contract.Source+sample)
			}
			s.contracts = append(s.contracts, contract)
			break
		}
	}
	sort.Slice(s.contracts, func(i, j int) bool { return s.contracts[i].API < s.contracts[j].API })
}

func looksLikeOAPIGeneratedClient(files []*parsedFile) bool {
	var iface, builder bool
	for _, file := range files {
		for _, decl := range file.node.Decls {
			switch d := decl.(type) {
			case *ast.GenDecl:
				for _, spec := range d.Specs {
					if ts, ok := spec.(*ast.TypeSpec); ok && ts.Name.Name == "ClientInterface" {
						_, iface = ts.Type.(*ast.InterfaceType)
					}
				}
			case *ast.FuncDecl:
				builder = builder || requestBuilderOp(d.Name.Name) != ""
			}
		}
	}
	return iface && builder
}

func requestBuilderOp(name string) string {
	rest, ok := strings.CutPrefix(name, "New")
	if !ok {
		return ""
	}
	if op, ok := strings.CutSuffix(rest, "RequestWithBody"); ok {
		return op
	}
	if op, ok := strings.CutSuffix(rest, "Request"); ok {
		return op
	}
	return ""
}

func routeOf(fn *ast.FuncDecl) (method, path string) {
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		switch n := node.(type) {
		case *ast.AssignStmt:
			if len(n.Lhs) == 1 && len(n.Rhs) == 1 {
				if id, ok := n.Lhs[0].(*ast.Ident); ok && (id.Name == "operationPath" || id.Name == "path") {
					if candidate := firstPathLiteral(n.Rhs[0]); candidate != "" {
						path = candidate
					}
				}
			}
		case *ast.CallExpr:
			if selectorName(n.Fun) == "NewRequest" || selectorName(n.Fun) == "NewRequestWithContext" {
				at := 0
				if selectorName(n.Fun) == "NewRequestWithContext" {
					at = 1
				}
				if len(n.Args) > at {
					method = httpMethod(n.Args[at])
				}
			}
		}
		return true
	})
	return method, path
}

func (s *scanner) localStrings(file *parsedFile, fn *ast.FuncDecl) map[string]string {
	out := map[string]string{}
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		assign, ok := node.(*ast.AssignStmt)
		if !ok || len(assign.Lhs) != len(assign.Rhs) {
			return true
		}
		for i, left := range assign.Lhs {
			id, ok := left.(*ast.Ident)
			if !ok {
				continue
			}
			if value := s.value(file, assign.Rhs[i], out, map[string]bool{}); value != "" {
				out[id.Name] = value
			}
		}
		return true
	})
	return out
}

func (s *scanner) walkStatements(file *parsedFile, function string, statements []ast.Stmt, conditions []string, locals map[string]string, out *[]Call) {
	for _, statement := range statements {
		switch item := statement.(type) {
		case *ast.IfStmt:
			if item.Init != nil {
				s.scanNode(file, function, item.Init, conditions, locals, out)
			}
			condition := expression(item.Cond)
			s.walkStatements(file, function, item.Body.List, appendCopy(conditions, condition), locals, out)
			if item.Else != nil {
				opposite := appendCopy(conditions, "not ("+condition+")")
				switch branch := item.Else.(type) {
				case *ast.BlockStmt:
					s.walkStatements(file, function, branch.List, opposite, locals, out)
				case *ast.IfStmt:
					s.walkStatements(file, function, []ast.Stmt{branch}, opposite, locals, out)
				}
			} else if blockTerminates(item.Body.List) {
				// An early-return guard proves that every statement following it
				// runs on the opposite path.
				conditions = appendCopy(conditions, "not ("+condition+")")
			}
		case *ast.ForStmt:
			title := "loop"
			if item.Cond != nil {
				title = expression(item.Cond)
			}
			s.walkStatements(file, function, item.Body.List, appendCopy(conditions, title), locals, out)
		case *ast.RangeStmt:
			s.walkStatements(file, function, item.Body.List, appendCopy(conditions, "for "+expression(item.X)), locals, out)
		default:
			s.scanNode(file, function, statement, conditions, locals, out)
		}
	}
}

func blockTerminates(statements []ast.Stmt) bool {
	if len(statements) == 0 {
		return false
	}
	switch last := statements[len(statements)-1].(type) {
	case *ast.ReturnStmt, *ast.BranchStmt:
		return true
	case *ast.BlockStmt:
		return blockTerminates(last.List)
	}
	return false
}

func (s *scanner) scanNode(file *parsedFile, function string, node ast.Node, conditions []string, locals map[string]string, out *[]Call) {
	ast.Inspect(node, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		if found, ok := s.call(file, function, call, conditions, locals); ok {
			*out = append(*out, found)
		}
		return true
	})
}

func (s *scanner) call(file *parsedFile, function string, call *ast.CallExpr, conditions []string, locals map[string]string) (Call, bool) {
	name := selectorName(call.Fun)
	for _, contract := range s.contracts {
		if op, ok := contract.MethodCalls[name]; ok {
			return Call{
				Function: function, Source: s.source(file, call.Pos()), Protocol: "HTTP",
				Method: op.Verb, Path: op.Path, API: contract.API, ID: op.CallID(contract.API),
				External: contract.External, Contract: contract.Source, Conditions: append([]string(nil), conditions...),
			}, true
		}
	}

	if (name == "NewRequest" || name == "NewRequestWithContext") && s.netHTTPCall(file, call.Fun) {
		if s.soapTransportFile(file) {
			return Call{}, false
		}
		methodAt, urlAt := 0, 1
		if name == "NewRequestWithContext" {
			methodAt, urlAt = 1, 2
		}
		if len(call.Args) <= urlAt {
			return Call{}, false
		}
		method := httpMethod(call.Args[methodAt])
		if method == "" {
			method = "HTTP"
		}
		endpoint := s.value(file, call.Args[urlAt], locals, map[string]bool{})
		path := pathOf(call.Args[urlAt], endpoint)
		return Call{
			Function: function, Source: s.source(file, call.Pos()), Protocol: "HTTP", Method: method,
			Path: path, Endpoint: endpoint, ID: rawCallID(method, path), Conditions: append([]string(nil), conditions...),
		}, true
	}

	if (name == "Get" || name == "Post" || name == "PostForm" || name == "Head") && s.netHTTPCall(file, call.Fun) {
		if len(call.Args) == 0 {
			return Call{}, false
		}
		endpoint := s.value(file, call.Args[0], locals, map[string]bool{})
		path := pathOf(call.Args[0], endpoint)
		return Call{Function: function, Source: s.source(file, call.Pos()), Protocol: "HTTP", Method: strings.ToUpper(strings.TrimSuffix(name, "Form")), Path: path, Endpoint: endpoint, ID: rawCallID(strings.ToUpper(strings.TrimSuffix(name, "Form")), path), Conditions: append([]string(nil), conditions...)}, true
	}

	if (name == "Call" || name == "CallContext") && len(call.Args) >= 4 && s.looksLikeSOAP(file, call) {
		actionAt := 1
		action := s.value(file, call.Args[actionAt], locals, map[string]bool{})
		if action == "" {
			action = expression(call.Args[actionAt])
		}
		request, response := expression(call.Args[actionAt+1]), expression(call.Args[actionAt+2])
		idName := action
		if idName == "" {
			idName = name
		}
		found := Call{Function: function, Source: s.source(file, call.Pos()), Protocol: "SOAP", Action: action, Request: request, Response: response, ID: "soap/" + idName, Conditions: append([]string(nil), conditions...)}
		if contract, operation, ok := s.soapContract(action); ok {
			found.API = contract.API
			found.ID = contract.API + ".SOAP/" + operation.ID
			found.External = contract.External
			found.Contract = contract.Source
			found.Endpoint = contract.URL
		}
		return found, true
	}
	return Call{}, false
}

func (s *scanner) soapContract(action string) (Contract, SOAPOperation, bool) {
	if action == "" {
		return Contract{}, SOAPOperation{}, false
	}
	for _, contract := range s.contracts {
		for _, operation := range contract.SOAP {
			if operation.Action == action || operation.ID == action || strings.HasSuffix(action, "/"+operation.ID) || strings.HasSuffix(operation.Action, "/"+action) {
				return contract, operation, true
			}
		}
	}
	return Contract{}, SOAPOperation{}, false
}

func (s *scanner) netHTTPCall(file *parsedFile, fun ast.Expr) bool {
	sel, ok := fun.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	id, ok := sel.X.(*ast.Ident)
	return ok && file.imports[id.Name] == "net/http"
}

func (s *scanner) looksLikeSOAP(file *parsedFile, call *ast.CallExpr) bool {
	for _, imported := range file.imports {
		if strings.Contains(imported, "gowsdl/soap") {
			return true
		}
	}
	if len(call.Args) > 1 && strings.Contains(strings.ToLower(expression(call.Args[1])), "action") {
		return true
	}
	return strings.Contains(strings.ToLower(file.rel), "soap")
}

func (s *scanner) soapTransportFile(file *parsedFile) bool {
	if !strings.Contains(strings.ToLower(file.rel), "soap") {
		return false
	}
	for _, imported := range file.imports {
		if strings.Contains(imported, "gowsdl/soap") {
			return true
		}
	}
	return false
}

func (s *scanner) source(file *parsedFile, pos token.Pos) Source {
	return Source{File: file.rel, Line: s.fset.Position(pos).Line}
}

func (s *scanner) value(file *parsedFile, expr ast.Expr, locals map[string]string, seen map[string]bool) string {
	switch x := expr.(type) {
	case *ast.BasicLit:
		if x.Kind == token.STRING {
			value, _ := strconv.Unquote(x.Value)
			return value
		}
	case *ast.Ident:
		if value := locals[x.Name]; value != "" {
			return value
		}
		key := file.dir + "." + x.Name
		if seen[key] {
			return ""
		}
		if constant, ok := s.constants[key]; ok {
			seen[key] = true
			return s.value(constant.file, constant.expr, locals, seen)
		}
	case *ast.SelectorExpr:
		owner, ok := x.X.(*ast.Ident)
		if !ok {
			return ""
		}
		key := owner.Name + "." + x.Sel.Name
		if imported := file.imports[owner.Name]; imported != "" {
			key = filepath.Base(imported) + "." + x.Sel.Name
		}
		if constant, ok := s.constants[key]; ok && !seen[key] {
			seen[key] = true
			return s.value(constant.file, constant.expr, locals, seen)
		}
	case *ast.BinaryExpr:
		if x.Op == token.ADD {
			left := s.value(file, x.X, locals, seen)
			right := s.value(file, x.Y, locals, seen)
			if left != "" && right != "" {
				return left + right
			}
			if right != "" {
				return expression(x.X) + right
			}
			if left != "" {
				return left + expression(x.Y)
			}
		}
	case *ast.CallExpr:
		if selectorName(x.Fun) == "Sprintf" && len(x.Args) > 0 {
			format := s.value(file, x.Args[0], locals, seen)
			if format != "" {
				return format
			}
		}
		if selectorName(x.Fun) == "String" {
			return expression(x)
		}
	}
	return ""
}

func pathOf(expr ast.Expr, endpoint string) string {
	if endpoint != "" {
		if !strings.Contains(endpoint, "://") {
			if at := strings.Index(endpoint, "/"); at >= 0 {
				return endpoint[at:]
			}
		}
		if parsed, err := url.Parse(endpoint); err == nil && parsed.Path != "" {
			if strings.HasPrefix(parsed.Path, "/") || strings.Contains(endpoint, "://") {
				return parsed.Path
			}
		}
	}
	return firstPathLiteral(expr)
}

func firstPathLiteral(expr ast.Expr) string {
	var found string
	ast.Inspect(expr, func(node ast.Node) bool {
		if found != "" {
			return false
		}
		lit, ok := node.(*ast.BasicLit)
		if !ok || lit.Kind != token.STRING {
			return true
		}
		value, _ := strconv.Unquote(lit.Value)
		if strings.HasPrefix(value, "/") {
			found = value
		}
		return true
	})
	return found
}

func httpMethod(expr ast.Expr) string {
	switch x := expr.(type) {
	case *ast.BasicLit:
		value, _ := strconv.Unquote(x.Value)
		return strings.ToUpper(value)
	case *ast.SelectorExpr:
		return strings.ToUpper(strings.TrimPrefix(x.Sel.Name, "Method"))
	case *ast.Ident:
		return ""
	}
	return expression(expr)
}

func rawCallID(method, path string) string {
	if method == "" {
		method = "HTTP"
	}
	if path == "" {
		path = "dynamic endpoint"
	}
	return "http-client/" + method + " " + path
}

func selectorName(expr ast.Expr) string {
	if sel, ok := expr.(*ast.SelectorExpr); ok {
		return sel.Sel.Name
	}
	if id, ok := expr.(*ast.Ident); ok {
		return id.Name
	}
	return ""
}

func receiverName(expr ast.Expr) string {
	switch x := expr.(type) {
	case *ast.Ident:
		return x.Name
	case *ast.StarExpr:
		return receiverName(x.X)
	case *ast.IndexExpr:
		return receiverName(x.X)
	case *ast.IndexListExpr:
		return receiverName(x.X)
	}
	return expression(expr)
}

func expression(expr ast.Expr) string {
	if expr == nil {
		return ""
	}
	var out bytes.Buffer
	_ = printer.Fprint(&out, token.NewFileSet(), expr)
	return out.String()
}

func appendCopy(items []string, value string) []string {
	out := append([]string(nil), items...)
	if value != "" {
		out = append(out, value)
	}
	return out
}

func uniqueCalls(in []Call) []Call {
	seen := map[string]bool{}
	out := make([]Call, 0, len(in))
	for _, call := range in {
		key := call.Source.String() + "\x00" + call.ID
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, call)
	}
	return out
}

func (s *scanner) flowGroups(calls []Call) []FlowGroup {
	direct := map[string][]Call{}
	for _, call := range calls {
		direct[call.Function] = append(direct[call.Function], call)
	}
	edges := map[string][]localEdge{}
	for key, fn := range s.functions {
		seen := map[string]bool{}
		ast.Inspect(fn.fn.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			if target := s.localTarget(fn, call.Fun); target != "" && target != key && !seen[target] {
				edges[key] = append(edges[key], localEdge{target: target, line: s.fset.Position(call.Pos()).Line})
				seen[target] = true
			}
			return true
		})
	}

	groups := map[string][]Call{}
	for key, group := range direct {
		groups[key] = group
	}
	for key := range s.functions {
		if !entryFunction(key) {
			continue
		}
		collected := s.collectCalls(key, edges, direct, nil, map[string]bool{}, 0)
		if len(collected) > len(direct[key]) {
			groups[key] = collected
		}
	}

	keys := make([]string, 0, len(groups))
	for key := range groups {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := make([]FlowGroup, 0, len(keys))
	for _, key := range keys {
		source := Source{}
		if fn := s.functions[key]; fn != nil {
			source = s.source(fn.file, fn.fn.Pos())
		}
		out = append(out, FlowGroup{Function: key, Calls: groups[key], Source: source})
	}
	return out
}

func (s *scanner) collectCalls(key string, edges map[string][]localEdge, direct map[string][]Call, chain []string, visiting map[string]bool, depth int) []Call {
	if depth > 6 || visiting[key] {
		return nil
	}
	visiting[key] = true
	defer delete(visiting, key)
	path := appendCopy(chain, displayFunction(key))
	type event struct {
		line   int
		call   Call
		isCall bool
		edge   *localEdge
	}
	var events []event
	for i := range direct[key] {
		events = append(events, event{line: direct[key][i].Source.Line, call: direct[key][i], isCall: true})
	}
	for i := range edges[key] {
		events = append(events, event{line: edges[key][i].line, edge: &edges[key][i]})
	}
	sort.SliceStable(events, func(i, j int) bool { return events[i].line < events[j].line })
	var out []Call
	for _, item := range events {
		if item.isCall {
			copy := item.call
			copy.Chain = append([]string(nil), path...)
			out = append(out, copy)
			continue
		}
		out = append(out, s.collectCalls(item.edge.target, edges, direct, path, visiting, depth+1)...)
	}
	return uniqueFlowCalls(out)
}

func (s *scanner) localTarget(owner *functionDecl, expr ast.Expr) string {
	switch call := expr.(type) {
	case *ast.Ident:
		candidate := call.Name
		if owner.file.dir != "." && owner.file.dir != "" {
			candidate = owner.file.dir + ":" + candidate
		}
		if s.functions[candidate] != nil {
			return candidate
		}
	case *ast.SelectorExpr:
		if ident, ok := call.X.(*ast.Ident); ok {
			if imported := owner.file.imports[ident.Name]; imported != "" {
				for key, fn := range s.functions {
					if strings.HasSuffix(imported, "/"+fn.file.dir) && displayFunction(key) == call.Sel.Name {
						return key
					}
				}
			}
		}
		if candidates := s.methods[call.Sel.Name]; len(candidates) == 1 {
			return candidates[0]
		}
	}
	return ""
}

func entryFunction(key string) bool {
	name := displayFunction(key)
	if at := strings.LastIndex(name, "."); at >= 0 {
		name = name[at+1:]
	}
	switch name {
	case "Work", "Handle", "ServeHTTP", "Consume", "Process", "Execute":
		return true
	}
	return strings.HasSuffix(name, "Action")
}

func displayFunction(key string) string {
	if _, name, ok := strings.Cut(key, ":"); ok {
		return name
	}
	return key
}

func uniqueFlowCalls(in []Call) []Call {
	seen := map[string]bool{}
	out := make([]Call, 0, len(in))
	for _, call := range in {
		key := call.Source.String() + "\x00" + call.ID
		if !seen[key] {
			seen[key] = true
			out = append(out, call)
		}
	}
	return out
}
