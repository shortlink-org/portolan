package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/token"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/internal/goscan"
	"github.com/shortlink-org/portolan/plugin"
)

const riverImport = "github.com/riverqueue/river"

// riverForeign is what River's own names are worth: QueueDefault is the
// queue called "default", and nothing in the service's tree says so.
func riverForeign(importPath, name string) (string, bool) {
	if importPath == riverImport && name == "QueueDefault" {
		return "default", true
	}
	return "", false
}

type argType struct {
	key    string
	name   string
	kind   string
	doc    string
	fields []string
	at     goscan.Source
}

type worker struct {
	key        string
	name       string
	args       string
	at         goscan.Source
	registered bool
}

type producer struct {
	args  string
	queue string
	at    goscan.Source
}

type queueJob struct {
	args      *argType
	worker    *worker
	producers []producer
}

// scanner is the tree, and what River leaves in it: the job argument types,
// the workers over them, and every Insert that names one.
type scanner struct {
	*goscan.Tree
	args       map[string]*argType
	workers    map[string]*worker
	registered map[string]bool
	producers  []producer
}

func extract(in plugin.Input, opts Options) (plugin.Response, error) {
	b := &plugin.Builder{}
	tree, err := goscan.Read(in.Root)
	if err != nil {
		return plugin.Response{}, err
	}
	tree.Foreign = riverForeign
	s := &scanner{
		Tree:       tree,
		args:       map[string]*argType{},
		workers:    map[string]*worker{},
		registered: map[string]bool{},
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
	b.File(goscan.FirstNonEmpty(opts.Out, "river.json"), string(encoded)+"\n")

	return b.Response(), nil
}

func (s *scanner) index() {
	for _, file := range s.Files {
		s.indexTypes(file)
	}
	for _, file := range s.Files {
		s.indexKindMethods(file)
		s.indexWorkers(file)
		s.indexRegistrations(file)
	}
	for key := range s.registered {
		if found := s.workers[key]; found != nil {
			found.registered = true
		}
	}
	for _, file := range s.Files {
		s.indexProducers(file)
	}
}

func (s *scanner) indexTypes(file *goscan.File) {
	for _, decl := range file.Node.Decls {
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
			key := file.Pkg + "." + spec.Name.Name
			doc := ""
			if spec.Doc != nil {
				doc = strings.TrimSpace(spec.Doc.Text())
			} else if gen.Doc != nil {
				doc = strings.TrimSpace(gen.Doc.Text())
			}
			s.args[key] = &argType{key: key, name: spec.Name.Name, doc: doc, fields: s.FieldsOf(body), at: s.At(spec.Pos())}
		}
	}
}

func (s *scanner) indexKindMethods(file *goscan.File) {
	for _, decl := range file.Node.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Recv == nil || fn.Name.Name != "Kind" || fn.Body == nil {
			continue
		}
		key := s.TypeKey(fn.Recv.List[0].Type, file)
		arg := s.args[key]
		if arg == nil {
			continue
		}
		ast.Inspect(fn.Body, func(node ast.Node) bool {
			ret, ok := node.(*ast.ReturnStmt)
			if !ok || len(ret.Results) != 1 || arg.kind != "" {
				return true
			}
			arg.kind = s.StringOf(ret.Results[0], file, map[string]bool{})
			return false
		})
		if arg.kind != "" {
			arg.at = s.At(fn.Pos())
		}
	}
}

func (s *scanner) indexWorkers(file *goscan.File) {
	for _, decl := range file.Node.Decls {
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
		key := s.TypeKey(fn.Recv.List[0].Type, file)
		s.workers[key] = &worker{key: key, name: goscan.LastSegment(key), args: args, at: s.At(fn.Pos())}
	}
}

func (s *scanner) indexRegistrations(file *goscan.File) {
	ast.Inspect(file.Node, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok || len(call.Args) < 2 {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || (sel.Sel.Name != "AddWorker" && sel.Sel.Name != "AddWorkerSafely") {
			return true
		}
		pkg, ok := sel.X.(*ast.Ident)
		if !ok || file.Imports[pkg.Name] != riverImport {
			return true
		}
		if key := s.compositeType(call.Args[1], file, nil); key != "" {
			s.registered[key] = true
		}
		return true
	})
}

func (s *scanner) indexProducers(file *goscan.File) {
	usesRiver := false
	for _, imported := range file.Imports {
		if imported == riverImport || strings.HasPrefix(imported, riverImport+"/") {
			usesRiver = true
		}
	}
	if !usesRiver {
		return
	}
	for _, decl := range file.Node.Decls {
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
						key := s.TypeKey(spec.Type, file)
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
				s.producers = append(s.producers, producer{args: key, queue: queue, at: s.At(item.Pos())})
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
			b.Warn(found.at.String(), "registered River worker "+found.name+" handles "+goscan.LastSegment(args)+", but no local Insert call reveals which queue feeds it")
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
	broker := "river." + goscan.Slug(queue)
	slugged := goscan.Slug(goscan.LastSegment(serviceID) + "-river-" + job.args.kind)
	if queue != "default" {
		slugged += "-" + goscan.Slug(queue)
	}
	doc := jobDescription(job.args)
	return catalog.Flow{
		ID:      "flow." + slugged,
		Slug:    slugged,
		Name:    goscan.Title(job.args.kind) + " job",
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

func (s *scanner) riverJobArg(expr ast.Expr, file *goscan.File) string {
	expr = goscan.Unwrap(expr)
	index, ok := expr.(*ast.IndexExpr)
	if !ok {
		return ""
	}
	sel, ok := index.X.(*ast.SelectorExpr)
	if !ok || sel.Sel.Name != "Job" {
		return ""
	}
	pkg, ok := sel.X.(*ast.Ident)
	if !ok || file.Imports[pkg.Name] != riverImport {
		return ""
	}
	return s.TypeKey(index.Index, file)
}

func (s *scanner) compositeType(expr ast.Expr, file *goscan.File, locals map[string]string) string {
	expr = goscan.Unwrap(expr)
	switch value := expr.(type) {
	case *ast.CompositeLit:
		return s.TypeKey(value.Type, file)
	case *ast.Ident:
		return locals[value.Name]
	}
	return ""
}

func (s *scanner) queueFrom(expr ast.Expr, file *goscan.File) string {
	expr = goscan.Unwrap(expr)
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
			return s.StringOf(field.Value, file, map[string]bool{})
		}
	}
	return ""
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

func stringPtr(value string) *string { return &value }
