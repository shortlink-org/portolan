package extractwatermill

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/token"
	"path"
	"sort"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/internal/goscan"
	"github.com/shortlink-org/portolan/plugin"
)

const (
	watermillMessageImport = "github.com/ThreeDotsLabs/watermill/message"
	watermillCQRSImport    = "github.com/ThreeDotsLabs/watermill/components/cqrs"
)

type goType struct {
	key    string
	name   string
	doc    string
	fields []string
	at     goscan.Source
}

// topic is an address as far as one function can tell: the string, when it
// resolved; the parameter index, when the function was handed it and the
// callers decide; and always the expression as written, so an unresolved
// one can still be named.
type topic struct {
	address string
	env     string
	expr    string
	param   int
	at      goscan.Source
}

func (t topic) valid() bool { return t.address != "" || t.param >= 0 }

type publication struct {
	topic      topic
	payload    string
	at         goscan.Source
	conditions []string
	terminal   bool
}

// handler is one way messages enter this service: a router handler, a CQRS
// handler, or a direct Subscribe. An input with no address is one that was
// mounted but whose topic nothing resolved - kept, and said to be so.
type handler struct {
	name          string
	input         topic
	inputPayload  string
	consumerGroup string
	entrypoint    string
	publications  []publication
	at            goscan.Source
	direct        bool
}

type cqrsHandler struct {
	name    string
	payload string
	at      goscan.Source
}

type channelState struct {
	channel catalog.Channel
	seen    map[string]bool
}

// analysisState is what one function body knows about its names: the type
// each local has, the strings, the JSON payloads and messages built, and
// which locals are parameters - plus the function itself, for what the
// shared index can say about names this state cannot.
type analysisState struct {
	fn           *goscan.Function
	types        map[string]string
	strings      map[string]topic
	bytesPayload map[string]string
	messages     map[string]string
	topicParams  map[string]int
}

type analysis struct {
	input        string
	publications []publication
}

type pathState struct {
	conditions   []string
	publications []int
}

// registration is one Router.AddHandler or AddNoPublisherHandler as read
// at its call, before the parameters it was handed are filled in by the
// callers. A wrapper that registers handlers for the whole service is one
// registration with parameters; each caller makes it a concrete one.
type registration struct {
	method     string
	name       topic
	input      topic
	output     topic
	callback   ast.Expr
	callbackFn *goscan.Function
	callbackSt *analysisState
	subscriber string
	fn         *goscan.Function
	at         goscan.Source
}

// scanner is the shared Go index, and what Watermill leaves in it: the
// payload types, what each function publishes, and the handlers registered
// on a router or a CQRS processor or subscribed directly.
type scanner struct {
	*goscan.Index
	types     map[string]*goType
	summaries map[string][]publication
	outer     map[string]*analysisState
	handlers  []handler
	transport string
}

func extract(in plugin.Input, opts Options) (plugin.Response, error) {
	b := &plugin.Builder{}
	tree, err := goscan.Read(in.Root)
	if err != nil {
		return plugin.Response{}, err
	}
	s := &scanner{
		Index:     goscan.NewIndex(tree),
		types:     map[string]*goType{},
		summaries: map[string][]publication{},
		outer:     map[string]*analysisState{},
	}
	for _, file := range s.Files {
		for _, imported := range file.Imports {
			s.detectTransport(imported)
		}
	}
	s.index(b)

	serviceID := opts.Context + "." + opts.Service
	channels, flows := s.catalog(serviceID, opts.Context)
	if len(s.handlers) == 0 {
		b.Warn(in.Root, "no Watermill Router.AddHandler, AddNoPublisherHandler, CQRS handler or Subscriber.Subscribe declaration was found")
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
	b.File(goscan.FirstNonEmpty(opts.Out, "watermill.json"), string(encoded)+"\n")
	return b.Response(), nil
}

func (s *scanner) detectTransport(imported string) {
	switch {
	case strings.Contains(imported, "watermill-kafka"):
		s.transport = "Kafka"
	case strings.Contains(imported, "watermill-nats") && s.transport == "":
		s.transport = "NATS"
	case strings.Contains(imported, "watermill-amqp") && s.transport == "":
		s.transport = "AMQP"
	case strings.Contains(imported, "watermill-sql") && s.transport == "":
		s.transport = "SQL"
	}
}

func (s *scanner) index(b *plugin.Builder) {
	for _, file := range s.Files {
		s.indexDeclarations(file)
	}
	for _, fn := range s.SortedFunctions() {
		s.summaries[fn.Key] = s.analyzeBlock(fn.Decl.Body, fn.File, s.stateFor(fn), false).publications
	}
	for _, fn := range s.SortedFunctions() {
		s.indexHandlers(fn, b)
		s.indexCQRS(fn, b)
		s.indexSubscribes(fn, b)
	}
}

func (s *scanner) indexDeclarations(file *goscan.File) {
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
			s.types[key] = &goType{key: key, name: spec.Name.Name, doc: doc, fields: s.FieldsOf(body), at: s.At(spec.Pos())}
		}
	}
}

func (s *scanner) stateFor(fn *goscan.Function) *analysisState {
	state := &analysisState{fn: fn, types: map[string]string{}, strings: map[string]topic{}, bytesPayload: map[string]string{}, messages: map[string]string{}, topicParams: map[string]int{}}
	for name, kind := range fn.Types {
		state.types[name] = kind
	}
	for i, name := range fn.Params {
		state.topicParams[name] = i
	}
	return state
}

// outerState is a function's state with its body's assignments read, kept
// so that a function reached from several registrations is read once.
func (s *scanner) outerState(fn *goscan.Function) *analysisState {
	if found := s.outer[fn.Key]; found != nil {
		return found
	}
	state := s.stateFor(fn)
	s.collectAssignments(fn.Decl.Body, fn.File, state)
	s.outer[fn.Key] = state
	return state
}

