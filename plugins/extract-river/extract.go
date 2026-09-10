package extractriver

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/token"
	"path"
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

// inserts is River's insert surface: the method, and where in its arguments
// the job (or the batch of jobs) is. The options follow the job.
var inserts = map[string]struct {
	args  int
	batch bool
}{
	"Insert":           {1, false},
	"InsertTx":         {2, false},
	"InsertMany":       {1, true},
	"InsertManyTx":     {2, true},
	"InsertManyFast":   {1, true},
	"InsertManyFastTx": {2, true},
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
	entrypoint string
	at         goscan.Source
	registered bool
}

type producer struct {
	args       string
	queue      string
	entrypoint string
	at         goscan.Source
}

type queueJob struct {
	args      *argType
	worker    *worker
	producers []producer
}

// scanner is the shared Go index, and what River leaves in it: the job
// argument types, the workers over them, every Insert that names one, and
// the queues the client is configured to work.
type scanner struct {
	*goscan.Index
	args       map[string]*argType
	workers    map[string]*worker
	registered map[string]bool
	producers  []producer
	// fed is every args type some Insert in the tree names, whether or not
	// its queue resolved: the difference between "no producer here" and "a
	// producer this reader could not follow".
	fed map[string]bool
	// queues is what river.Config.Queues lists, in a fixed order; empty when
	// the tree builds no client or builds it in a way not read here.
	queues []string
}

