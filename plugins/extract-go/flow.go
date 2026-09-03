package main

import (
	"go/ast"
	"go/types"
	"path"
	"sort"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// Flows are read out of the same layout as everything else here, and the
// layout is again the claim.
//
// Two things start one. An endpoint is somebody calling in, and the transport
// layer already says which use cases it runs and in what order. A policy is an
// event arriving, and the type it asserts on says which. Everything after that
// is the use case's own body: a field of UseCase is a port, a call on that port
// is a hop, and a domain call whose signature returns an event is what puts the
// event on the bus.
//
// What this cannot do it does not pretend to. There are no branches here - an
// `if` that returns early is not an alternative path, it is the end of this one
// - and a step inside a loop carries a note saying so rather than a frame the
// reader would have to trust. Nothing is observed running, so every step is
// declared: this reads code, and code is a claim about behaviour, not a record
// of it.

const (
	laneClient = "client"
	laneBus    = "bus"
)

// maxInline is how far a flow follows a use case into another one. Two is the
// whole of this estate - an endpoint into a use case into the use case behind
// its port - and a limit that is never reached is a limit that never has to be
// explained.
const maxInline = 2

type flowOptions struct {
	context string
	svcID   string
	service string
	// store is the slug the manifest gives the service's database. Without it
	// there is no lane to put persistence on, and the calls stay on the
	// service's own.
	store string
}

type flowReader struct {
	root     string
	opts     flowOptions
	b        *plugin.Builder
	bindings map[string]string
	useCases map[string]*pkg
	domains  map[string]*pkg
	// referenced records the events some step named, so that an event nothing
	// here could follow can be reported rather than silently left out.
	referenced  map[string]bool
	warnedStore bool
}

// extractFlows reads every sequence the service runs, in a fixed order:
// endpoints by operation id, then policies by type name.
func extractFlows(root string, opts flowOptions, endpoints []endpointDecl, events []string, b *plugin.Builder) []catalog.Flow {
	r := &flowReader{
		root:       root,
		opts:       opts,
		b:          b,
		bindings:   portBindings(root),
		useCases:   map[string]*pkg{},
		domains:    map[string]*pkg{},
		referenced: map[string]bool{},
	}

	out := []catalog.Flow{}
	for _, endpoint := range endpoints {
		if flow, ok := r.endpointFlow(endpoint); ok {
			out = append(out, flow)
		}
	}
	out = append(out, r.policyFlows()...)

	for _, event := range events {
		if !r.referenced[event] {
			b.Warn(event, "no flow reaches this event: nothing this extractor could follow publishes it")
		}
	}

	return out
}

// endpointFlow opens with the call from outside and continues into whatever the
// handler runs.
//
// The flow is named after the endpoint rather than after a use case because the
// endpoint is the thing that happened; where two use cases run behind one, the
// prose comes from the last of them, which is the one the endpoint is FOR - the
// others authorized it.
func (r *flowReader) endpointFlow(endpoint endpointDecl) (catalog.Flow, bool) {
	d := &flowDraft{seen: map[string]bool{}}
	d.lane(catalog.Participant{ID: laneClient, Kind: catalog.ParticipantActor})
	d.lane(r.serviceLane())

	d.add(catalog.Step{
		From:  laneClient,
		To:    r.opts.svcID,
		Kind:  catalog.StepRPC,
		Label: endpoint.id,
		Line:  at(endpoint.source, endpoint.line),
	})

	for _, useCase := range endpoint.useCases {
		r.walkUseCase(d, useCase, 0)
	}

	last := endpoint.useCases[len(endpoint.useCases)-1]
	name := slug(endpoint.id)
	id := r.opts.service + "-" + name

	return catalog.Flow{
		ID:           "flow." + id,
		Slug:         id,
		Name:         sentence(name),
		Summary:      r.useCaseDoc(last),
		Source:       endpoint.source,
		Owner:        r.opts.context,
		Participants: d.lanes,
		Steps:        d.steps,
	}, true
}

// policyFlows reads internal/application/policy: a rule of the form "when X has
// happened, do Y", which is a flow that opens on the bus.
//
// It opens with the event rather than with the policy, and that is what lets
// the two halves meet: a flow whose FIRST step names the same event another
// flow publishes is that flow's continuation, and nothing has to write the seam
// down for a reader to follow it.
func (r *flowReader) policyFlows() []catalog.Flow {
	out := []catalog.Flow{}

	pkg, err := parsePkg(r.root, "internal/application/policy")
	if err != nil {
		return out
	}

	imports := importsOf(pkg)

	names := []string{}
	byName := map[string]structDecl{}
	for _, decl := range pkg.structs() {
		if !exported(decl.name) {
			continue
		}
		names = append(names, decl.name)
		byName[decl.name] = decl
	}
	sort.Strings(names)

	for _, name := range names {
		decl := byName[name]

		handle := pkg.methods(name)["Handle"]
		if handle == nil {
			continue
		}

		event, ok := r.assertedEvent(handle, imports)
		if !ok {
			r.b.Warn(name, pkg.dir+": "+name+".Handle asserts on no event type; the policy is not paired with what triggers it")

			continue
		}

		d := &flowDraft{seen: map[string]bool{}}
		d.lane(catalog.Participant{ID: laneBus, Kind: catalog.ParticipantBroker})
		d.lane(r.serviceLane())

		source, line := pkg.position(handle.Pos())
		d.add(catalog.Step{
			From:  laneBus,
			To:    r.opts.svcID,
			Kind:  catalog.StepEvent,
			Ref:   event.id,
			Label: event.name,
			Line:  at(source, line),
		})
		r.referenced[event.id] = true

		r.walkBody(d, &scope{
			pkg:      pkg,
			fields:   structFields(decl.fields),
			imports:  imports,
			vars:     map[string]domainRef{},
			recv:     receiverIdent(handle),
			recvType: name,
		}, handle, 0)

		id := r.opts.service + "-" + slug(name)
		out = append(out, catalog.Flow{
			ID:           "flow." + id,
			Slug:         id,
			Name:         sentence(slug(name)),
			Summary:      withoutLeading(name+" ", decl.doc),
			Source:       decl.source,
			Owner:        r.opts.context,
			Participants: d.lanes,
			Steps:        d.steps,
		})
	}

	return out
}

// assertedEvent reads `changed, ok := e.(userevent.PasswordChanged)`: the type
// a policy asserts on is the fact it reacts to.
func (r *flowReader) assertedEvent(fn *ast.FuncDecl, imports map[string]string) (eventRef, bool) {
	var out eventRef
	found := false

	ast.Inspect(fn.Body, func(node ast.Node) bool {
		assert, ok := node.(*ast.TypeAssertExpr)
		if !ok || assert.Type == nil || found {
			return true
		}

		selector, name, cut := strings.Cut(types.ExprString(assert.Type), ".")
		if !cut {
			return true
		}
		aggregate, isEvent := eventPackage(imports[selector])
		if !isEvent {
			return true
		}

		out = eventRef{id: eventID(aggregateID(r.opts.svcID, aggregate), name), name: name}
		found = true

		return false
	})

	return out, found
}

type eventRef struct {
	id   string
	name string
}

// ---------------------------------------------------------------------------
// reading one use case
// ---------------------------------------------------------------------------

// scope is one function body being read: what the receiver is called, what
// ports its type holds, and what each local name has turned out to hold.
type scope struct {
	pkg     *pkg
	key     string
	fields  map[string]string
	imports map[string]string
	vars    map[string]domainRef
	recv    string
	// recvType is what the receiver's methods hang off: UseCase for a use
	// case, its own name for a policy.
	recvType string
}

// domainRef is a value whose type belongs to the service's own domain. Nothing
// else is tracked: a string is a string, and the only reason to follow a value
// at all is to notice when it is an event on its way to the bus.
type domainRef struct {
	aggregate string
	name      string
	event     bool
}

func (r *flowReader) walkUseCase(d *flowDraft, key string, depth int) {
	if depth > maxInline || d.seen[key] {
		return
	}
	d.seen[key] = true

	pkg := r.useCasePkg(key)
	if pkg == nil {
		return
	}

	handle := pkg.methods("UseCase")["Handle"]
	if handle == nil {
		r.b.Warn(key, pkg.dir+": no Handle on UseCase; the use case contributes no steps")

		return
	}

	r.walkBody(d, &scope{
		pkg:      pkg,
		key:      key,
		fields:   useCaseFields(pkg),
		imports:  importsOf(pkg),
		vars:     map[string]domainRef{},
		recv:     receiverIdent(handle),
		recvType: "UseCase",
	}, handle, depth)
}

func (r *flowReader) walkBody(d *flowDraft, s *scope, fn *ast.FuncDecl, depth int) {
	for _, site := range callSites(fn) {
		r.call(d, s, site, depth)
	}
}

func (r *flowReader) call(d *flowDraft, s *scope, site callSite, depth int) {
	selector, ok := site.call.Fun.(*ast.SelectorExpr)
	if !ok {
		return
	}
	method := selector.Sel.Name

	switch x := selector.X.(type) {
	case *ast.SelectorExpr:
		// uc.<port>.<Method>(...): the only shape that is a hop.
		receiver, ok := x.X.(*ast.Ident)
		if !ok || receiver.Name != s.recv {
			return
		}
		r.portCall(d, s, x.Sel.Name, method, site, depth)

	case *ast.Ident:
		switch {
		case x.Name == s.recv:
			// uc.<helper>(...): still this use case, in another method. The
			// writing a use case does in a helper is writing it does.
			if helper := s.pkg.methods(s.recvType)[method]; helper != nil {
				d.enter(site.note)
				defer d.leave()

				r.walkBody(d, &scope{
					pkg:      s.pkg,
					key:      s.key,
					fields:   s.fields,
					imports:  s.imports,
					vars:     map[string]domainRef{},
					recv:     receiverIdent(helper),
					recvType: s.recvType,
				}, helper, depth)
			}

		case s.imports[x.Name] != "":
			// session.Start(...): a domain constructor. Not a hop - nothing
			// left the service - but its signature says what came back.
			bind(s, site, r.resultsOfFunc(s.imports[x.Name], method))

		default:
			// sess.Revoke(...): a method on something the domain handed over.
			if ref, ok := s.vars[x.Name]; ok {
				bind(s, site, r.resultsOfMethod(ref, method))
			}
		}
	}
}

// portCall turns a call on a port into a hop, and decides whose lane it lands
// in. Everything a use case reaches, it reaches through a field of UseCase.
func (r *flowReader) portCall(d *flowDraft, s *scope, field, method string, site callSite, depth int) {
	declared := s.fields[field]
	if declared == "" || strings.HasPrefix(declared, "func") {
		// A clock and an id generator are ports too, but nothing is at the
		// other end of them.
		return
	}

	source, line := s.pkg.position(site.call.Pos())

	d.enter(site.note)
	defer d.leave()

	// A port this use case declares, bound in assembly to another use case.
	if target, ok := r.bindings[s.key+"."+declared]; ok {
		r.useCaseHop(d, target, "Port `"+declared+"`, bound at assembly to the "+operationName(target)+" use case.", at(source, line), depth)

		return
	}

	// A field holding another use case outright, which is what a policy does.
	if target, ok := useCaseSelector(declared, s.imports); ok {
		r.useCaseHop(d, target, "", at(source, line), depth)

		return
	}

	// A port of the domain: the store is at the other end of it.
	aggregate, name, ok := domainSelector(declared, s.imports)
	if !ok {
		r.b.Warn(s.key, s.pkg.dir+": port `"+field+" "+declared+"` is neither a domain port nor a use case; its calls are left out of the flow")

		return
	}

	d.add(catalog.Step{
		From:  r.opts.svcID,
		To:    r.storeLane(d),
		Kind:  catalog.StepCall,
		Label: method,
		Line:  at(source, line),
	})

	// The events a change produced are handed to the repository along with the
	// aggregate, so a port call carrying one is where the fact leaves for the
	// bus. What carries it there - an outbox, a relay - is the adapter's
	// business and is not a step the source can show.
	for _, arg := range site.call.Args {
		ident, ok := arg.(*ast.Ident)
		if !ok {
			continue
		}
		ref, tracked := s.vars[ident.Name]
		if !tracked || !ref.event {
			continue
		}

		id := eventID(aggregateID(r.opts.svcID, ref.aggregate), ref.name)
		d.add(catalog.Step{
			From:  r.opts.svcID,
			To:    d.laneID(r.busLane()),
			Kind:  catalog.StepEvent,
			Ref:   id,
			Label: ref.name,
			Line:  at(source, line),
		})
		r.referenced[id] = true
	}

	bind(s, site, r.resultsOfPortMethod(aggregate, name, method))
}

// useCaseHop is a call into another use case of the same service: a message to
// itself, and then that use case's own steps.
func (r *flowReader) useCaseHop(d *flowDraft, target, note, line string, depth int) {
	d.add(catalog.Step{
		From:  r.opts.svcID,
		To:    r.opts.svcID,
		Kind:  catalog.StepCall,
		Label: operationName(target),
		Note:  note,
		Line:  line,
	})

	r.walkUseCase(d, target, depth+1)
}

// ---------------------------------------------------------------------------
// following a value back to its type
// ---------------------------------------------------------------------------

// resultsOfFunc reads the results of a package-level function of a domain
// package: `func Start(...) (*Session, event.SessionStarted, error)`.
func (r *flowReader) resultsOfFunc(importPath, name string) []domainRef {
	aggregate, ok := domainPackage(importPath)
	if !ok {
		return nil
	}

	pkg := r.domainPkg(aggregate)
	if pkg == nil {
		return nil
	}

	for _, file := range pkg.files {
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Recv != nil || fn.Name.Name != name {
				continue
			}

			return r.resultRefs(pkg, aggregate, fn.Type)
		}
	}

	return nil
}