func cloneState(parent *analysisState) *analysisState {
	state := &analysisState{fn: parent.fn, types: map[string]string{}, strings: map[string]topic{}, bytesPayload: map[string]string{}, messages: map[string]string{}, topicParams: map[string]int{}}
	for key, value := range parent.types {
		state.types[key] = value
	}
	for key, value := range parent.strings {
		state.strings[key] = value
	}
	for key, value := range parent.bytesPayload {
		state.bytesPayload[key] = value
	}
	for key, value := range parent.messages {
		state.messages[key] = value
	}
	for key, value := range parent.topicParams {
		state.topicParams[key] = value
	}
	return state
}

func (s *scanner) collectAssignments(body *ast.BlockStmt, file *goscan.File, state *analysisState) {
	ast.Inspect(body, func(node ast.Node) bool {
		if _, ok := node.(*ast.FuncLit); ok {
			return false
		}
		switch item := node.(type) {
		case *ast.AssignStmt:
			s.assign(item.Lhs, item.Rhs, file, state)
		case *ast.DeclStmt:
			gen, ok := item.Decl.(*ast.GenDecl)
			if ok && gen.Tok == token.VAR {
				for _, raw := range gen.Specs {
					spec := raw.(*ast.ValueSpec)
					lhs := make([]ast.Expr, len(spec.Names))
					for i, name := range spec.Names {
						lhs[i] = name
					}
					s.assign(lhs, spec.Values, file, state)
					if spec.Type != nil {
						for _, name := range spec.Names {
							state.types[name.Name] = s.TypeKey(spec.Type, file)
						}
					}
				}
			}
		}
		return true
	})
}

func (s *scanner) assign(lhs, rhs []ast.Expr, file *goscan.File, state *analysisState) {
	if len(rhs) == 0 {
		return
	}
	for i, raw := range lhs {
		name, ok := raw.(*ast.Ident)
		if !ok || name.Name == "_" {
			continue
		}
		expr := rhs[min(i, len(rhs)-1)]
		if len(rhs) == 1 && i > 0 {
			continue
		}
		if value := s.topicValue(expr, file, state, map[string]bool{}); value.address != "" {
			state.strings[name.Name] = value
		}
		if kind := s.typeOf(expr, file, state); kind != "" {
			state.types[name.Name] = kind
		}
		if call, ok := goscan.Unwrap(expr).(*ast.CallExpr); ok {
			if s.isPackageCall(call, file, "encoding/json", "Marshal") && len(call.Args) > 0 {
				state.bytesPayload[name.Name] = s.typeOf(call.Args[0], file, state)
			}
			if s.isPackageCall(call, file, watermillMessageImport, "NewMessage") && len(call.Args) > 1 {
				state.messages[name.Name] = s.payloadOf(call.Args[1], file, state)
			}
		}
	}
	if len(rhs) == 1 {
		call, ok := goscan.Unwrap(rhs[0]).(*ast.CallExpr)
		if ok {
			results := s.callResults(call, file, state)
			for i, raw := range lhs {
				name, ok := raw.(*ast.Ident)
				if ok && i < len(results) && results[i] != "" {
					state.types[name.Name] = results[i]
				}
			}
		}
	}
}

func (s *scanner) analyzeBlock(body *ast.BlockStmt, file *goscan.File, state *analysisState, includeHelpers bool) analysis {
	s.collectAssignments(body, file, state)
	result := analysis{}
	ast.Inspect(body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		if s.isPackageCall(call, file, "encoding/json", "Unmarshal") && len(call.Args) > 1 && result.input == "" {
			result.input = s.typeOf(call.Args[1], file, state)
		}
		return true
	})
	s.walkStatements(body.List, []pathState{{}}, file, state, includeHelpers, &result.publications)
	result.publications = uniquePublications(result.publications)
	return result
}

func (s *scanner) walkStatements(statements []ast.Stmt, paths []pathState, file *goscan.File, state *analysisState, includeHelpers bool, out *[]publication) []pathState {
	for _, statement := range statements {
		var next []pathState
		for _, current := range paths {
			if branch, ok := statement.(*ast.IfStmt); ok {
				condition := s.PrintNode(branch.Cond)
				thenPath := current
				thenPath.conditions = appendCopy(current.conditions, condition)
				thenFalls := s.walkStatements(branch.Body.List, []pathState{thenPath}, file, state, includeHelpers, out)

				elsePath := current
				elsePath.conditions = appendCopy(current.conditions, "not ("+condition+")")
				var elseFalls []pathState
				switch otherwise := branch.Else.(type) {
				case *ast.BlockStmt:
					elseFalls = s.walkStatements(otherwise.List, []pathState{elsePath}, file, state, includeHelpers, out)
				case *ast.IfStmt:
					elseFalls = s.walkStatements([]ast.Stmt{otherwise}, []pathState{elsePath}, file, state, includeHelpers, out)
				default:
					elseFalls = []pathState{elsePath}
				}
				if len(thenFalls) > 0 && len(elseFalls) > 0 {
					merged := current
					merged.publications = unionPublicationIndexes(thenFalls, elseFalls)
					next = append(next, merged)
				} else {
					next = append(next, thenFalls...)
					next = append(next, elseFalls...)
				}
				continue
			}

			publications := s.publicationsIn(statement, file, state, includeHelpers)
			for _, value := range publications {
				value.conditions = append(append([]string{}, current.conditions...), value.conditions...)
				*out = append(*out, value)
				current.publications = append(current.publications, len(*out)-1)
			}
			if _, returns := statement.(*ast.ReturnStmt); returns {
				for _, index := range current.publications {
					(*out)[index].terminal = true
				}
				continue
			}
			next = append(next, current)
		}
		paths = next
		if len(paths) == 0 {
			break
		}
	}
	return paths
}