func extract(in plugin.Input, opts Options) (plugin.Response, error) {
	b := &plugin.Builder{}
	tree, err := goscan.Read(in.Root)
	if err != nil {
		return plugin.Response{}, err
	}
	tree.Foreign = riverForeign
	s := &scanner{
		Index:      goscan.NewIndex(tree),
		args:       map[string]*argType{},
		workers:    map[string]*worker{},
		registered: map[string]bool{},
		fed:        map[string]bool{},
	}
	s.index(b)

	serviceID := opts.Context + "." + opts.Service
	channels, flows := s.catalog(serviceID, opts.Context, b)
	if len(channels) == 0 && len(flows) == 0 {
		b.Warn(in.Root, "no River jobs joined a JobArgs.Kind declaration to an Insert call or registered Worker")
	}

	fragment := catalog.Catalog{
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

func (s *scanner) index(b *plugin.Builder) {
	for _, file := range s.Files {
		s.indexTypes(file)
	}
	s.indexKindMethods()
	s.indexWorkers()
	for _, fn := range s.SortedFunctions() {
		s.indexRegistrations(fn)
		s.indexClientQueues(fn)
	}
	for key := range s.registered {
		if found := s.workers[key]; found != nil {
			found.registered = true
		}
	}
	for _, fn := range s.SortedFunctions() {
		s.indexProducers(fn, b)
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

// indexKindMethods reads `func (X) Kind() string`: the wire name of the job,
// a literal, a constant or a `string(...)` of one.
func (s *scanner) indexKindMethods() {
	for key, arg := range s.args {
		fn := s.Functions[key+".Kind"]
		if fn == nil || fn.Decl.Body == nil {
			continue
		}
		ast.Inspect(fn.Decl.Body, func(node ast.Node) bool {
			ret, ok := node.(*ast.ReturnStmt)
			if !ok || len(ret.Results) != 1 || arg.kind != "" {
				return true
			}
			if values := s.Resolve(ret.Results[0], fn, 0, map[string]bool{}); len(values) == 1 {
				arg.kind = values[0].Value
			}
			return false
		})
		if arg.kind != "" {
			arg.at = s.At(fn.Decl.Pos())
		}
	}
}

// indexWorkers reads `func (*W) Work(ctx, *river.Job[Args])`: the worker,
// and the args type it is over.
func (s *scanner) indexWorkers() {
	for _, fn := range s.SortedFunctions() {
		if fn.Name != "Work" || fn.Receiver == "" || fn.Decl.Type.Params == nil {
			continue
		}
		var args string
		for _, field := range fn.Decl.Type.Params.List {
			if key := s.riverJobArg(field.Type, fn.File); key != "" {
				args = key
				break
			}
		}
		if args == "" {
			continue
		}
		s.workers[fn.Receiver] = &worker{
			key: fn.Receiver, name: goscan.LastSegment(fn.Receiver), args: args,
			entrypoint: functionKey(fn),
			at:         s.At(fn.Decl.Pos()),
		}
	}
}

// indexRegistrations reads `river.AddWorker(workers, w)`: w may be a
// literal, a local, a constructor's result or a parameter the callers fill.
func (s *scanner) indexRegistrations(fn *goscan.Function) {
	ast.Inspect(fn.Decl.Body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok || len(call.Args) < 2 {
			return true
		}
		if key := s.ExternalKey(call, fn); key != riverImport+".AddWorker" && key != riverImport+".AddWorkerSafely" {
			return true
		}
		for _, key := range s.TypesOf(call.Args[1], fn, 0, map[string]bool{}) {
			s.registered[key] = true
		}
		return true
	})
}

// indexClientQueues reads the queues a `river.Config` lists: the ones this
// client works, which is the composition root's claim about the receive side.
func (s *scanner) indexClientQueues(fn *goscan.Function) {
	ast.Inspect(fn.Decl.Body, func(node ast.Node) bool {
		lit, ok := node.(*ast.CompositeLit)
		if !ok || s.TypeKey(lit.Type, fn.File) != riverImport+".Config" {
			return true
		}
		queues, ok := goscan.Unwrap(fieldValue(lit, "Queues")).(*ast.CompositeLit)
		if !ok {
			return true
		}
		for _, raw := range queues.Elts {
			pair, ok := raw.(*ast.KeyValueExpr)
			if !ok {
				continue
			}
			for _, value := range s.Resolve(pair.Key, fn, 0, map[string]bool{}) {
				s.queues = appendUnique(s.queues, value.Value)
			}
		}
		return true
	})
}

// indexProducers reads every Insert of the tree. The job type is followed
// through locals, constructors and parameters up to the callers; the queue
// through the options at the call, else the args type's own InsertOpts(),
// else River's default. What cannot be followed is said, at the call.
func (s *scanner) indexProducers(fn *goscan.Function, b *plugin.Builder) {
	usesRiver := false
	for _, imported := range fn.File.Imports {
		if imported == riverImport || strings.HasPrefix(imported, riverImport+"/") {
			usesRiver = true
		}
	}
	ast.Inspect(fn.Decl.Body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		spec, known := inserts[sel.Sel.Name]
		if !known || len(call.Args) <= spec.args {
			return true
		}
		if !usesRiver && s.TypeOf(sel.X, fn) != riverImport+".Client" {
			return true
		}
		at := s.At(call.Pos())
		if spec.batch {
			for _, item := range s.batchItems(call.Args[spec.args], fn) {
				s.producer(fn, sel.Sel.Name, item.args, item.opts, at, b)
			}
			return true
		}
		var opts ast.Expr
		if len(call.Args) > spec.args+1 {
			opts = call.Args[spec.args+1]
		}
		s.producer(fn, sel.Sel.Name, call.Args[spec.args], opts, at, b)
		return true
	})
}

type batchItem struct {
	args ast.Expr
	opts ast.Expr
}

// batchItems is each `{Args: X{}, InsertOpts: ...}` of an InsertMany batch
// written as a literal, directly or through a local.
func (s *scanner) batchItems(expr ast.Expr, fn *goscan.Function) []batchItem {
	lit, ok := goscan.Unwrap(expr).(*ast.CompositeLit)
	if !ok {
		if ident, isIdent := goscan.Unwrap(expr).(*ast.Ident); isIdent {
			if given, found := s.AssignedTo(fn, ident.Name); found && given.Index == 0 {
				lit, ok = goscan.Unwrap(given.Expr).(*ast.CompositeLit)
			}
		}
	}
	if !ok {
		return []batchItem{{args: expr}}
	}
	var out []batchItem
	for _, raw := range lit.Elts {
		item, ok := goscan.Unwrap(raw).(*ast.CompositeLit)
		if !ok {
			continue
		}
		out = append(out, batchItem{args: fieldValue(item, "Args"), opts: fieldValue(item, "InsertOpts")})
	}
	return out
}

func (s *scanner) producer(fn *goscan.Function, method string, argsExpr, optsExpr ast.Expr, at goscan.Source, b *plugin.Builder) {
	if argsExpr == nil {
		b.Warn(at.String(), method+" inserts a batch this reader cannot take apart; write the jobs as a literal `[]river.InsertManyParams{{Args: ...}}` or a local holding one")
		return
	}
	types := s.TypesOf(argsExpr, fn, 0, map[string]bool{})
	if len(types) == 0 {
		b.Warn(at.String(), method+" inserts `"+s.PrintNode(argsExpr)+"`, whose job type this reader cannot resolve: not a literal, a local, a constructor's result or a parameter the callers fill")
		return
	}
	for _, key := range types {
		arg := s.args[key]
		if arg == nil || arg.kind == "" {
			b.Warn(at.String(), method+" inserts `"+goscan.LastSegment(key)+"`, which declares no Kind() this reader can resolve to a string")
			continue
		}
		s.fed[key] = true
		queues, said := s.queuesOf(optsExpr, fn, 0)
		if len(queues) == 0 && said {
			b.Warn(at.String(), method+" of `"+arg.kind+"` names a queue this reader cannot resolve: not a literal, a constant, a config default or a caller's argument")
			continue
		}
		if len(queues) == 0 {
			queues = s.typeQueues(key)
		}
		if len(queues) == 0 {
			queues = []string{"default"}
		}
		for _, queue := range queues {
			s.producers = append(s.producers, producer{args: key, queue: queue, entrypoint: functionKey(fn), at: at})
		}
	}
}

// queuesOf is what the options at an insert say the queue is, and whether
// they say anything: a `Queue:` that is written but does not resolve is not
// the same as no `Queue:` at all.
func (s *scanner) queuesOf(opts ast.Expr, fn *goscan.Function, depth int) ([]string, bool) {
	if opts == nil {
		return nil, false
	}
	lit, ok := goscan.Unwrap(opts).(*ast.CompositeLit)
	if !ok {
		ident, isIdent := goscan.Unwrap(opts).(*ast.Ident)
		if !isIdent || ident.Name == "nil" {
			return nil, false
		}
		if given, found := s.AssignedTo(fn, ident.Name); found && given.Index == 0 {
			lit, ok = goscan.Unwrap(given.Expr).(*ast.CompositeLit)
		}
		if !ok {
			// Options passed through a parameter: what the callers hand over.
			index := goscan.ParamIndex(fn, ident.Name)
			if index < 0 || depth >= s.Hops {
				return nil, true
			}
			var out []string
			said := false
			for _, arg := range s.ArgsFromCallers(fn, index) {
				found, callerSaid := s.queuesOf(arg.Expr, arg.Fn, depth+1)
				said = said || callerSaid
				for _, queue := range found {
					out = appendUnique(out, queue)
				}
			}
			return out, said && len(out) == 0
		}
	}
	queue := fieldValue(lit, "Queue")
	if queue == nil {
		return nil, false
	}
	var out []string
	for _, value := range s.Resolve(queue, fn, 0, map[string]bool{}) {
		out = appendUnique(out, value.Value)
	}
	return out, true
}

// typeQueues is the queue an args type chooses for itself through
// `func (X) InsertOpts() river.InsertOpts`.
func (s *scanner) typeQueues(key string) []string {
	fn := s.Functions[key+".InsertOpts"]
	if fn == nil || fn.Decl.Body == nil {
		return nil
	}
	var out []string
	ast.Inspect(fn.Decl.Body, func(node ast.Node) bool {
		ret, ok := node.(*ast.ReturnStmt)
		if !ok || len(ret.Results) != 1 {
			return true
		}
		found, _ := s.queuesOf(ret.Results[0], fn, 0)
		for _, queue := range found {
			out = appendUnique(out, queue)
		}
		return false
	})
	return out
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

	// A registered worker no local Insert feeds is still this service's
	// receive side. Its queue is the one its args type chooses, or the one
	// queue the client is configured to work - a River client works only
	// the queues its Config lists, so a job it handles is on one of them.
	// With several and no choice by the type, the worker is kept with its
	// queue unresolved rather than placed by guess.
	var orphans []string
	for args := range workerByArgs {
		orphans = append(orphans, args)
	}
	sort.Strings(orphans)
	unresolvedWorkers := []*queueJob{}
	for _, args := range orphans {
		found := workerByArgs[args]
		arg := s.args[args]
		if s.fed[args] || arg == nil || arg.kind == "" {
			continue
		}
		queue := ""
		if chosen := s.typeQueues(args); len(chosen) == 1 {
			queue = chosen[0]
		} else if len(chosen) == 0 && len(s.queues) == 1 {
			queue = s.queues[0]
		}
		where := "no Insert of `" + arg.kind + "` is in this tree: the producer is another component"
		if queue != "" {
			b.Warn(found.at.String(), "registered River worker "+found.name+" handles `"+arg.kind+"`; "+where+", and the queue `"+queue+"` is the one this client is configured to work")
			if queues[queue] == nil {
				queues[queue] = map[string]*queueJob{}
			}
			queues[queue][args] = &queueJob{args: arg, worker: found}
			continue
		}
		hint := "no river.Config lists the queues this client works"
		if len(s.queues) > 1 {
			hint = "the client works `" + strings.Join(s.queues, "`, `") + "` and nothing says which one carries it"
		}
		b.Warn(found.at.String(), "registered River worker "+found.name+" handles `"+arg.kind+"`; "+where+", and its queue is unresolved: "+hint)
		unresolvedWorkers = append(unresolvedWorkers, &queueJob{args: arg, worker: found})
	}

	queueNames := make([]string, 0, len(queues))
	for queue := range queues {
		queueNames = append(queueNames, queue)
	}
	sort.Strings(queueNames)
	channels := []catalog.Channel{}
	flows := []catalog.Flow{}
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
			if len(job.producers) > 0 {
				channel.Messages = append(channel.Messages, catalog.ChannelMessage{Name: job.args.kind, Title: job.args.name, Doc: doc, Direction: catalog.ChannelSend})
				if channel.Source == "" {
					channel.Source = job.producers[0].at.String()
				}
			}
			if job.worker == nil {
				b.Warn(job.producers[0].at.String(), "River job "+job.args.kind+" is inserted, but no registered Worker["+job.args.name+"] was found in this component")
				continue
			}
			if channel.Source == "" {
				channel.Source = job.worker.at.String()
			}
			channel.Messages = append(channel.Messages, catalog.ChannelMessage{Name: job.args.kind, Title: job.worker.name, Doc: "Handled by " + job.worker.name + ".Work. " + doc, Direction: catalog.ChannelReceive})
			flows = append(flows, riverFlow(serviceID, owner, queue, job))
		}
		channels = append(channels, channel)
	}
	for _, job := range unresolvedWorkers {
		flows = append(flows, riverFlow(serviceID, owner, "", job))
	}
	sort.Slice(flows, func(i, j int) bool { return flows[i].Slug < flows[j].Slug })

	return channels, flows
}

