package extractwatermill

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/token"
	"path"
	"reflect"
	"sort"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/internal/goscan"
	"github.com/shortlink-org/portolan/plugin"
)

const watermillMessageImport = "github.com/ThreeDotsLabs/watermill/message"

type goType struct {
	key    string
	name   string
	doc    string
	fields []string
	at     goscan.Source
}

type configField struct {
	value string
	env   string
}

type function struct {
	key      string
	name     string
	receiver string
	file     *goscan.File
	decl     *ast.FuncDecl
	params   []string
	types    map[string]string
	results  []string
}

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

type handler struct {
	name          string
	input         topic
	inputPayload  string
	consumerGroup string
	entrypoint    string
	publications  []publication
	at            goscan.Source
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

type analysisState struct {
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

// scanner is the tree, and what Watermill leaves in it: the types and
// functions, what each function publishes, and the handlers registered on a
// router or a CQRS processor.
type scanner struct {
	*goscan.Tree
	types         map[string]*goType
	configFields  map[string]configField
	functions     map[string]*function
	methodResults map[string]string
	methodChoices map[string]map[string]bool
	summaries     map[string][]publication
	handlers      []handler
	transport     string
}

func extract(in plugin.Input, opts Options) (plugin.Response, error) {
	b := &plugin.Builder{}
	tree, err := goscan.Read(in.Root)
	if err != nil {
		return plugin.Response{}, err
	}
	s := &scanner{
		Tree:          tree,
		types:         map[string]*goType{},
		configFields:  map[string]configField{},
		functions:     map[string]*function{},
		methodResults: map[string]string{},
		methodChoices: map[string]map[string]bool{},
		summaries:     map[string][]publication{},
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
		b.Warn(in.Root, "no Watermill Router.AddHandler or AddNoPublisherHandler declaration was found")
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
	s.finalizeMethodResults()
	for _, fn := range s.functions {
		if fn.decl.Body == nil {
			continue
		}
		state := s.stateFor(fn)
		s.summaries[fn.key] = s.analyzeBlock(fn.decl.Body, fn.file, state, false).publications
	}
	for _, fn := range s.functions {
		if fn.decl.Body != nil {
			s.indexHandlers(fn, b)
			s.indexCQRS(fn, b)
		}
	}
}

func (s *scanner) indexDeclarations(file *goscan.File) {
	for _, decl := range file.Node.Decls {
		switch item := decl.(type) {
		case *ast.GenDecl:
			if item.Tok != token.TYPE {
				continue
			}
			for _, raw := range item.Specs {
				s.indexType(file, item, raw.(*ast.TypeSpec))
			}
		case *ast.FuncDecl:
			s.indexFunction(file, item)
		}
	}
}

func (s *scanner) indexType(file *goscan.File, gen *ast.GenDecl, spec *ast.TypeSpec) {
	key := file.Pkg + "." + spec.Name.Name
	switch body := spec.Type.(type) {
	case *ast.StructType:
		doc := ""
		if spec.Doc != nil {
			doc = strings.TrimSpace(spec.Doc.Text())
		} else if gen.Doc != nil {
			doc = strings.TrimSpace(gen.Doc.Text())
		}
		s.types[key] = &goType{key: key, name: spec.Name.Name, doc: doc, fields: s.FieldsOf(body), at: s.At(spec.Pos())}
		for _, field := range body.Fields.List {
			if field.Tag == nil {
				continue
			}
			tagText, _ := strconv.Unquote(field.Tag.Value)
			tag := reflect.StructTag(tagText)
			for _, name := range field.Names {
				s.configFields[key+"."+name.Name] = configField{value: tag.Get("default"), env: tag.Get("envconfig")}
			}
		}
	case *ast.InterfaceType:
		for _, field := range body.Methods.List {
			fnType, ok := field.Type.(*ast.FuncType)
			if !ok || len(field.Names) == 0 {
				continue
			}
			results := s.resultTypes(fnType.Results, file)
			if len(results) > 0 {
				s.addMethodResult(key, field.Names[0].Name, results[0])
			}
		}
	}
}

func (s *scanner) indexFunction(file *goscan.File, decl *ast.FuncDecl) {
	key := file.Pkg + "." + decl.Name.Name
	receiver := ""
	if decl.Recv != nil && len(decl.Recv.List) > 0 {
		receiver = s.TypeKey(decl.Recv.List[0].Type, file)
		key = receiver + "." + decl.Name.Name
	}
	fn := &function{key: key, name: decl.Name.Name, receiver: receiver, file: file, decl: decl, types: map[string]string{}, results: s.resultTypes(decl.Type.Results, file)}
	if decl.Type.Params != nil {
		for _, field := range decl.Type.Params.List {
			typeKey := s.TypeKey(field.Type, file)
			for _, name := range field.Names {
				fn.params = append(fn.params, name.Name)
				fn.types[name.Name] = typeKey
			}
		}
	}
	s.functions[key] = fn
	if receiver != "" && len(fn.results) > 0 {
		s.addMethodResult(receiver, fn.name, fn.results[0])
	}
}

func (s *scanner) resultTypes(fields *ast.FieldList, file *goscan.File) []string {
	if fields == nil {
		return nil
	}
	var out []string
	for _, field := range fields.List {
		count := max(1, len(field.Names))
		for range count {
			out = append(out, s.TypeKey(field.Type, file))
		}
	}
	return out
}

func (s *scanner) addMethodResult(receiver, name, result string) {
	if result == "" {
		return
	}
	for _, key := range []string{receiver + "." + name, name} {
		if s.methodChoices[key] == nil {
			s.methodChoices[key] = map[string]bool{}
		}
		s.methodChoices[key][result] = true
	}
}

func (s *scanner) finalizeMethodResults() {
	for key, choices := range s.methodChoices {
		if len(choices) == 1 {
			for result := range choices {
				s.methodResults[key] = result
			}
		}
	}
}

func (s *scanner) stateFor(fn *function) *analysisState {
	state := &analysisState{types: map[string]string{}, strings: map[string]topic{}, bytesPayload: map[string]string{}, messages: map[string]string{}, topicParams: map[string]int{}}
	for name, kind := range fn.types {
		state.types[name] = kind
	}
	for i, name := range fn.params {
		state.topicParams[name] = i
	}
	return state
}

func cloneState(parent *analysisState) *analysisState {
	state := &analysisState{types: map[string]string{}, strings: map[string]topic{}, bytesPayload: map[string]string{}, messages: map[string]string{}, topicParams: map[string]int{}}
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
			resolved := s.topicValue(call.Args[0], file, state, map[string]bool{})
			if resolved.valid() {
				resolved.at = s.At(call.Args[0].Pos())
				out = append(out, publication{topic: resolved, payload: s.payloadOf(call.Args[1], file, state), at: s.At(call.Pos())})
			}
		}
		if includeHelpers {
			if key := s.functionKey(call.Fun, file); key != "" {
				for _, summary := range s.summaries[key] {
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

func (s *scanner) indexHandlers(fn *function, b *plugin.Builder) {
	outer := s.stateFor(fn)
	s.collectAssignments(fn.decl.Body, fn.file, outer)
	ast.Inspect(fn.decl.Body, func(node ast.Node) bool {
		if _, ok := node.(*ast.FuncLit); ok {
			return false
		}
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || (sel.Sel.Name != "AddHandler" && sel.Sel.Name != "AddNoPublisherHandler") {
			return true
		}
		usesMessage := false
		for _, imported := range fn.file.Imports {
			if imported == watermillMessageImport {
				usesMessage = true
			}
		}
		if !usesMessage || len(call.Args) < 4 {
			return true
		}
		callbackIndex := len(call.Args) - 1
		input := s.topicValue(call.Args[1], fn.file, outer, map[string]bool{})
		if input.address == "" {
			b.Warn(s.At(call.Args[1].Pos()).String(), "Watermill handler topic could not be resolved to a literal, constant, or config default")
			return false
		}
		name := s.topicValue(call.Args[0], fn.file, outer, map[string]bool{}).address
		if name == "" {
			name = s.PrintNode(call.Args[0])
		}
		callbackState := cloneState(outer)
		var body *ast.BlockStmt
		entrypoint := ""
		switch cb := goscan.Unwrap(call.Args[callbackIndex]).(type) {
		case *ast.FuncLit:
			body = cb.Body
			if cb.Type.Params != nil {
				for _, field := range cb.Type.Params.List {
					for _, param := range field.Names {
						callbackState.types[param.Name] = s.TypeKey(field.Type, fn.file)
					}
				}
			}
		case *ast.Ident:
			if target := s.functions[fn.file.Pkg+"."+cb.Name]; target != nil {
				body = target.decl.Body
				callbackState = s.stateFor(target)
				entrypoint = watermillFunctionKey(target)
			}
		}
		if body == nil {
			b.Warn(s.At(call.Args[callbackIndex].Pos()).String(), "Watermill handler body could not be resolved")
			return false
		}
		found := s.analyzeBlock(body, fn.file, callbackState, true)
		if sel.Sel.Name == "AddHandler" && len(call.Args) >= 7 {
			output := s.topicValue(call.Args[3], fn.file, outer, map[string]bool{})
			if output.address != "" {
				found.publications = append(found.publications, publication{topic: output, at: s.At(call.Args[3].Pos())})
			}
		}
		group := ""
		if subscriber, ok := call.Args[2].(*ast.Ident); ok {
			group = s.subscriberGroup(fn.decl.Body, fn.file, outer, subscriber.Name)
		}
		s.handlers = append(s.handlers, handler{name: name, input: input, inputPayload: found.input, consumerGroup: group, entrypoint: entrypoint, publications: uniquePublications(found.publications), at: s.At(call.Pos())})
		return false
	})
}

func watermillFunctionKey(fn *function) string {
	name := fn.name
	if fn.receiver != "" {
		name = goscan.LastSegment(fn.receiver) + "." + name
	}
	dir := path.Dir(fn.file.Name)
	if dir == "." || dir == "" {
		return name
	}
	return dir + ":" + name
}

func (s *scanner) indexCQRS(fn *function, b *plugin.Builder) {
	usesCQRS := false
	for _, imported := range fn.file.Imports {
		if imported == "github.com/ThreeDotsLabs/watermill/components/cqrs" {
			usesCQRS = true
		}
	}
	if !usesCQRS {
		return
	}
	state := s.stateFor(fn)
	s.collectAssignments(fn.decl.Body, fn.file, state)
	processorTopics := map[string]topic{}
	handlers := map[string]cqrsHandler{}

	ast.Inspect(fn.decl.Body, func(node ast.Node) bool {
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
			if processorKind := s.cqrsCallName(call, fn.file); processorKind == "NewEventProcessorWithConfig" || processorKind == "NewCommandProcessorWithConfig" || processorKind == "NewEventProcessor" || processorKind == "NewCommandProcessor" {
				if resolved := s.cqrsProcessorTopic(call, fn.file, state); resolved.valid() {
					processorTopics[name.Name] = resolved
				}
			}
			if built, ok := s.cqrsHandler(call, fn.file, state); ok {
				handlers[name.Name] = built
			}
		}
		return true
	})

	ast.Inspect(fn.decl.Body, func(node ast.Node) bool {
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
			group = s.topicValue(call.Args[0], fn.file, state, map[string]bool{}).address
			start = 1
		}
		for _, arg := range call.Args[start:] {
			var built cqrsHandler
			var found bool
			switch value := goscan.Unwrap(arg).(type) {
			case *ast.Ident:
				built, found = handlers[value.Name]
			case *ast.CallExpr:
				built, found = s.cqrsHandler(value, fn.file, state)
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
	if !ok || file.Imports[base.Name] != "github.com/ThreeDotsLabs/watermill/components/cqrs" {
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
	if name == "NewEventProcessor" || name == "NewCommandProcessor" {
		index = 1
	}
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
		input := ensure(found.input)
		addMessage(input, catalog.ChannelMessage{Name: inputPayload, Title: inputPayload, Doc: s.payloadDescription(found.inputPayload, "Input"), Direction: catalog.ChannelReceive})
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

func (s *scanner) flow(serviceID, owner string, found handler, pub *publication) catalog.Flow {
	inputBroker := "watermill." + goscan.Slug(found.input.address)
	ending := "consume"
	name := goscan.Title(found.name)
	summary := "Watermill handler `" + found.name + "` consumes `" + found.input.address + "`"
	participants := []catalog.Participant{{ID: serviceID, Kind: catalog.ParticipantService, Context: stringPtr(owner)}, {ID: inputBroker, Kind: catalog.ParticipantBroker, Label: goscan.FirstNonEmpty(s.transport, "Watermill") + " · " + found.input.address}}
	note := s.payloadDescription(found.inputPayload, "Input")
	if found.consumerGroup != "" {
		note += " Consumer group `" + found.consumerGroup + "`."
	}
	steps := catalog.FlowNodes{&catalog.Step{Type: "step", ID: "receive", From: inputBroker, To: serviceID, Kind: catalog.StepEvent, Label: found.name, Status: catalog.StatusDeclared, Note: strings.TrimSpace(note), Line: found.at.String(), ContinuesAt: found.entrypoint, Handoff: s.messageHandoff(found.input.address, "receive")}}
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
	return catalog.Flow{ID: "flow." + slugged, Slug: slugged, Name: name, Summary: summary, Source: found.at.String(), Trigger: &catalog.FlowTrigger{Kind: "event", Label: found.input.address, Confidence: "high"}, Owner: owner, Participants: participants, Steps: steps}
}

func (s *scanner) branchedFlow(serviceID, owner string, found handler) catalog.Flow {
	inputBroker := "watermill." + goscan.Slug(found.input.address)
	participants := []catalog.Participant{
		{ID: serviceID, Kind: catalog.ParticipantService, Context: stringPtr(owner)},
		{ID: inputBroker, Kind: catalog.ParticipantBroker, Label: goscan.FirstNonEmpty(s.transport, "Watermill") + " · " + found.input.address},
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
	note := s.payloadDescription(found.inputPayload, "Input")
	if found.consumerGroup != "" {
		note += " Consumer group `" + found.consumerGroup + "`."
	}
	steps := catalog.FlowNodes{
		&catalog.Step{Type: "step", ID: "receive", From: inputBroker, To: serviceID, Kind: catalog.StepEvent, Label: found.name, Status: catalog.StatusDeclared, Note: strings.TrimSpace(note), Line: found.at.String(), ContinuesAt: found.entrypoint, Handoff: s.messageHandoff(found.input.address, "receive")},
		&catalog.Alt{Type: "alt", ID: "outcome", Branches: branches},
	}
	slugged := goscan.Slug(goscan.LastSegment(serviceID) + "-watermill-" + found.name)
	return catalog.Flow{
		ID:           "flow." + slugged,
		Slug:         slugged,
		Name:         goscan.Title(found.name),
		Summary:      "Watermill handler `" + found.name + "` consumes `" + found.input.address + "` and source control flow branches to " + strings.Join(addresses, " or ") + ".",
		Source:       found.at.String(),
		Trigger:      &catalog.FlowTrigger{Kind: "event", Label: found.input.address, Confidence: "high"},
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
		return s.constantValue(file.Pkg+"."+value.Name, visiting)
	case *ast.SelectorExpr:
		base, ok := value.X.(*ast.Ident)
		if !ok {
			break
		}
		if imported := file.Imports[base.Name]; imported != "" {
			return s.constantValue(imported+"."+value.Sel.Name, visiting)
		}
		if kind := state.types[base.Name]; kind != "" {
			if field, ok := s.configFields[kind+"."+value.Sel.Name]; ok && field.value != "" {
				return topic{address: field.value, env: field.env, expr: s.PrintNode(expr), param: -1, at: s.At(expr.Pos())}
			}
		}
	}
	return topic{param: -1, expr: s.PrintNode(expr)}
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
	if ident, ok := expr.(*ast.Ident); ok {
		if payload := state.messages[ident.Name]; payload != "" {
			return payload
		}
		if payload := state.bytesPayload[ident.Name]; payload != "" {
			return payload
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
		return state.types[value.Name]
	case *ast.CallExpr:
		results := s.callResults(value, file, state)
		if len(results) > 0 {
			return results[0]
		}
	}
	return ""
}

func (s *scanner) callResults(call *ast.CallExpr, file *goscan.File, state *analysisState) []string {
	if key := s.functionKey(call.Fun, file); key != "" {
		if fn := s.functions[key]; fn != nil {
			return fn.results
		}
	}
	if sel, ok := call.Fun.(*ast.SelectorExpr); ok {
		if base, ok := sel.X.(*ast.Ident); ok {
			if receiver := state.types[base.Name]; receiver != "" {
				if result := s.methodResults[receiver+"."+sel.Sel.Name]; result != "" {
					return []string{result}
				}
			}
		}
		if result := s.methodResults[sel.Sel.Name]; result != "" {
			return []string{result}
		}
	}
	return nil
}

func (s *scanner) functionKey(expr ast.Expr, file *goscan.File) string {
	switch value := expr.(type) {
	case *ast.Ident:
		return file.Pkg + "." + value.Name
	case *ast.SelectorExpr:
		base, ok := value.X.(*ast.Ident)
		if ok && file.Imports[base.Name] != "" {
			return file.Imports[base.Name] + "." + value.Sel.Name
		}
	}
	return ""
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