func (s *scanner) publicationsIn(statement ast.Stmt, file *goscan.File, state *analysisState, includeHelpers bool) []publication {
	var out []publication
	ast.Inspect(statement, func(node ast.Node) bool {
		if _, ok := node.(*ast.FuncLit); ok {
			return false
		}
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		if sel, ok := call.Fun.(*ast.SelectorExpr); ok && sel.Sel.Name == "Publish" && len(call.Args) >= 2 {
			payload := s.payloadOf(call.Args[1], file, state)
			for _, resolved := range s.topicValues(call.Args[0], file, state) {
				if resolved.valid() {
					resolved.at = s.At(call.Args[0].Pos())
					out = append(out, publication{topic: resolved, payload: payload, at: s.At(call.Pos())})
				}
			}
		}
		if includeHelpers && state.fn != nil {
			for _, target := range s.Targets(call.Fun, state.fn) {
				for _, summary := range s.summaries[target.Key] {
					pub := summary
					if pub.topic.param >= 0 && pub.topic.param < len(call.Args) {
						index := pub.topic.param
						pub.topic = s.topicValue(call.Args[index], file, state, map[string]bool{})
						pub.topic.at = s.At(call.Args[index].Pos())
					}
					if pub.topic.address != "" {
						pub.at = s.At(call.Pos())
						out = append(out, pub)
					}
				}
			}
		}
		return true
	})
	return out
}

func appendCopy(values []string, value string) []string {
	out := append([]string{}, values...)
	return append(out, value)
}

func unionPublicationIndexes(groups ...[]pathState) []int {
	seen := map[int]bool{}
	var out []int
	for _, group := range groups {
		for _, state := range group {
			for _, index := range state.publications {
				if !seen[index] {
					seen[index] = true
					out = append(out, index)
				}
			}
		}
	}
	return out
}

// --- router handlers ---------------------------------------------------------

func usesImport(fn *goscan.Function, importPath string) bool {
	for _, imported := range fn.File.Imports {
		if imported == importPath {
			return true
		}
	}
	return false
}

// indexHandlers reads every Router.AddHandler and AddNoPublisherHandler in
// a function. A registration inside a wrapper - a function handed the name,
// the topic or the handler as parameters - is made concrete once per caller.
func (s *scanner) indexHandlers(fn *goscan.Function, b *plugin.Builder) {
	if !usesImport(fn, watermillMessageImport) {
		return
	}
	outer := s.outerState(fn)
	ast.Inspect(fn.Decl.Body, func(node ast.Node) bool {
		if _, ok := node.(*ast.FuncLit); ok {
			return false
		}
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || (sel.Sel.Name != "AddHandler" && sel.Sel.Name != "AddNoPublisherHandler") || len(call.Args) < 4 {
			return true
		}
		reg := registration{
			method:     sel.Sel.Name,
			name:       s.topicValue(call.Args[0], fn.File, outer, map[string]bool{}),
			input:      s.topicValue(call.Args[1], fn.File, outer, map[string]bool{}),
			output:     topic{param: -1},
			callback:   call.Args[len(call.Args)-1],
			callbackFn: fn,
			callbackSt: outer,
			fn:         fn,
			at:         s.At(call.Pos()),
		}
		if subscriber, ok := call.Args[2].(*ast.Ident); ok {
			reg.subscriber = s.subscriberGroup(fn.Decl.Body, fn.File, outer, subscriber.Name)
		}
		// AddHandler(name, subscribeTopic, subscriber, publishTopic, publisher, handler)
		if sel.Sel.Name == "AddHandler" && len(call.Args) >= 6 {
			reg.output = s.topicValue(call.Args[3], fn.File, outer, map[string]bool{})
		}
		for _, concrete := range s.expand(reg, 0) {
			s.register(concrete, b)
		}
		return false
	})
}

// expand fills a registration's parameters in from its callers, one
// concrete registration per call site, up to Hops levels. A registration
// nothing calls is kept as it is: its topic will read as unresolved.
func (s *scanner) expand(reg registration, depth int) []registration {
	callbackParam := -1
	if ident, ok := goscan.Unwrap(reg.callback).(*ast.Ident); ok && reg.callbackFn == reg.fn {
		callbackParam = goscan.ParamIndex(reg.fn, ident.Name)
	}
	if reg.name.param < 0 && reg.input.param < 0 && reg.output.param < 0 && callbackParam < 0 {
		return []registration{reg}
	}
	if depth >= s.Hops {
		return []registration{reg}
	}
	var out []registration
	for _, site := range s.CallSites(reg.fn) {
		state := s.outerState(site.Fn)
		fill := func(value topic) topic {
			if value.param < 0 || value.param >= len(site.Call.Args) {
				return value
			}
			filled := s.topicValue(site.Call.Args[value.param], site.Fn.File, state, map[string]bool{})
			filled.at = s.At(site.Call.Args[value.param].Pos())
			return filled
		}
		concrete := reg
		concrete.fn = site.Fn
		concrete.name = fill(reg.name)
		concrete.input = fill(reg.input)
		concrete.output = fill(reg.output)
		if callbackParam >= 0 && callbackParam < len(site.Call.Args) {
			concrete.callback = site.Call.Args[callbackParam]
			concrete.callbackFn = site.Fn
			concrete.callbackSt = state
		}
		out = append(out, s.expand(concrete, depth+1)...)
	}
	if len(out) == 0 {
		return []registration{reg}
	}
	return out
}

// register turns one concrete registration into a handler: the body read
// for what it publishes, the input kept even when its topic did not resolve.
func (s *scanner) register(reg registration, b *plugin.Builder) {
	name := reg.name.address
	if name == "" {
		name = goscan.FirstNonEmpty(reg.name.expr, reg.method)
	}
	if reg.input.address == "" {
		b.Warn(reg.at.String(), "Watermill handler "+name+" is registered on topic `"+goscan.FirstNonEmpty(reg.input.expr, "?")+"`, which this reader cannot resolve to a literal, a constant, a config default or a caller's argument; the handler is kept with its topic unresolved")
	}
	body, state, entrypoint := s.callbackBody(reg.callback, reg.callbackFn, reg.callbackSt)
	found := analysis{}
	if body == nil {
		b.Warn(s.At(reg.callback.Pos()).String(), "Watermill handler body for "+name+" could not be resolved: not a function literal, a function or method of this tree, or a constructor returning one; its publications are not read")
	} else {
		found = s.analyzeBlock(body, state.fn.File, state, true)
	}
	if reg.method == "AddHandler" && reg.output.address != "" {
		found.publications = append(found.publications, publication{topic: reg.output, at: reg.output.at})
	}
	s.handlers = append(s.handlers, handler{name: name, input: reg.input, inputPayload: found.input, consumerGroup: reg.subscriber, entrypoint: entrypoint, publications: uniquePublications(found.publications), at: reg.at})
}