// resultsOfMethod reads the results of a method on a domain type: what
// `sess.Revoke(...)` gives back.
func (r *flowReader) resultsOfMethod(ref domainRef, name string) []domainRef {
	pkg := r.domainPkg(ref.aggregate)
	if pkg == nil {
		return nil
	}

	fn := pkg.methods(ref.name)[name]
	if fn == nil {
		return nil
	}

	return r.resultRefs(pkg, ref.aggregate, fn.Type)
}

// resultsOfPortMethod reads the results of one method of a domain port:
// `ByID(ctx, id) (*Session, error)` is how a use case comes to hold a Session.
func (r *flowReader) resultsOfPortMethod(aggregate, port, name string) []domainRef {
	pkg := r.domainPkg(aggregate)
	if pkg == nil {
		return nil
	}

	for _, file := range pkg.files {
		for _, decl := range file.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok {
				continue
			}

			for _, spec := range gen.Specs {
				typeSpec, ok := spec.(*ast.TypeSpec)
				if !ok || typeSpec.Name.Name != port {
					continue
				}
				iface, ok := typeSpec.Type.(*ast.InterfaceType)
				if !ok || iface.Methods == nil {
					continue
				}

				for _, method := range iface.Methods.List {
					fn, ok := method.Type.(*ast.FuncType)
					if !ok || len(method.Names) == 0 || method.Names[0].Name != name {
						continue
					}

					return r.resultRefs(pkg, aggregate, fn)
				}
			}
		}
	}

	return nil
}

