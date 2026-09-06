package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/printer"
	"go/token"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

const riverImport = "github.com/riverqueue/river"

type source struct {
	file string
	line int
}

func (s source) String() string {
	if s.line == 0 {
		return s.file
	}
	return fmt.Sprintf("%s:%d", s.file, s.line)
}

type parsedFile struct {
	name    string
	pkg     string
	imports map[string]string
	node    *ast.File
}

type constExpr struct {
	expr ast.Expr
	file *parsedFile
}

type argType struct {
	key    string
	name   string
	kind   string
	doc    string
	fields []string
	at     source
}

type worker struct {
	key        string
	name       string
	args       string
	at         source
	registered bool
}

type producer struct {
	args  string
	queue string
	at    source
}

type queueJob struct {
	args      *argType
	worker    *worker
	producers []producer
}

type scanner struct {
	root       string
	module     string
	fset       *token.FileSet
	files      []*parsedFile
	constants  map[string]constExpr
	args       map[string]*argType
	workers    map[string]*worker
	registered map[string]bool
	producers  []producer
}

func extract(in plugin.Input, opts Options) (plugin.Response, error) {
	b := &plugin.Builder{}
	s := &scanner{
		root:       in.Root,
		module:     modulePath(in.Root),
		fset:       token.NewFileSet(),
		constants:  map[string]constExpr{},
		args:       map[string]*argType{},
		workers:    map[string]*worker{},
		registered: map[string]bool{},
	}
	if err := s.read(); err != nil {
		return plugin.Response{}, err
	}
	s.index()

	serviceID := opts.Context + "." + opts.Service
	channels, flows := s.catalog(serviceID, opts.Context, b)
	if len(channels) == 0 && len(flows) == 0 {
		b.Warn(in.Root, "no River jobs joined a JobArgs.Kind declaration to an Insert call or registered Worker")
	}

	fragment := catalog.Catalog{
		GeneratedAt: in.GeneratedAt,
		Commit:      in.Commit,
		Contexts: []catalog.BoundedContext{{
			ID:   opts.Context,
			Slug: opts.Context,
			Services: []catalog.Service{{
				ID:         serviceID,
				Slug:       opts.Service,
				Provides:   []catalog.RpcService{},
				Consumes:   []catalog.RpcCall{},
				Aggregates: []catalog.Aggregate{},
				Channels:   channels,
			}},
		}},
		Defs:  map[string]catalog.TypeDef{},
		Flows: flows,
		Adrs:  []catalog.Adr{},
	}
	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}
	b.File(firstNonEmpty(opts.Out, "river.json"), string(encoded)+"\n")

	return b.Response(), nil
}

func (s *scanner) read() error {
	var names []string
	err := filepath.WalkDir(s.root, func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if name != s.root && strings.HasPrefix(entry.Name(), ".") {
				return filepath.SkipDir
			}
			switch entry.Name() {
			case ".git", ".portolan", "node_modules", "vendor":
				if name != s.root {
					return filepath.SkipDir
				}
			}
			return nil
		}
		base := entry.Name()
		if !strings.HasSuffix(base, ".go") || strings.HasSuffix(base, "_test.go") || strings.HasSuffix(base, ".gen.go") || strings.HasSuffix(base, "_generated.go") {
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
			name:    filepath.ToSlash(rel),
			pkg:     s.packagePath(filepath.Dir(name)),
			imports: importsOf(node),
			node:    node,
		}
		s.files = append(s.files, file)
	}
	return nil
}

func (s *scanner) packagePath(dir string) string {
	rel, err := filepath.Rel(s.root, dir)
	if err != nil || rel == "." {
		return s.module
	}
	return strings.TrimSuffix(s.module, "/") + "/" + filepath.ToSlash(rel)
}

func importsOf(node *ast.File) map[string]string {
	out := map[string]string{}
	for _, spec := range node.Imports {
		value, err := strconv.Unquote(spec.Path.Value)
		if err != nil {
			continue
		}
		name := path.Base(value)
		if spec.Name != nil && spec.Name.Name != "_" && spec.Name.Name != "." {
			name = spec.Name.Name
		}
		out[name] = value
	}
	return out
}