// callbackBody is the body a handler value stands for, with the state to
// read it in: a function literal, in the registering function's state; a
// function or method of the tree, in its own; a constructor whose whole
// body returns a literal, in the constructor's.
func (s *scanner) callbackBody(expr ast.Expr, fn *goscan.Function, outer *analysisState) (*ast.BlockStmt, *analysisState, string) {
	switch value := goscan.Unwrap(expr).(type) {
	case *ast.FuncLit:
		state := cloneState(outer)
		if value.Type.Params != nil {
			for _, field := range value.Type.Params.List {
				for _, param := range field.Names {
					state.types[param.Name] = s.TypeKey(field.Type, fn.File)
				}
			}
		}
		return value.Body, state, ""
	case *ast.CallExpr:
		for _, target := range s.Callees(value, fn) {
			if lit, ok := goscan.Unwrap(goscan.SingleReturn(target)).(*ast.FuncLit); ok {
				return s.callbackBody(lit, target, s.outerState(target))
			}
		}
	default:
		for _, target := range s.Targets(expr, fn) {
			if target.Decl.Body != nil {
				return target.Decl.Body, s.stateFor(target), functionKey(target)
			}
		}
	}
	return nil, nil, ""
}

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

// indexSubscribes reads Subscriber.Subscribe(ctx, topic) outside a router:
// the messages are read from the returned channel in the same function, so
// the function is the handler and its entrypoint.
func (s *scanner) indexSubscribes(fn *goscan.Function, b *plugin.Builder) {
	if !usesImport(fn, watermillMessageImport) {
		return
	}
	outer := s.outerState(fn)
	ast.Inspect(fn.Decl.Body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || sel.Sel.Name != "Subscribe" || len(call.Args) != 2 {
			return true
		}
		if recv := s.TypeOf(sel.X, fn); recv != watermillMessageImport+".Subscriber" && recv != "" {
			return true
		}
		values := s.topicValues(call.Args[1], fn.File, outer)
		if len(values) == 0 {
			values = []topic{{expr: s.PrintNode(call.Args[1]), param: -1}}
		}
		for _, value := range values {
			if value.address == "" {
				b.Warn(s.At(call.Pos()).String(), "Subscribe in "+fn.Name+" names topic `"+goscan.FirstNonEmpty(value.expr, "?")+"`, which this reader cannot resolve to a literal, a constant, a config default or a caller's argument; the subscription is kept with its topic unresolved")
			}
			value.at = s.At(call.Args[1].Pos())
			s.handlers = append(s.handlers, handler{name: fn.Name, input: value, entrypoint: functionKey(fn), at: s.At(call.Pos()), direct: true})
		}
		return true
	})
}

// --- CQRS --------------------------------------------------------------------

func (s *scanner) indexCQRS(fn *goscan.Function, b *plugin.Builder) {
	if !usesImport(fn, watermillCQRSImport) {
		return
	}
	state := s.outerState(fn)
	processorTopics := map[string]topic{}
	handlers := map[string]cqrsHandler{}

	ast.Inspect(fn.Decl.Body, func(node ast.Node) bool {
		assign, ok := node.(*ast.AssignStmt)
		if !ok || len(assign.Rhs) == 0 {
			return true
		}
		call, ok := goscan.Unwrap(assign.Rhs[0]).(*ast.CallExpr)
		if !ok {
			return true
		}
		for _, raw := range assign.Lhs {
			name, ok := raw.(*ast.Ident)
			if !ok || name.Name == "_" {
				continue
			}
			if processorKind := s.cqrsCallName(call, fn.File); processorKind == "NewEventProcessorWithConfig" || processorKind == "NewCommandProcessorWithConfig" || processorKind == "NewEventProcessor" || processorKind == "NewCommandProcessor" {
				if resolved := s.cqrsProcessorTopic(call, fn.File, state); resolved.valid() {
					processorTopics[name.Name] = resolved
				}
			}
			if built, ok := s.cqrsHandler(call, fn.File, state); ok {
				handlers[name.Name] = built
			}
		}
		return true
	})

	ast.Inspect(fn.Decl.Body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || (sel.Sel.Name != "AddHandler" && sel.Sel.Name != "AddHandlers" && sel.Sel.Name != "AddHandlersGroup") {
			return true
		}
		receiver, ok := sel.X.(*ast.Ident)
		if !ok {
			return true
		}
		baseTopic, ok := processorTopics[receiver.Name]
		if !ok {
			return true
		}
		start := 0
		group := ""
		if sel.Sel.Name == "AddHandlersGroup" && len(call.Args) > 0 {
			group = s.topicValue(call.Args[0], fn.File, state, map[string]bool{}).address
			start = 1
		}
		for _, arg := range call.Args[start:] {
			var built cqrsHandler
			var found bool
			switch value := goscan.Unwrap(arg).(type) {
			case *ast.Ident:
				built, found = handlers[value.Name]
			case *ast.CallExpr:
				built, found = s.cqrsHandler(value, fn.File, state)
			}
			if !found {
				continue
			}
			input := baseTopic
			if input.address == "$message" {
				input.address = goscan.LastSegment(built.payload)
			}
			if input.address == "" {
				b.Warn(s.At(arg.Pos()).String(), "Watermill CQRS handler topic generator could not be resolved")
				continue
			}
			consumerGroup := group
			if consumerGroup == "" {
				consumerGroup = built.name
			}
			s.handlers = append(s.handlers, handler{name: built.name, input: input, inputPayload: built.payload, consumerGroup: consumerGroup, at: s.At(call.Pos())})
		}
		return true
	})
}