// resultRefs turns a result list into what each position holds, by position, so
// that the names on the left of an assignment can be paired with it. A result
// this cannot place - a string, an error - leaves a hole rather than shifting
// everything after it along.
func (r *flowReader) resultRefs(pkg *pkg, aggregate string, fn *ast.FuncType) []domainRef {
	if fn == nil || fn.Results == nil {
		return nil
	}

	imports := importsOf(pkg)

	var out []domainRef
	for _, result := range fn.Results.List {
		ref := domainRef{}

		name := strings.TrimPrefix(strings.TrimPrefix(types.ExprString(result.Type), "[]"), "*")
		name = strings.TrimPrefix(name, "[]")

		if selector, typeName, cut := strings.Cut(name, "."); cut {
			if agg, isEvent := eventPackage(imports[selector]); isEvent {
				ref = domainRef{aggregate: agg, name: typeName, event: true}
			}
		} else if exported(name) {
			ref = domainRef{aggregate: aggregate, name: name}
		}

		// One entry per name, because `a, b Session` is two results.
		count := len(result.Names)
		if count == 0 {
			count = 1
		}
		for range count {
			out = append(out, ref)
		}
	}

	return out
}

func bind(s *scope, site callSite, results []domainRef) {
	for i, expr := range site.lhs {
		if i >= len(results) || results[i].name == "" {
			continue
		}
		if ident, ok := expr.(*ast.Ident); ok && ident.Name != "_" {
			s.vars[ident.Name] = results[i]
		}
	}
}