// riverFlow is the two-hop enqueue/dispatch flow, or - when no producer is
// in the tree - the dispatch alone. An empty queue is one nothing proved:
// the broker lane says so and the step is unresolved.
func riverFlow(serviceID, owner, queue string, job *queueJob) catalog.Flow {
	broker := "river." + goscan.Slug(queue)
	label := "River · " + queue
	if queue == "" {
		broker = "river"
		label = "River · queue not proven"
	}
	slugged := goscan.Slug(goscan.LastSegment(serviceID) + "-river-" + job.args.kind)
	if queue != "default" && queue != "" {
		slugged += "-" + goscan.Slug(queue)
	}
	doc := jobDescription(job.args)
	handoff := func(direction string) *catalog.FlowHandoff {
		return &catalog.FlowHandoff{Kind: "job", Transport: "river", Channel: queue, Message: job.args.kind, Direction: direction}
	}
	status := catalog.StatusDeclared
	if queue == "" {
		status = catalog.StatusUnresolved
	}
	steps := catalog.FlowNodes{}
	summary := "River job `" + job.args.kind + "`"
	source := job.worker.at.String()
	if len(job.producers) > 0 {
		source = job.producers[0].at.String()
		summary += " is inserted on `" + queue + "` and"
		steps = append(steps, &catalog.Step{Type: "step", ID: "enqueue", From: serviceID, To: broker, Kind: catalog.StepCall, Label: "enqueue " + job.args.kind, Status: catalog.StatusDeclared, Note: doc, Line: job.producers[0].at.String(), Handoff: handoff("send")})
	} else if queue != "" {
		summary += " arrives on `" + queue + "` from another component and"
	} else {
		summary += " arrives on a queue this tree does not name and"
	}
	summary += " is handled by `" + job.worker.name + ".Work`."
	steps = append(steps, &catalog.Step{Type: "step", ID: "work", From: broker, To: serviceID, Kind: catalog.StepCall, Label: job.worker.name + ".Work", Status: status, Note: "River dispatches `" + job.args.kind + "` to the registered worker.", Line: job.worker.at.String(), ContinuesAt: job.worker.entrypoint, Handoff: handoff("receive")})
	return catalog.Flow{
		ID:         "flow." + slugged,
		Slug:       slugged,
		Name:       goscan.Title(job.args.kind) + " job",
		Summary:    summary,
		Source:     source,
		Trigger:    &catalog.FlowTrigger{Kind: "job", Label: label, Confidence: "high"},
		EntryPoint: producerEntrypoint(job.producers),
		Owner:      owner,
		Participants: []catalog.Participant{
			{ID: serviceID, Kind: catalog.ParticipantService, Context: stringPtr(owner)},
			{ID: broker, Kind: catalog.ParticipantBroker, Label: label},
		},
		Steps: steps,
	}
}

func producerEntrypoint(producers []producer) string {
	seen := map[string]bool{}
	entrypoint := ""
	for _, producer := range producers {
		if producer.entrypoint == "" || seen[producer.entrypoint] {
			continue
		}
		seen[producer.entrypoint] = true
		if entrypoint != "" {
			return ""
		}
		entrypoint = producer.entrypoint
	}
	return entrypoint
}

// functionKey is the source-function key a flow continues at: the
// directory of the file and the (receiver-qualified) name.
func functionKey(fn *goscan.Function) string {
	name := fn.Name
	if fn.Receiver != "" {
		name = goscan.LastSegment(fn.Receiver) + "." + name
	}
	dir := path.Dir(fn.File.Name)
	if dir == "." || dir == "" {
		return name
	}
	return dir + ":" + name
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

// fieldValue is the value a composite literal gives a named field, or nil.
func fieldValue(lit *ast.CompositeLit, name string) ast.Expr {
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

func appendUnique(values []string, value string) []string {
	for _, have := range values {
		if have == value {
			return values
		}
	}
	return append(values, value)
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