func (s *scanner) cqrsCallName(call *ast.CallExpr, file *goscan.File) string {
	fun := call.Fun
	switch generic := fun.(type) {
	case *ast.IndexExpr:
		fun = generic.X
	case *ast.IndexListExpr:
		fun = generic.X
	}
	sel, ok := fun.(*ast.SelectorExpr)
	if !ok {
		return ""
	}
	base, ok := sel.X.(*ast.Ident)
	if !ok || file.Imports[base.Name] != watermillCQRSImport {
		return ""
	}
	return sel.Sel.Name
}

func (s *scanner) cqrsHandler(call *ast.CallExpr, file *goscan.File, state *analysisState) (cqrsHandler, bool) {
	name := s.cqrsCallName(call, file)
	if name != "NewEventHandler" && name != "NewCommandHandler" && name != "NewGroupEventHandler" {
		return cqrsHandler{}, false
	}
	handlerName := name
	callbackIndex := 0
	if name != "NewGroupEventHandler" {
		if len(call.Args) < 2 {
			return cqrsHandler{}, false
		}
		handlerName = s.topicValue(call.Args[0], file, state, map[string]bool{}).address
		callbackIndex = 1
	}
	if handlerName == "" {
		handlerName = strings.TrimSuffix(strings.TrimPrefix(name, "New"), "Handler")
	}
	payload := ""
	switch generic := call.Fun.(type) {
	case *ast.IndexExpr:
		payload = s.TypeKey(generic.Index, file)
	case *ast.IndexListExpr:
		if len(generic.Indices) > 0 {
			payload = s.TypeKey(generic.Indices[0], file)
		}
	}
	if payload == "" && callbackIndex < len(call.Args) {
		if callback, ok := goscan.Unwrap(call.Args[callbackIndex]).(*ast.FuncLit); ok && callback.Type.Params != nil && len(callback.Type.Params.List) > 1 {
			payload = s.TypeKey(callback.Type.Params.List[1].Type, file)
		}
	}
	return cqrsHandler{name: handlerName, payload: payload, at: s.At(call.Pos())}, payload != ""
}

func (s *scanner) cqrsProcessorTopic(call *ast.CallExpr, file *goscan.File, state *analysisState) topic {
	name := s.cqrsCallName(call, file)
	index := 1
	if len(call.Args) <= index {
		return topic{param: -1}
	}
	var generator ast.Expr
	if name == "NewEventProcessorWithConfig" || name == "NewCommandProcessorWithConfig" {
		config, ok := goscan.Unwrap(call.Args[index]).(*ast.CompositeLit)
		if !ok {
			return topic{param: -1}
		}
		for _, raw := range config.Elts {
			field, ok := raw.(*ast.KeyValueExpr)
			if !ok {
				continue
			}
			key, named := field.Key.(*ast.Ident)
			if named && key.Name == "GenerateSubscribeTopic" {
				generator = field.Value
			}
		}
	} else {
		generator = call.Args[index]
	}
	callback, ok := goscan.Unwrap(generator).(*ast.FuncLit)
	if !ok || callback.Body == nil {
		return topic{param: -1}
	}
	resolved := topic{param: -1}
	ast.Inspect(callback.Body, func(node ast.Node) bool {
		ret, ok := node.(*ast.ReturnStmt)
		if !ok || len(ret.Results) == 0 || resolved.valid() {
			return true
		}
		if selector, ok := goscan.Unwrap(ret.Results[0]).(*ast.SelectorExpr); ok {
			if selector.Sel.Name == "EventName" || selector.Sel.Name == "CommandName" {
				resolved = topic{address: "$message", param: -1, at: s.At(ret.Results[0].Pos())}
				return false
			}
		}
		resolved = s.topicValue(ret.Results[0], file, state, map[string]bool{})
		return false
	})
	return resolved
}

func (s *scanner) subscriberGroup(body *ast.BlockStmt, file *goscan.File, state *analysisState, variable string) string {
	group := ""
	ast.Inspect(body, func(node ast.Node) bool {
		assign, ok := node.(*ast.AssignStmt)
		if !ok || len(assign.Rhs) == 0 {
			return true
		}
		for _, lhs := range assign.Lhs {
			ident, ok := lhs.(*ast.Ident)
			if !ok || ident.Name != variable {
				continue
			}
			call, ok := goscan.Unwrap(assign.Rhs[0]).(*ast.CallExpr)
			if !ok || len(call.Args) < 2 {
				continue
			}
			group = s.topicValue(call.Args[1], file, state, map[string]bool{}).address
		}
		return group == ""
	})
	return group
}

// --- the catalog -------------------------------------------------------------