func (s *scanner) index() {
	for _, file := range s.files {
		s.indexConstants(file)
		s.indexTypes(file)
	}
	for _, file := range s.files {
		s.indexKindMethods(file)
		s.indexWorkers(file)
		s.indexRegistrations(file)
	}
	for key := range s.registered {
		if found := s.workers[key]; found != nil {
			found.registered = true
		}
	}
	for _, file := range s.files {
		s.indexProducers(file)
	}
}

func (s *scanner) indexConstants(file *parsedFile) {
	for _, decl := range file.node.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok || gen.Tok != token.CONST {
			continue
		}
		var inherited []ast.Expr
		for _, raw := range gen.Specs {
			spec := raw.(*ast.ValueSpec)
			values := spec.Values
			if len(values) == 0 {
				values = inherited
			} else {
				inherited = values
			}
			for i, name := range spec.Names {
				if len(values) == 0 {
					continue
				}
				expr := values[min(i, len(values)-1)]
				s.constants[file.pkg+"."+name.Name] = constExpr{expr: expr, file: file}
			}
		}
	}
}

func (s *scanner) indexTypes(file *parsedFile) {
	for _, decl := range file.node.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok || gen.Tok != token.TYPE {
			continue
		}
		for _, raw := range gen.Specs {
			spec := raw.(*ast.TypeSpec)
			body, ok := spec.Type.(*ast.StructType)
			if !ok {
				continue
			}
			key := file.pkg + "." + spec.Name.Name
			doc := ""
			if spec.Doc != nil {
				doc = strings.TrimSpace(spec.Doc.Text())
			} else if gen.Doc != nil {
				doc = strings.TrimSpace(gen.Doc.Text())
			}
			s.args[key] = &argType{key: key, name: spec.Name.Name, doc: doc, fields: fieldsOf(s.fset, body), at: s.at(spec.Pos())}
		}
	}
}

func (s *scanner) indexKindMethods(file *parsedFile) {
	for _, decl := range file.node.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Recv == nil || fn.Name.Name != "Kind" || fn.Body == nil {
			continue
		}
		key := s.typeKey(fn.Recv.List[0].Type, file)
		arg := s.args[key]
		if arg == nil {
			continue
		}
		ast.Inspect(fn.Body, func(node ast.Node) bool {
			ret, ok := node.(*ast.ReturnStmt)
			if !ok || len(ret.Results) != 1 || arg.kind != "" {
				return true
			}
			arg.kind = s.stringValue(ret.Results[0], file, map[string]bool{})
			return false
		})
		if arg.kind != "" {
			arg.at = s.at(fn.Pos())
		}
	}
}

func (s *scanner) indexWorkers(file *parsedFile) {
	for _, decl := range file.node.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Recv == nil || fn.Name.Name != "Work" || fn.Type.Params == nil {
			continue
		}
		var args string
		for _, field := range fn.Type.Params.List {
			if key := s.riverJobArg(field.Type, file); key != "" {
				args = key
				break
			}
		}
		if args == "" {
			continue
		}
		key := s.typeKey(fn.Recv.List[0].Type, file)
		s.workers[key] = &worker{key: key, name: lastName(key), args: args, at: s.at(fn.Pos())}
	}
}

func (s *scanner) indexRegistrations(file *parsedFile) {
	ast.Inspect(file.node, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok || len(call.Args) < 2 {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || (sel.Sel.Name != "AddWorker" && sel.Sel.Name != "AddWorkerSafely") {
			return true
		}
		pkg, ok := sel.X.(*ast.Ident)
		if !ok || file.imports[pkg.Name] != riverImport {
			return true
		}
		if key := s.compositeType(call.Args[1], file, nil); key != "" {
			s.registered[key] = true
		}
		return true
	})
}