// ---------------------------------------------------------------------------
// the draft a flow is built up in
// ---------------------------------------------------------------------------

type flowDraft struct {
	lanes []catalog.Participant
	steps catalog.FlowNodes
	seen  map[string]bool
	// loops is the loops enclosing whatever is being read right now, outermost
	// first. A use case called once per session is read once, and every step it
	// contributes happens once per session; the fact belongs to the steps, not
	// to the call that got there.
	loops []string
}

func (d *flowDraft) enter(loop string) { d.loops = append(d.loops, loop) }
func (d *flowDraft) leave()            { d.loops = d.loops[:len(d.loops)-1] }

// note puts the loops in front of whatever the step had to say for itself.
func (d *flowDraft) note(own string) string {
	var loops []string
	for _, loop := range d.loops {
		if loop == "" || contains(loops, loop) {
			continue
		}
		loops = append(loops, loop)
	}

	out := ""
	if len(loops) > 0 {
		out = strings.Join(loops, ", ") + "."
	}

	return strings.TrimSpace(out + " " + own)
}

func contains(list []string, value string) bool {
	for _, existing := range list {
		if existing == value {
			return true
		}
	}

	return false
}

// lane declares a participant once, in the order it was first needed. That
// order is the order of the lanes in every picture drawn from this.
func (d *flowDraft) lane(p catalog.Participant) string {
	for _, existing := range d.lanes {
		if existing.ID == p.ID {
			return p.ID
		}
	}
	d.lanes = append(d.lanes, p)

	return p.ID
}