func (s *scanner) catalog(serviceID, owner string) ([]catalog.Channel, []catalog.Flow) {
	channels := map[string]*channelState{}
	ensure := func(value topic) *channelState {
		found := channels[value.address]
		if found != nil {
			return found
		}
		title := "Watermill topic"
		if s.transport != "" {
			title = "Watermill / " + s.transport + " topic"
		}
		doc := "Messages routed through github.com/ThreeDotsLabs/watermill."
		if value.env != "" {
			doc += " Configured by `" + value.env + "`; extracted address is its source default."
		}
		found = &channelState{channel: catalog.Channel{Address: value.address, Title: title, Doc: doc, Messages: []catalog.ChannelMessage{}, Source: value.at.String()}, seen: map[string]bool{}}
		channels[value.address] = found
		return found
	}
	flows := []catalog.Flow{}
	for _, found := range s.handlers {
		inputPayload := goscan.FirstNonEmpty(goscan.LastSegment(found.inputPayload), found.name)
		if found.input.address != "" {
			input := ensure(found.input)
			addMessage(input, catalog.ChannelMessage{Name: inputPayload, Title: inputPayload, Doc: s.payloadDescription(found.inputPayload, "Input"), Direction: catalog.ChannelReceive})
		}
		if len(found.publications) == 0 {
			flows = append(flows, s.flow(serviceID, owner, found, nil))
		}
		for i := range found.publications {
			pub := found.publications[i]
			output := ensure(pub.topic)
			payload := goscan.FirstNonEmpty(goscan.LastSegment(pub.payload), "message")
			addMessage(output, catalog.ChannelMessage{Name: payload, Title: payload, Doc: s.payloadDescription(pub.payload, "Payload"), Direction: catalog.ChannelSend})
		}
		if structuredBranches(found.publications) {
			flows = append(flows, s.branchedFlow(serviceID, owner, found))
		} else {
			for i := range found.publications {
				pub := found.publications[i]
				flows = append(flows, s.flow(serviceID, owner, found, &pub))
			}
		}
	}
	// What the service publishes outside any handler - from an HTTP handler,
	// a use case, a cron - is a send on the topic all the same, and the
	// other side of somebody else's receive.
	for _, fn := range s.SortedFunctions() {
		for _, pub := range s.summaries[fn.Key] {
			if pub.topic.address == "" {
				continue
			}
			output := ensure(pub.topic)
			payload := goscan.FirstNonEmpty(goscan.LastSegment(pub.payload), "message")
			addMessage(output, catalog.ChannelMessage{Name: payload, Title: payload, Doc: s.payloadDescription(pub.payload, "Payload"), Direction: catalog.ChannelSend})
		}
	}
	addresses := make([]string, 0, len(channels))
	for address := range channels {
		addresses = append(addresses, address)
	}
	sort.Strings(addresses)
	out := make([]catalog.Channel, 0, len(addresses))
	for _, address := range addresses {
		out = append(out, channels[address].channel)
	}
	sort.Slice(flows, func(i, j int) bool { return flows[i].Slug < flows[j].Slug })
	return out, flows
}

func structuredBranches(publications []publication) bool {
	if len(publications) < 2 {
		return false
	}
	seen := map[string]bool{}
	for _, pub := range publications {
		condition := strings.Join(pub.conditions, " and ")
		if condition == "" || seen[condition] {
			return false
		}
		seen[condition] = true
	}
	return true
}

func branchConditions(publications []publication) []string {
	all := make([]map[string]bool, len(publications))
	common := map[string]int{}
	for i, pub := range publications {
		all[i] = map[string]bool{}
		for _, condition := range pub.conditions {
			all[i][condition] = true
			common[condition]++
		}
	}
	titles := make([]string, len(publications))
	for i, pub := range publications {
		for _, condition := range pub.conditions {
			opposite := oppositeCondition(condition)
			for other := range publications {
				if other != i && all[other][opposite] {
					titles[i] = condition
					break
				}
			}
			if titles[i] != "" {
				break
			}
		}
		if titles[i] != "" {
			continue
		}
		var distinguishing []string
		for _, condition := range pub.conditions {
			if common[condition] != len(publications) {
				distinguishing = append(distinguishing, condition)
			}
		}
		titles[i] = goscan.FirstNonEmpty(strings.Join(distinguishing, " and "), strings.Join(pub.conditions, " and "))
	}
	return titles
}

func oppositeCondition(condition string) string {
	if strings.HasPrefix(condition, "not (") && strings.HasSuffix(condition, ")") {
		return strings.TrimSuffix(strings.TrimPrefix(condition, "not ("), ")")
	}
	return "not (" + condition + ")"
}

func addMessage(channel *channelState, message catalog.ChannelMessage) {
	key := string(message.Direction) + "|" + message.Name
	if channel.seen[key] {
		return
	}
	channel.seen[key] = true
	channel.channel.Messages = append(channel.channel.Messages, message)
}

// inputLane is the broker lane a handler receives on: the topic, or - when
// the topic did not resolve - one lane that says so.
func (s *scanner) inputLane(found handler) (id, label string, status catalog.Status) {
	if found.input.address == "" {
		return "watermill", goscan.FirstNonEmpty(s.transport, "Watermill") + " · topic not proven", catalog.StatusUnresolved
	}
	return "watermill." + goscan.Slug(found.input.address), goscan.FirstNonEmpty(s.transport, "Watermill") + " · " + found.input.address, catalog.StatusDeclared
}

func (s *scanner) receiveNote(found handler) string {
	note := s.payloadDescription(found.inputPayload, "Input")
	if found.direct {
		note = "Subscribed directly, without a router; messages are read in `" + found.name + "`."
	}
	if found.consumerGroup != "" {
		note += " Consumer group `" + found.consumerGroup + "`."
	}
	if found.input.address == "" {
		note += " Topic `" + goscan.FirstNonEmpty(found.input.expr, "?") + "` is not resolvable statically."
	}
	return strings.TrimSpace(note)
}

func (s *scanner) flow(serviceID, owner string, found handler, pub *publication) catalog.Flow {
	inputBroker, inputLabel, status := s.inputLane(found)
	topicName := goscan.FirstNonEmpty(found.input.address, found.input.expr, "?")
	ending := "consume"
	name := goscan.Title(found.name)
	summary := "Watermill handler `" + found.name + "` consumes `" + topicName + "`"
	if found.direct {
		summary = "`" + found.name + "` subscribes to `" + topicName + "`"
	}
	participants := []catalog.Participant{{ID: serviceID, Kind: catalog.ParticipantService, Context: stringPtr(owner)}, {ID: inputBroker, Kind: catalog.ParticipantBroker, Label: inputLabel}}
	steps := catalog.FlowNodes{&catalog.Step{Type: "step", ID: "receive", From: inputBroker, To: serviceID, Kind: catalog.StepEvent, Label: found.name, Status: status, Note: s.receiveNote(found), Line: found.at.String(), ContinuesAt: found.entrypoint, Handoff: s.messageHandoff(found.input.address, "receive")}}
	if pub != nil {
		ending = pub.topic.address
		outputBroker := "watermill." + goscan.Slug(pub.topic.address)
		if outputBroker != inputBroker {
			participants = append(participants, catalog.Participant{ID: outputBroker, Kind: catalog.ParticipantBroker, Label: goscan.FirstNonEmpty(s.transport, "Watermill") + " · " + pub.topic.address})
		}
		payload := goscan.FirstNonEmpty(goscan.LastSegment(pub.payload), "message")
		steps = append(steps, &catalog.Step{Type: "step", ID: "publish", From: serviceID, To: outputBroker, Kind: catalog.StepEvent, Label: "publish " + payload, Status: catalog.StatusDeclared, Note: s.payloadDescription(pub.payload, "Payload"), Line: pub.at.String(), Handoff: s.messageHandoff(pub.topic.address, "send")})
		name += " → " + pub.topic.address
		summary += " and may publish `" + pub.topic.address + "`"
	}
	summary += "."
	slugged := goscan.Slug(goscan.LastSegment(serviceID) + "-watermill-" + found.name + "-" + ending)
	return catalog.Flow{ID: "flow." + slugged, Slug: slugged, Name: name, Summary: summary, Source: found.at.String(), Trigger: &catalog.FlowTrigger{Kind: "event", Label: topicName, Confidence: "high"}, Owner: owner, Participants: participants, Steps: steps}
}