func (s *scanner) indexProducers(file *parsedFile) {
	usesRiver := false
	for _, imported := range file.imports {
		if imported == riverImport || strings.HasPrefix(imported, riverImport+"/") {
			usesRiver = true
		}
	}
	if !usesRiver {
		return
	}
	for _, decl := range file.node.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Body == nil {
			continue
		}
		locals := map[string]string{}
		ast.Inspect(fn.Body, func(node ast.Node) bool {
			switch item := node.(type) {
			case *ast.AssignStmt:
				for i, lhs := range item.Lhs {
					name, ok := lhs.(*ast.Ident)
					if !ok || len(item.Rhs) == 0 {
						continue
					}
					rhs := item.Rhs[min(i, len(item.Rhs)-1)]
					if key := s.compositeType(rhs, file, locals); key != "" {
						locals[name.Name] = key
					}
				}
			case *ast.DeclStmt:
				gen, ok := item.Decl.(*ast.GenDecl)
				if !ok || gen.Tok != token.VAR {
					break
				}
				for _, raw := range gen.Specs {
					spec := raw.(*ast.ValueSpec)
					for i, name := range spec.Names {
						key := s.typeKey(spec.Type, file)
						if key == "" && len(spec.Values) > 0 {
							key = s.compositeType(spec.Values[min(i, len(spec.Values)-1)], file, locals)
						}
						if key != "" {
							locals[name.Name] = key
						}
					}
				}
			case *ast.CallExpr:
				sel, ok := item.Fun.(*ast.SelectorExpr)
				if !ok || (sel.Sel.Name != "Insert" && sel.Sel.Name != "InsertTx") {
					break
				}
				argIndex := 1
				if sel.Sel.Name == "InsertTx" {
					argIndex = 2
				}
				if len(item.Args) <= argIndex {
					break
				}
				key := s.compositeType(item.Args[argIndex], file, locals)
				if s.args[key] == nil || s.args[key].kind == "" {
					break
				}
				queue := "default"
				if len(item.Args) > argIndex+1 {
					if named := s.queueFrom(item.Args[argIndex+1], file); named != "" {
						queue = named
					}
				}
				s.producers = append(s.producers, producer{args: key, queue: queue, at: s.at(item.Pos())})
			}
			return true
		})
	}
}

func (s *scanner) catalog(serviceID, owner string, b *plugin.Builder) ([]catalog.Channel, []catalog.Flow) {
	workerByArgs := map[string]*worker{}
	for _, found := range s.workers {
		if found.registered {
			workerByArgs[found.args] = found
		}
	}
	queues := map[string]map[string]*queueJob{}
	for _, p := range s.producers {
		arg := s.args[p.args]
		if arg == nil || arg.kind == "" {
			continue
		}
		if queues[p.queue] == nil {
			queues[p.queue] = map[string]*queueJob{}
		}
		job := queues[p.queue][p.args]
		if job == nil {
			job = &queueJob{args: arg, worker: workerByArgs[p.args]}
			queues[p.queue][p.args] = job
		}
		job.producers = append(job.producers, p)
	}
	for args, found := range workerByArgs {
		seen := false
		for _, jobs := range queues {
			if jobs[args] != nil {
				seen = true
			}
		}
		if !seen {
			b.Warn(found.at.String(), "registered River worker "+found.name+" handles "+lastName(args)+", but no local Insert call reveals which queue feeds it")
		}
	}

	queueNames := make([]string, 0, len(queues))
	for queue := range queues {
		queueNames = append(queueNames, queue)
	}
	sort.Strings(queueNames)
	var channels []catalog.Channel
	var flows []catalog.Flow
	for _, queue := range queueNames {
		jobs := queues[queue]
		keys := make([]string, 0, len(jobs))
		for key := range jobs {
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool { return jobs[keys[i]].args.kind < jobs[keys[j]].args.kind })
		channel := catalog.Channel{
			Address:  queue,
			Kind:     catalog.ChannelKindJob,
			Title:    "River work queue",
			Doc:      "Jobs inserted and handled through github.com/riverqueue/river.",
			Messages: []catalog.ChannelMessage{},
		}
		for _, key := range keys {
			job := jobs[key]
			doc := jobDescription(job.args)
			channel.Messages = append(channel.Messages, catalog.ChannelMessage{Name: job.args.kind, Title: job.args.name, Doc: doc, Direction: catalog.ChannelSend})
			if channel.Source == "" && len(job.producers) > 0 {
				channel.Source = job.producers[0].at.String()
			}
			if job.worker == nil {
				b.Warn(job.producers[0].at.String(), "River job "+job.args.kind+" is inserted, but no registered Worker["+job.args.name+"] was found in this component")
				continue
			}
			channel.Messages = append(channel.Messages, catalog.ChannelMessage{Name: job.args.kind, Title: job.worker.name, Doc: "Handled by " + job.worker.name + ".Work. " + doc, Direction: catalog.ChannelReceive})
			flows = append(flows, riverFlow(serviceID, owner, queue, job))
		}
		channels = append(channels, channel)
	}

	return channels, flows
}