func (d *flowDraft) laneID(p catalog.Participant) string { return d.lane(p) }

func (d *flowDraft) add(step catalog.Step) {
	step.Type = "step"
	step.ID = "s" + strconv.Itoa(len(d.steps)+1)
	step.Note = d.note(step.Note)
	// Nothing here has been watched running. `declared` is the whole of what
	// reading source can claim.
	step.Status = catalog.StatusDeclared
	d.steps = append(d.steps, &step)
}

func (r *flowReader) serviceLane() catalog.Participant {
	context := r.opts.context

	return catalog.Participant{ID: r.opts.svcID, Kind: catalog.ParticipantService, Context: &context}
}

func (r *flowReader) busLane() catalog.Participant {
	return catalog.Participant{ID: laneBus, Kind: catalog.ParticipantBroker}
}

// storeLane is the lane persistence lands in, and the service's own when the
// manifest does not name a store. A call on a repository happened either way;
// what is unknown is only where it landed, and saying so once is better than
// inventing a database nobody named.
//
// The id is `<service>-<store>` rather than the store's own `<service>.<store>`
// because a participant that is not a service has to be a bare name: a dot is
// how the diagram model spells containment, and a lane called `auth.auth.pg`
// is read there as something inside the service rather than beside it.
func (r *flowReader) storeLane(d *flowDraft) string {
	if r.opts.store == "" {
		if !r.warnedStore {
			r.b.Warn(r.opts.svcID, "no store named in the options, so repository calls stay on the service's own lane")
			r.warnedStore = true
		}

		return r.opts.svcID
	}

	context := r.opts.context

	return d.lane(catalog.Participant{
		ID:      r.opts.service + "-" + r.opts.store,
		Kind:    catalog.ParticipantStore,
		Context: &context,
	})
}