func (s *scanner) branchedFlow(serviceID, owner string, found handler) catalog.Flow {
	inputBroker, inputLabel, status := s.inputLane(found)
	topicName := goscan.FirstNonEmpty(found.input.address, found.input.expr, "?")
	participants := []catalog.Participant{
		{ID: serviceID, Kind: catalog.ParticipantService, Context: stringPtr(owner)},
		{ID: inputBroker, Kind: catalog.ParticipantBroker, Label: inputLabel},
	}
	participantSeen := map[string]bool{serviceID: true, inputBroker: true}
	branches := make([]catalog.AltBranch, 0, len(found.publications))
	addresses := make([]string, 0, len(found.publications))
	conditions := branchConditions(found.publications)
	for i, pub := range found.publications {
		outputBroker := "watermill." + goscan.Slug(pub.topic.address)
		if !participantSeen[outputBroker] {
			participantSeen[outputBroker] = true
			participants = append(participants, catalog.Participant{ID: outputBroker, Kind: catalog.ParticipantBroker, Label: goscan.FirstNonEmpty(s.transport, "Watermill") + " · " + pub.topic.address})
		}
		payload := goscan.FirstNonEmpty(goscan.LastSegment(pub.payload), "message")
		branches = append(branches, catalog.AltBranch{
			Title:    conditions[i],
			Terminal: pub.terminal,
			Steps: catalog.FlowNodes{&catalog.Step{
				Type:    "step",
				ID:      fmt.Sprintf("publish-%d", i+1),
				From:    serviceID,
				To:      outputBroker,
				Kind:    catalog.StepEvent,
				Label:   "publish " + payload,
				Status:  catalog.StatusDeclared,
				Note:    s.payloadDescription(pub.payload, "Payload"),
				Line:    pub.at.String(),
				Handoff: s.messageHandoff(pub.topic.address, "send"),
			}},
		})
		addresses = append(addresses, "`"+pub.topic.address+"`")
	}
	steps := catalog.FlowNodes{
		&catalog.Step{Type: "step", ID: "receive", From: inputBroker, To: serviceID, Kind: catalog.StepEvent, Label: found.name, Status: status, Note: s.receiveNote(found), Line: found.at.String(), ContinuesAt: found.entrypoint, Handoff: s.messageHandoff(found.input.address, "receive")},
		&catalog.Alt{Type: "alt", ID: "outcome", Branches: branches},
	}
	slugged := goscan.Slug(goscan.LastSegment(serviceID) + "-watermill-" + found.name)
	return catalog.Flow{
		ID:           "flow." + slugged,
		Slug:         slugged,
		Name:         goscan.Title(found.name),
		Summary:      "Watermill handler `" + found.name + "` consumes `" + topicName + "` and source control flow branches to " + strings.Join(addresses, " or ") + ".",
		Source:       found.at.String(),
		Trigger:      &catalog.FlowTrigger{Kind: "event", Label: topicName, Confidence: "high"},
		Owner:        owner,
		Participants: participants,
		Steps:        steps,
	}
}

func (s *scanner) messageHandoff(channel, direction string) *catalog.FlowHandoff {
	transport := strings.ToLower(goscan.FirstNonEmpty(s.transport, "watermill"))
	return &catalog.FlowHandoff{Kind: "message", Transport: transport, Channel: channel, Direction: direction}
}

func (s *scanner) payloadDescription(key, prefix string) string {
	found := s.types[key]
	if found == nil {
		if key == "" {
			return prefix + " payload type is not visible in source."
		}
		return prefix + " `" + goscan.LastSegment(key) + "`."
	}
	if len(found.fields) == 0 {
		return prefix + " `" + found.name + "`."
	}
	fields := found.fields
	suffix := ""
	if len(fields) > 10 {
		suffix = fmt.Sprintf(", and %d more", len(fields)-10)
		fields = fields[:10]
	}
	return prefix + " `" + found.name + "`: `" + strings.Join(fields, "`, `") + "`" + suffix + "."
}

func uniquePublications(values []publication) []publication {
	seen := map[string]bool{}
	var out []publication
	for _, value := range values {
		if !value.topic.valid() {
			continue
		}
		topicKey := value.topic.address
		if topicKey == "" {
			topicKey = fmt.Sprintf("$param:%d", value.topic.param)
		}
		key := topicKey + "|" + value.payload + "|" + strings.Join(value.conditions, "&&")
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, value)
	}
	return out
}

// --- names and values --------------------------------------------------------