func riverFlow(serviceID, owner, queue string, job *queueJob) catalog.Flow {
	broker := "river." + slug(queue)
	slugged := slug(lastSegment(serviceID) + "-river-" + job.args.kind)
	if queue != "default" {
		slugged += "-" + slug(queue)
	}
	doc := jobDescription(job.args)
	return catalog.Flow{
		ID:      "flow." + slugged,
		Slug:    slugged,
		Name:    title(job.args.kind) + " job",
		Summary: "River job `" + job.args.kind + "` is inserted on `" + queue + "` and handled by `" + job.worker.name + ".Work`.",
		Source:  job.producers[0].at.String(),
		Owner:   owner,
		Participants: []catalog.Participant{
			{ID: serviceID, Kind: catalog.ParticipantService, Context: stringPtr(owner)},
			{ID: broker, Kind: catalog.ParticipantBroker, Label: "River · " + queue},
		},
		Steps: catalog.FlowNodes{
			&catalog.Step{Type: "step", ID: "enqueue", From: serviceID, To: broker, Kind: catalog.StepCall, Label: "enqueue " + job.args.kind, Status: catalog.StatusDeclared, Note: doc, Line: job.producers[0].at.String()},
			&catalog.Step{Type: "step", ID: "work", From: broker, To: serviceID, Kind: catalog.StepCall, Label: job.worker.name + ".Work", Status: catalog.StatusDeclared, Note: "River dispatches `" + job.args.kind + "` to the registered worker.", Line: job.worker.at.String()},
		},
	}
}

func (s *scanner) riverJobArg(expr ast.Expr, file *parsedFile) string {
	expr = unwrap(expr)
	index, ok := expr.(*ast.IndexExpr)
	if !ok {
		return ""
	}
	sel, ok := index.X.(*ast.SelectorExpr)
	if !ok || sel.Sel.Name != "Job" {
		return ""
	}
	pkg, ok := sel.X.(*ast.Ident)
	if !ok || file.imports[pkg.Name] != riverImport {
		return ""
	}
	return s.typeKey(index.Index, file)
}

func (s *scanner) compositeType(expr ast.Expr, file *parsedFile, locals map[string]string) string {
	expr = unwrap(expr)
	switch value := expr.(type) {
	case *ast.CompositeLit:
		return s.typeKey(value.Type, file)
	case *ast.Ident:
		return locals[value.Name]
	}
	return ""
}

func unwrap(expr ast.Expr) ast.Expr {
	for {
		switch value := expr.(type) {
		case *ast.ParenExpr:
			expr = value.X
		case *ast.UnaryExpr:
			expr = value.X
		case *ast.StarExpr:
			expr = value.X
		default:
			return expr
		}
	}
}

func (s *scanner) typeKey(expr ast.Expr, file *parsedFile) string {
	if expr == nil {
		return ""
	}
	expr = unwrap(expr)
	switch value := expr.(type) {
	case *ast.Ident:
		return file.pkg + "." + value.Name
	case *ast.SelectorExpr:
		pkg, ok := value.X.(*ast.Ident)
		if !ok {
			return ""
		}
		return file.imports[pkg.Name] + "." + value.Sel.Name
	}
	return ""
}

func (s *scanner) queueFrom(expr ast.Expr, file *parsedFile) string {
	expr = unwrap(expr)
	lit, ok := expr.(*ast.CompositeLit)
	if !ok {
		return ""
	}
	for _, raw := range lit.Elts {
		field, ok := raw.(*ast.KeyValueExpr)
		if !ok {
			continue
		}
		name, ok := field.Key.(*ast.Ident)
		if ok && name.Name == "Queue" {
			return s.stringValue(field.Value, file, map[string]bool{})
		}
	}
	return ""
}