// ---------------------------------------------------------------------------
// syntax helpers
// ---------------------------------------------------------------------------

// callSite is one call, the names it was assigned to, and whether it sits
// inside a loop.
type callSite struct {
	call *ast.CallExpr
	lhs  []ast.Expr
	note string
}

// callSites lists the calls of a body in source order.
//
// The order is the flow. ast.Inspect walks children in the order they are
// written, so a call in an `if` initialiser comes before the block it guards,
// which is what a reader of the code sees too.
func callSites(fn *ast.FuncDecl) []callSite {
	if fn == nil || fn.Body == nil {
		return nil
	}

	assigned := map[*ast.CallExpr][]ast.Expr{}
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		assign, ok := node.(*ast.AssignStmt)
		if !ok || len(assign.Rhs) != 1 {
			return true
		}
		if call, ok := assign.Rhs[0].(*ast.CallExpr); ok {
			assigned[call] = assign.Lhs
		}

		return true
	})

	var out []callSite
	var stack []ast.Node

	ast.Inspect(fn.Body, func(node ast.Node) bool {
		if node == nil {
			stack = stack[:len(stack)-1]

			return true
		}
		if call, ok := node.(*ast.CallExpr); ok {
			out = append(out, callSite{call: call, lhs: assigned[call], note: loopNote(stack)})
		}
		stack = append(stack, node)

		return true
	})

	return out
}

// loopNote says that a step repeats, for the innermost loop it sits in.
//
// A loop is a frame the catalog can hold, and this deliberately does not build
// one: the frame would have to say what it repeats until, and the condition is
// written for a compiler rather than for a reader. A note says the true part.
func loopNote(stack []ast.Node) string {
	for i := len(stack) - 1; i >= 0; i-- {
		switch node := stack[i].(type) {
		case *ast.RangeStmt:
			return "inside a loop over `" + types.ExprString(node.X) + "`"
		case *ast.ForStmt:
			if node.Cond != nil {
				return "inside a loop, while `" + types.ExprString(node.Cond) + "`"
			}

			return "inside a loop"
		}
	}

	return ""
}

// useCaseFields reads the ports off `type UseCase struct`.
func useCaseFields(pkg *pkg) map[string]string {
	for _, decl := range pkg.structs() {
		if decl.name == "UseCase" {
			return structFields(decl.fields)
		}
	}

	return map[string]string{}
}

func structFields(st *ast.StructType) map[string]string {
	out := map[string]string{}
	if st == nil || st.Fields == nil {
		return out
	}

	for _, field := range st.Fields.List {
		declared := types.ExprString(field.Type)
		for _, name := range field.Names {
			out[name.Name] = declared
		}
	}

	return out
}

// importsOf maps the name a package's files refer to an import by - its alias,
// or the last segment of its path - to the path itself.
func importsOf(pkg *pkg) map[string]string {
	out := map[string]string{}

	for _, file := range pkg.files {
		for _, spec := range file.Imports {
			importPath := strings.Trim(spec.Path.Value, `"`)

			name := path.Base(importPath)
			if spec.Name != nil {
				name = spec.Name.Name
			}
			out[name] = importPath
		}
	}

	return out
}