// topicValue is what one expression is worth to the function reading it: a
// literal; a local given a string; a parameter, marked as such so that the
// callers decide; a constant, own or imported; a config field's default,
// through the local's type or the index's; and past those, whatever the
// shared index can prove - a concatenation, a `string(...)` of a typed
// constant, a single-return helper, a nested config field - when it proves
// exactly one thing. Otherwise the expression as written, unresolved.
func (s *scanner) topicValue(expr ast.Expr, file *goscan.File, state *analysisState, visiting map[string]bool) topic {
	expr = goscan.Unwrap(expr)
	switch value := expr.(type) {
	case *ast.BasicLit:
		if value.Kind == token.STRING {
			text, _ := strconv.Unquote(value.Value)
			return topic{address: text, expr: s.PrintNode(expr), param: -1, at: s.At(expr.Pos())}
		}
	case *ast.Ident:
		if local, ok := state.strings[value.Name]; ok {
			return local
		}
		if index, ok := state.topicParams[value.Name]; ok {
			return topic{param: index, expr: value.Name}
		}
		if found := s.constantValue(file.Pkg+"."+value.Name, visiting); found.address != "" {
			return found
		}
	case *ast.SelectorExpr:
		if base, ok := value.X.(*ast.Ident); ok {
			if imported := file.Imports[base.Name]; imported != "" {
				if found := s.constantValue(imported+"."+value.Sel.Name, visiting); found.address != "" {
					return found
				}
			}
			if found, ok := s.configDefault(state.types[base.Name], value.Sel.Name, expr); ok {
				return found
			}
		}
		if state.fn != nil {
			if found, ok := s.configDefault(s.TypeOf(value.X, state.fn), value.Sel.Name, expr); ok {
				return found
			}
		}
	}
	if state.fn != nil {
		if values := s.Resolve(expr, state.fn, 0, visiting); len(values) == 1 {
			return topic{address: values[0].Value, expr: s.PrintNode(expr), param: -1, at: s.At(expr.Pos())}
		}
	}
	return topic{param: -1, expr: s.PrintNode(expr)}
}

// topicValues is every address an expression can be: one, the way
// topicValue reads it, or several when the shared index follows a
// parameter to callers that pass different constants.
func (s *scanner) topicValues(expr ast.Expr, file *goscan.File, state *analysisState) []topic {
	single := s.topicValue(expr, file, state, map[string]bool{})
	// A parameter stays a parameter here: the function's summary carries the
	// marker, and each call site fills it in with its own argument and its
	// own provenance, which a walk up the callers from here would flatten.
	if single.address != "" || single.param >= 0 || state.fn == nil {
		return []topic{single}
	}
	values := s.Resolve(expr, state.fn, 0, map[string]bool{})
	if len(values) == 0 {
		return []topic{single}
	}
	var out []topic
	seen := map[string]bool{}
	for _, value := range values {
		if seen[value.Value] {
			continue
		}
		seen[value.Value] = true
		out = append(out, topic{address: value.Value, expr: s.PrintNode(expr), param: -1, at: s.At(expr.Pos())})
	}
	return out
}

func (s *scanner) configDefault(structKey, field string, expr ast.Expr) (topic, bool) {
	st := s.Structs[structKey]
	if st == nil || st.Defaults[field] == "" {
		return topic{}, false
	}
	return topic{address: st.Defaults[field], env: st.Env[field], expr: s.PrintNode(expr), param: -1, at: s.At(expr.Pos())}, true
}

func (s *scanner) constantValue(key string, visiting map[string]bool) topic {
	if visiting[key] {
		return topic{param: -1}
	}
	found, ok := s.Constants[key]
	if !ok {
		return topic{param: -1}
	}
	visiting[key] = true
	value := s.topicValue(found.Expr, found.File, &analysisState{types: map[string]string{}, strings: map[string]topic{}, topicParams: map[string]int{}}, visiting)
	delete(visiting, key)
	return value
}

func (s *scanner) payloadOf(expr ast.Expr, file *goscan.File, state *analysisState) string {
	expr = goscan.Unwrap(expr)
	switch value := expr.(type) {
	case *ast.Ident:
		if payload := state.messages[value.Name]; payload != "" {
			return payload
		}
		if payload := state.bytesPayload[value.Name]; payload != "" {
			return payload
		}
	case *ast.CallExpr:
		// message.NewMessage(id, payload) written in the Publish call itself.
		if s.isPackageCall(value, file, watermillMessageImport, "NewMessage") && len(value.Args) > 1 {
			return s.payloadOf(value.Args[1], file, state)
		}
		if s.isPackageCall(value, file, "encoding/json", "Marshal") && len(value.Args) > 0 {
			return s.typeOf(value.Args[0], file, state)
		}
	}
	return s.typeOf(expr, file, state)
}

func (s *scanner) typeOf(expr ast.Expr, file *goscan.File, state *analysisState) string {
	expr = goscan.Unwrap(expr)
	switch value := expr.(type) {
	case *ast.CompositeLit:
		return s.TypeKey(value.Type, file)
	case *ast.Ident:
		if kind := state.types[value.Name]; kind != "" {
			return kind
		}
	case *ast.CallExpr:
		results := s.callResults(value, file, state)
		if len(results) > 0 {
			return results[0]
		}
	}
	if state.fn != nil {
		return s.TypeOf(expr, state.fn)
	}
	return ""
}

func (s *scanner) callResults(call *ast.CallExpr, file *goscan.File, state *analysisState) []string {
	if sel, ok := call.Fun.(*ast.SelectorExpr); ok {
		if base, ok := sel.X.(*ast.Ident); ok {
			if receiver := state.types[base.Name]; receiver != "" {
				if target := s.Functions[receiver+"."+sel.Sel.Name]; target != nil {
					return target.Results
				}
				if s.Interfaces[receiver] != nil {
					// Every implementation agreeing on the result is the result.
					var agreed []string
					for _, candidate := range s.ByName[sel.Sel.Name] {
						if s.Implements(candidate.Receiver, receiver) && len(candidate.Results) > 0 {
							if agreed != nil && agreed[0] != candidate.Results[0] {
								return nil
							}
							agreed = candidate.Results
						}
					}
					if agreed != nil {
						return agreed
					}
				}
			}
		}
	}
	if state.fn != nil {
		return s.ResultsOf(call, state.fn)
	}
	return nil
}

func (s *scanner) isPackageCall(call *ast.CallExpr, file *goscan.File, pkg, name string) bool {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok || sel.Sel.Name != name {
		return false
	}
	base, ok := sel.X.(*ast.Ident)
	return ok && file.Imports[base.Name] == pkg
}

func stringPtr(value string) *string { return &value }