func (s *scanner) stringValue(expr ast.Expr, file *parsedFile, visiting map[string]bool) string {
	switch value := expr.(type) {
	case *ast.BasicLit:
		if value.Kind == token.STRING {
			text, _ := strconv.Unquote(value.Value)
			return text
		}
	case *ast.Ident:
		return s.constantValue(file.pkg+"."+value.Name, visiting)
	case *ast.SelectorExpr:
		pkg, ok := value.X.(*ast.Ident)
		if !ok {
			return ""
		}
		imported := file.imports[pkg.Name]
		if imported == riverImport && value.Sel.Name == "QueueDefault" {
			return "default"
		}
		return s.constantValue(imported+"."+value.Sel.Name, visiting)
	}
	return ""
}

func (s *scanner) constantValue(key string, visiting map[string]bool) string {
	if visiting[key] {
		return ""
	}
	found, ok := s.constants[key]
	if !ok {
		return ""
	}
	visiting[key] = true
	value := s.stringValue(found.expr, found.file, visiting)
	delete(visiting, key)
	return value
}

func (s *scanner) at(pos token.Pos) source {
	position := s.fset.Position(pos)
	rel, err := filepath.Rel(s.root, position.Filename)
	if err != nil {
		rel = position.Filename
	}
	return source{file: filepath.ToSlash(rel), line: position.Line}
}

func fieldsOf(fset *token.FileSet, body *ast.StructType) []string {
	var out []string
	for _, field := range body.Fields.List {
		if len(field.Names) == 0 {
			continue
		}
		typeName := printNode(fset, field.Type)
		for _, ident := range field.Names {
			name := ident.Name
			if field.Tag != nil {
				tag, _ := strconv.Unquote(field.Tag.Value)
				jsonName := strings.Split(reflect.StructTag(tag).Get("json"), ",")[0]
				if jsonName == "-" {
					continue
				}
				if jsonName != "" {
					name = jsonName
				}
			}
			out = append(out, name+" "+typeName)
		}
	}
	return out
}

func printNode(fset *token.FileSet, node ast.Node) string {
	var out bytes.Buffer
	_ = printer.Fprint(&out, fset, node)
	return out.String()
}

func jobDescription(args *argType) string {
	if len(args.fields) == 0 {
		return "Arguments: `" + args.name + "`."
	}
	fields := args.fields
	suffix := ""
	if len(fields) > 10 {
		suffix = fmt.Sprintf(", and %d more", len(fields)-10)
		fields = fields[:10]
	}
	return "Arguments `" + args.name + "`: `" + strings.Join(fields, "`, `") + "`" + suffix + "."
}

func modulePath(root string) string {
	data, err := os.ReadFile(filepath.Join(root, "go.mod"))
	if err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			if value, ok := strings.CutPrefix(strings.TrimSpace(line), "module "); ok {
				return strings.TrimSpace(value)
			}
		}
	}
	return filepath.ToSlash(filepath.Clean(root))
}

func stringPtr(value string) *string { return &value }

func lastName(key string) string {
	if at := strings.LastIndex(key, "."); at >= 0 {
		return key[at+1:]
	}
	return key
}

func lastSegment(value string) string {
	if at := strings.LastIndex(value, "."); at >= 0 {
		return value[at+1:]
	}
	return value
}

func slug(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var out strings.Builder
	dash := false
	for _, r := range value {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			out.WriteRune(r)
			dash = false
		} else if out.Len() > 0 && !dash {
			out.WriteByte('-')
			dash = true
		}
	}
	return strings.TrimSuffix(out.String(), "-")
}

func title(value string) string {
	parts := strings.FieldsFunc(value, func(r rune) bool { return r == '-' || r == '_' || r == '.' })
	for i := range parts {
		if parts[i] != "" {
			parts[i] = strings.ToUpper(parts[i][:1]) + parts[i][1:]
		}
	}
	return strings.Join(parts, " ")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