// domainPackage reads an import of the service's own domain back to the
// aggregate it belongs to, and says no to everything else.
func domainPackage(importPath string) (string, bool) {
	_, after, found := strings.Cut(importPath, "/internal/domain/")
	if !found || after == "" || strings.Contains(after, "/") {
		return "", false
	}

	return after, true
}

// eventPackage is the same for `internal/domain/<aggregate>/event`, which is
// where a fact the aggregate publishes is declared.
func eventPackage(importPath string) (string, bool) {
	_, after, found := strings.Cut(importPath, "/internal/domain/")
	if !found {
		return "", false
	}

	aggregate, rest, found := strings.Cut(after, "/")

	return aggregate, found && rest == "event"
}

// domainSelector reads a field type like `session.Repository` back to the
// aggregate and the port name.
func domainSelector(declared string, imports map[string]string) (string, string, bool) {
	selector, name, found := strings.Cut(strings.TrimPrefix(declared, "*"), ".")
	if !found {
		return "", "", false
	}

	aggregate, ok := domainPackage(imports[selector])

	return aggregate, name, ok
}

// useCaseSelector reads `*end_after_credential_change.UseCase` back to the use
// case key.
func useCaseSelector(declared string, imports map[string]string) (string, bool) {
	selector, name, found := strings.Cut(strings.TrimPrefix(declared, "*"), ".")
	if !found || name != "UseCase" {
		return "", false
	}

	importPath := imports[selector]

	_, after, found := strings.Cut(importPath, "/internal/application/")
	if !found {
		return "", false
	}

	aggregate, rest, found := strings.Cut(after, "/usecases/")
	if !found || strings.Contains(rest, "/") {
		return "", false
	}

	return aggregate + "/" + rest, true
}

func (r *flowReader) useCasePkg(key string) *pkg {
	if cached, ok := r.useCases[key]; ok {
		return cached
	}

	aggregate, name, _ := strings.Cut(key, "/")
	pkg, err := parsePkg(r.root, path.Join("internal/application", aggregate, "usecases", name))
	if err != nil {
		r.b.Warn(key, "internal/application/"+aggregate+"/usecases/"+name+" could not be parsed; its steps are missing from every flow that runs it")
		pkg = nil
	}
	r.useCases[key] = pkg

	return pkg
}

func (r *flowReader) domainPkg(aggregate string) *pkg {
	if cached, ok := r.domains[aggregate]; ok {
		return cached
	}

	pkg, err := parsePkg(r.root, path.Join("internal/domain", aggregate))
	if err != nil {
		pkg = nil
	}
	r.domains[aggregate] = pkg

	return pkg
}

func (r *flowReader) useCaseDoc(key string) string {
	pkg := r.useCasePkg(key)
	if pkg == nil {
		return ""
	}

	aggregate, name, _ := strings.Cut(key, "/")

	return operationDoc(r.root, path.Join("internal/application", aggregate, "usecases", name), pkg)
}

func operationName(key string) string {
	_, name, _ := strings.Cut(key, "/")

	return camel(name)
}

// at is the `file:line` a reader can open. Written here rather than at every
// call site so that a step without a position says nothing instead of ":0".
func at(source string, line int) string {
	if source == "" || line == 0 {
		return ""
	}

	return source + ":" + strconv.Itoa(line)
}

// sentence turns a slug into a name written the way a person would: one capital
// at the front, and nothing else touched.
func sentence(slug string) string {
	words := strings.Split(slug, "-")
	if len(words) == 0 || words[0] == "" {
		return slug
	}

	runes := []rune(words[0])
	if runes[0] >= 'a' && runes[0] <= 'z' {
		runes[0] = runes[0] - 'a' + 'A'
	}
	words[0] = string(runes)

	return strings.Join(words, " ")
}
