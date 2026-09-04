package main

import (
	"encoding/json"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

const laneClient = "client"
const laneBus = "bus"

// hop is one span read as a message between two lanes.
type hop struct {
	from, to  catalog.Participant
	kind      catalog.StepKind
	ref       string
	label     string
	status    catalog.Status
	entry     bool   // somebody calling in: the opening of an endpoint flow
	operation string // for an entry, the operation the route answers on
	consume   bool
	eventID   string
	call      *catalog.RpcCall
	file      string
}

// key is what makes two hops the same hop, for a declared step to match on.
func (h hop) key() string {
	switch {
	case h.entry:
		return "entry|" + h.to.ID + "|" + h.operation
	case h.kind == catalog.StepEvent && h.consume:
		return "con|" + h.to.ID + "|" + h.eventID
	case h.kind == catalog.StepEvent:
		return "pub|" + h.from.ID + "|" + h.eventID
	case h.kind == catalog.StepRPC:
		return "rpc|" + h.from.ID + "|" + h.ref
	}

	return "call|" + h.from.ID + "|" + h.to.ID + "|" + h.label
}

type verifier struct {
	l        *lookup
	b        *plugin.Builder
	children map[string][]*span
	byID     map[string]*span
	warned   map[string]bool

	overlays  map[string]*overlay // declared flow id -> its raised copy
	observed  map[string]*observed
	consumers map[string]map[string]string // event id -> service id -> note
	calls     map[string]catalog.RpcCall
	callers   map[string]map[string]bool // call id -> service ids that made it
}

type overlay struct {
	flow   *catalog.Flow
	svc    *catalog.Service
	seen   map[string]bool
	traces int
	file   string
}

type observed struct {
	svc    *catalog.Service
	root   hop
	hops   []hop
	traces int
	files  map[string]bool
}

func verify(req plugin.Request, opts Options) (plugin.Response, error) {
	b := &plugin.Builder{}
	root := req.Input.Root

	spans, files, err := readTraces(root, opts.Traces)
	if err != nil {
		return plugin.Response{}, err
	}
	if len(files) == 0 {
		b.Warn(root, "no trace files matched "+strings.Join(opts.Traces, ", ")+"; nothing is verified")
	}

	v := &verifier{
		l:         newLookup(&req.Catalog, opts),
		b:         b,
		children:  map[string][]*span{},
		byID:      map[string]*span{},
		warned:    map[string]bool{},
		overlays:  map[string]*overlay{},
		observed:  map[string]*observed{},
		consumers: map[string]map[string]string{},
		calls:     map[string]catalog.RpcCall{},
		callers:   map[string]map[string]bool{},
	}
	for i := range spans {
		s := &spans[i]
		v.byID[s.spanID] = s
	}
	var roots []*span
	for i := range spans {
		s := &spans[i]
		if s.parentID == "" || v.byID[s.parentID] == nil {
			roots = append(roots, s)

			continue
		}
		v.children[s.parentID] = append(v.children[s.parentID], s)
	}
	sort.Slice(roots, func(i, j int) bool {
		if roots[i].start != roots[j].start {
			return roots[i].start < roots[j].start
		}

		return roots[i].spanID < roots[j].spanID
	})

	for _, r := range roots {
		v.trace(r)
	}

	fragment := v.fragment(req.Input)
	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}
	b.File(firstNonEmpty(opts.Out, "observed.json"), string(encoded)+"\n")

	return b.Response(), nil
}

// trace reads one trace from its root: the root's sequence is matched to a
// declared flow or written down as observed, and every consumer inside it is
// the opening of a flow of its own, matched the same way.
func (v *verifier) trace(root *span) {
	hops, spans := v.sequence(root)
	if len(hops) == 0 {
		return
	}

	for _, h := range hops {
		if h.call != nil {
			if _, seen := v.calls[h.call.ID]; !seen {
				v.calls[h.call.ID] = *h.call
			}
			if v.callers[h.call.ID] == nil {
				v.callers[h.call.ID] = map[string]bool{}
			}
			v.callers[h.call.ID][h.from.ID] = true
		}
		if h.consume && h.eventID != "" {
			if v.consumers[h.eventID] == nil {
				v.consumers[h.eventID] = map[string]string{}
			}
			if _, seen := v.consumers[h.eventID][h.to.ID]; !seen {
				v.consumers[h.eventID][h.to.ID] = "Seen consuming it in " + h.file + "."
			}
		}
	}

	matched := v.match(hops[0], hops)
	for i := 1; i < len(hops); i++ {
		if hops[i].consume {
			sub, _ := v.sequence(spans[i])
			v.match(sub[0], sub)
		}
	}
	if !matched {
		v.observe(hops)
	}
}

// match finds the declared flow the sequence opens, and raises what the
// sequence shows. False when no flow opens that way.
func (v *verifier) match(opening hop, hops []hop) bool {
	var key string
	switch {
	case opening.entry:
		key = openingKey(catalog.StepRPC, opening.to.ID, opening.operation)
	case opening.consume && opening.eventID != "":
		key = openingKey(catalog.StepEvent, opening.to.ID, opening.eventID)
	default:
		return false
	}
	flow := v.l.openings[key]
	if flow == nil {
		return false
	}

	o := v.overlays[flow.ID]
	if o == nil {
		o = &overlay{flow: copyFlow(flow), svc: v.l.services[opening.to.ID], seen: map[string]bool{}, file: opening.file}
		v.overlays[flow.ID] = o
	}
	o.traces++
	for _, h := range hops {
		o.seen[h.key()] = true
	}

	return true
}

// observe writes a sequence nobody declared down as seen, once per shape.
func (v *verifier) observe(hops []hop) {
	var parts []string
	for _, h := range hops {
		parts = append(parts, h.from.ID+">"+h.to.ID+":"+string(h.kind)+":"+h.label+":"+h.ref)
	}
	shape := strings.Join(parts, " ")

	o := v.observed[shape]
	if o == nil {
		o = &observed{svc: v.l.services[hops[0].to.ID], root: hops[0], hops: hops, files: map[string]bool{}}
		if o.svc == nil {
			o.svc = v.l.services[hops[0].from.ID]
		}
		v.observed[shape] = o
	}
	o.traces++
	o.files[hops[0].file] = true
}

// sequence reads a span and everything under it, in the order it ran, into
// hops. The spans come back alongside so a consumer's subtree can be found.
func (v *verifier) sequence(s *span) ([]hop, []*span) {
	var hops []hop
	var spans []*span
	var walk func(s *span, parentDB bool)
	walk = func(s *span, parentDB bool) {
		h, isDB := v.hop(s, parentDB)
		if h != nil {
			hops = append(hops, *h)
			spans = append(spans, s)
		}
		kids := v.children[s.spanID]
		sort.Slice(kids, func(i, j int) bool {
			if kids[i].start != kids[j].start {
				return kids[i].start < kids[j].start
			}

			return kids[i].spanID < kids[j].spanID
		})
		for _, kid := range kids {
			walk(kid, isDB)
		}
	}
	walk(s, false)

	return hops, spans
}

var tableOf = regexp.MustCompile(`(?i)\b(?:INTO|FROM|UPDATE|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)`)

// hop reads one span. The second result says whether the span was a database
// call, so that the statements nested under one - a prepare inside a query -
// are not read as a second call.
func (v *verifier) hop(s *span, parentDB bool) (*hop, bool) {
	svc := v.l.service(s.service)
	if svc == nil {
		v.warnOnce("service:"+s.service, s.service, "spans from service.name "+strconv.Quote(s.service)+" match no service in the catalog; name it under `services` to say which one it is")

		return nil, false
	}
	me := v.l.serviceLane(svc)
	a := s.attrs
	op := a["messaging.operation.type"]
	if op == "" {
		op = a["messaging.operation"]
	}

	switch {
	case s.kind == kindServer && (a["http.route"] != "" || a["url.path"] != ""):
		route := firstNonEmpty(a["http.route"], a["url.path"])
		method := firstNonEmpty(a["http.request.method"], a["http.method"])
		operation, known := v.l.operation(svc, method, route)
		label := operation
		if !known {
			label = method + " " + route
			v.warnOnce("route:"+svc.ID+method+route, svc.ID, "answers on "+method+" "+route+", which no interface it provides declares; the flow opens on the route rather than an operation")
		}

		return &hop{
			from: catalog.Participant{ID: laneClient, Kind: catalog.ParticipantActor}, to: me,
			kind: catalog.StepRPC, label: label, status: catalog.StatusVerified,
			entry: known, operation: operation, file: s.file,
		}, false

	case s.kind == kindServer && a["rpc.service"] != "":
		return &hop{
			from: catalog.Participant{ID: laneClient, Kind: catalog.ParticipantActor}, to: me,
			kind: catalog.StepRPC, label: a["rpc.method"], status: catalog.StatusVerified,
			entry: true, operation: a["rpc.method"], file: s.file,
		}, false

	case s.kind == kindClient && a["http.request.method"] != "":
		// A call over HTTP to another service. The route is the request's
		// path; the provider is whichever service declares an operation on
		// that verb and route, read the way the OpenAPI extractor records
		// them - so the call and the method share one id.
		method := a["http.request.method"]
		path := requestPath(a)
		if path == "" {
			return nil, false
		}
		h := &hop{from: me, kind: catalog.StepRPC, file: s.file}
		if peer, op, iface := v.l.httpProvider(method, path); peer != nil {
			id := iface + "/" + op
			h.to = v.l.serviceLane(peer)
			h.ref = id
			h.label = op
			h.status = catalog.StatusVerified
			h.call = &catalog.RpcCall{ID: id, Peer: peer.ID, Status: catalog.StatusVerified, Source: s.file}
		} else {
			host := firstNonEmpty(a["server.address"], a["net.peer.name"], "http")
			h.to = catalog.Participant{ID: strings.ReplaceAll(host, ".", "-"), Kind: catalog.ParticipantUnknown, Label: host}
			h.label = method + " " + path
			h.status = catalog.StatusUnresolved
			v.warnOnce("http:"+method+path, svc.ID, "calls "+method+" "+path+" on "+host+", which no service in the catalog answers on; the hop is unresolved")
		}

		return h, false

	case s.kind == kindClient && a["rpc.service"] != "":
		iface, method := a["rpc.service"], a["rpc.method"]
		id := iface + "/" + method
		h := &hop{from: me, kind: catalog.StepRPC, label: method, file: s.file}
		if v.l.rpcIDs[id] {
			h.ref = id
		}
		if peer := v.l.providers[iface]; peer != nil {
			h.to = v.l.serviceLane(peer)
			h.status = catalog.StatusVerified
			h.call = &catalog.RpcCall{ID: id, Peer: peer.ID, Status: catalog.StatusVerified, Source: s.file}
		} else {
			pkg := iface
			if i := strings.LastIndex(iface, "."); i >= 0 {
				pkg = iface[:i]
			}
			h.to = catalog.Participant{ID: strings.ReplaceAll(pkg, ".", "-"), Kind: catalog.ParticipantUnknown, Label: pkg}
			h.status = catalog.StatusUnresolved
			h.call = &catalog.RpcCall{ID: id, Peer: pkg, Status: catalog.StatusUnresolved, Source: s.file}
		}

		return h, false

	case a["db.system.name"] != "" || a["db.system"] != "" || a["db.operation.name"] != "":
		if parentDB {
			return nil, true
		}
		verb := strings.ToUpper(firstNonEmpty(a["db.operation.name"], a["db.operation"]))
		switch verb {
		case "", "BEGIN", "COMMIT", "ROLLBACK":
			return nil, verb != ""
		}
		label := verb
		if m := tableOf.FindStringSubmatch(s.name); m != nil {
			label = verb + " " + m[1]
		}
		to := me
		if lane, ok := v.l.storeLane(svc); ok {
			to = lane
		}

		return &hop{from: me, to: to, kind: catalog.StepCall, label: label, status: catalog.StatusVerified, file: s.file}, true

	case s.kind == kindProducer || op == "publish" || op == "create" || op == "send":
		wire := a["event.name"]
		if wire == "" {
			v.warnOnce("publish:"+svc.ID, svc.ID, "publishes without an event.name attribute on the span, so the trace cannot say which event; the hop is left out")

			return nil, false
		}
		id, ok := v.l.event(svc, wire)
		h := &hop{from: me, to: catalog.Participant{ID: laneBus, Kind: catalog.ParticipantBroker}, kind: catalog.StepEvent, label: lastSegment(wire), status: catalog.StatusVerified, eventID: id, file: s.file}
		if ok {
			h.ref = id
		} else {
			h.status = catalog.StatusUnresolved
			v.warnOnce("event:"+wire, svc.ID, "publishes "+strconv.Quote(wire)+", which matches no event of its own in the catalog; name it under `events`")
		}

		return h, false

	case s.kind == kindConsumer || op == "receive" || op == "process" || op == "deliver":
		wire := a["event.name"]
		if wire == "" {
			v.warnOnce("consume:"+svc.ID, svc.ID, "consumes without an event.name attribute on the span, so the trace cannot say which event; the hop is left out")

			return nil, false
		}
		id, ok := v.l.event(nil, wire)
		h := &hop{from: catalog.Participant{ID: laneBus, Kind: catalog.ParticipantBroker}, to: me, kind: catalog.StepEvent, label: lastSegment(wire), status: catalog.StatusVerified, consume: true, eventID: id, file: s.file}
		if ok {
			h.ref = id
		} else {
			h.status = catalog.StatusUnresolved
			h.eventID = ""
			v.warnOnce("event:"+wire, svc.ID, "consumes "+strconv.Quote(wire)+", which matches no event in the catalog; name it under `events`")
		}

		return h, false
	}

	return nil, false
}

func (v *verifier) warnOnce(key, ref, message string) {
	if v.warned[key] {
		return
	}
	v.warned[key] = true
	v.b.Warn(ref, message)
}

// requestPath is the path of a client request, off url.full or url.path.
func requestPath(a map[string]string) string {
	if p := a["url.path"]; p != "" {
		return p
	}
	full := a["url.full"]
	if full == "" {
		full = a["http.url"]
	}
	if full == "" {
		return ""
	}
	if i := strings.Index(full, "://"); i >= 0 {
		full = full[i+3:]
		if j := strings.Index(full, "/"); j >= 0 {
			full = full[j:]
		} else {
			full = "/"
		}
	}
	if i := strings.IndexAny(full, "?#"); i >= 0 {
		full = full[:i]
	}

	return full
}

// fragment is what goes back: every declared flow a trace opened, with the
// steps it showed raised; every sequence nobody declared; and the consumers
// and calls the traces prove, hung on copies of the entities that own them.
func (v *verifier) fragment(in plugin.Input) catalog.Catalog {
	out := catalog.Catalog{
		GeneratedAt: in.GeneratedAt,
		Commit:      in.Commit,
		Contexts:    []catalog.BoundedContext{},
		Defs:        map[string]catalog.TypeDef{},
		Flows:       []catalog.Flow{},
		Adrs:        []catalog.Adr{},
	}

	ids := make([]string, 0, len(v.overlays))
	for id := range v.overlays {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		o := v.overlays[id]
		raise(o)
		out.Flows = append(out.Flows, *o.flow)
	}

	shapes := make([]string, 0, len(v.observed))
	for shape := range v.observed {
		shapes = append(shapes, shape)
	}
	sort.Strings(shapes)
	for _, shape := range shapes {
		out.Flows = append(out.Flows, v.observedFlow(v.observed[shape]))
	}
	sort.SliceStable(out.Flows, func(i, j int) bool { return out.Flows[i].Slug < out.Flows[j].Slug })

	// Edges, on the services that hold them.
	services := map[string]*catalog.Service{}
	touch := func(svc *catalog.Service) *catalog.Service {
		if got := services[svc.ID]; got != nil {
			return got
		}
		copied := &catalog.Service{ID: svc.ID, Slug: svc.Slug, Name: svc.Name, Provides: []catalog.RpcService{}, Consumes: []catalog.RpcCall{}, Aggregates: []catalog.Aggregate{}}
		services[svc.ID] = copied

		return copied
	}

	callIDs := make([]string, 0, len(v.calls))
	for id := range v.calls {
		callIDs = append(callIDs, id)
	}
	sort.Strings(callIDs)
	for _, id := range callIDs {
		callers := make([]string, 0, len(v.callers[id]))
		for svcID := range v.callers[id] {
			callers = append(callers, svcID)
		}
		sort.Strings(callers)
		for _, svcID := range callers {
			svc := touch(v.l.services[svcID])
			svc.Consumes = append(svc.Consumes, v.calls[id])
		}
	}

	eventIDs := make([]string, 0, len(v.consumers))
	for id := range v.consumers {
		eventIDs = append(eventIDs, id)
	}
	sort.Strings(eventIDs)
	for _, eventID := range eventIDs {
		owner := v.l.eventOwner[eventID]
		agg := v.l.aggregate[eventID]
		ev := v.l.events[eventID]
		if owner == nil || agg == nil || ev == nil {
			continue
		}
		svc := touch(owner)
		var target *catalog.Aggregate
		for i := range svc.Aggregates {
			if svc.Aggregates[i].ID == agg.ID {
				target = &svc.Aggregates[i]
			}
		}
		if target == nil {
			svc.Aggregates = append(svc.Aggregates, catalog.Aggregate{
				ID: agg.ID, Slug: agg.Slug, Name: agg.Name, Readme: agg.Readme, Root: agg.Root,
				Entities: []catalog.Block{}, ValueObjects: []catalog.Block{}, Operations: []catalog.Operation{}, Events: []catalog.Event{},
			})
			target = &svc.Aggregates[len(svc.Aggregates)-1]
		}
		consumers := []catalog.EventConsumer{}
		byService := v.consumers[eventID]
		names := make([]string, 0, len(byService))
		for name := range byService {
			names = append(names, name)
		}
		sort.Strings(names)
		for _, name := range names {
			consumers = append(consumers, catalog.EventConsumer{Service: name, Status: catalog.StatusVerified, Note: byService[name]})
		}
		target.Events = append(target.Events, catalog.Event{ID: ev.ID, Slug: ev.Slug, Name: ev.Name, Versions: ev.Versions, Consumers: consumers})
	}

	svcIDs := make([]string, 0, len(services))
	for id := range services {
		svcIDs = append(svcIDs, id)
	}
	sort.Strings(svcIDs)
	contexts := map[string]*catalog.BoundedContext{}
	var order []string
	for _, id := range svcIDs {
		ctxID := contextOf(id)
		ctx := contexts[ctxID]
		if ctx == nil {
			src := v.l.contexts[ctxID]
			ctx = &catalog.BoundedContext{ID: ctxID, Slug: ctxID, Services: []catalog.Service{}}
			if src != nil {
				ctx.Slug, ctx.Name = src.Slug, src.Name
			}
			contexts[ctxID] = ctx
			order = append(order, ctxID)
		}
		ctx.Services = append(ctx.Services, *services[id])
	}
	for _, id := range order {
		out.Contexts = append(out.Contexts, *contexts[id])
	}

	return out
}

// raise marks the declared steps the traces showed. Only `declared` moves:
// `unresolved` means the far end is not in the catalog, and a trace does not
// put it there.
func raise(o *overlay) {
	first := firstStep(o.flow.Steps)
	note := "Seen running in " + o.file + " (" + plural(o.traces, "trace") + ")."
	walkSteps(o.flow.Steps, func(step *catalog.Step) {
		if step.Status != catalog.StatusDeclared {
			return
		}
		var shown bool
		switch step.Kind {
		case catalog.StepRPC:
			if step == first && step.Ref == "" {
				shown = o.seen["entry|"+step.To+"|"+step.Label]
			} else if step.Ref != "" {
				shown = o.seen["rpc|"+step.From+"|"+step.Ref]
			}
		case catalog.StepEvent:
			if step.Ref != "" {
				shown = o.seen["pub|"+step.From+"|"+step.Ref] || o.seen["con|"+step.To+"|"+step.Ref]
			}
		}
		if !shown {
			return
		}
		step.Status = catalog.StatusVerified
		if step.Note == "" {
			step.Note = note
		}
	})
}

// observedFlow writes a sequence nobody declared down as a flow of its own.
func (v *verifier) observedFlow(o *observed) catalog.Flow {
	var lanes []catalog.Participant
	lane := func(p catalog.Participant) string {
		for _, existing := range lanes {
			if existing.ID == p.ID {
				return p.ID
			}
		}
		lanes = append(lanes, p)

		return p.ID
	}

	steps := catalog.FlowNodes{}
	for i, h := range o.hops {
		from := lane(h.from)
		to := lane(h.to)
		steps = append(steps, &catalog.Step{
			Type: "step", ID: "s" + strconv.Itoa(i+1), From: from, To: to,
			Kind: h.kind, Ref: h.ref, Label: h.label, Status: h.status,
		})
	}

	files := make([]string, 0, len(o.files))
	for f := range o.files {
		files = append(files, f)
	}
	sort.Strings(files)

	svc := o.svc
	slugged := "observed-" + svc.Slug + "-" + slugify(o.root.label)

	return catalog.Flow{
		ID:           "flow." + slugged,
		Slug:         slugged,
		Name:         "Observed: " + o.root.label,
		Summary:      "Read from " + plural(o.traces, "trace") + " in " + strings.Join(files, ", ") + ". No flow in the catalog opens this way, so the sequence is written down as it was seen.",
		Source:       files[0],
		Owner:        contextOf(svc.ID),
		Participants: lanes,
		Steps:        steps,
	}
}

// copyFlow is a deep copy, through the wire form, so that raising never writes
// into the catalog the plugin was handed.
func copyFlow(flow *catalog.Flow) *catalog.Flow {
	raw, err := json.Marshal(flow)
	if err != nil {
		panic(err)
	}
	var out catalog.Flow
	if err := json.Unmarshal(raw, &out); err != nil {
		panic(err)
	}

	return &out
}

func lastSegment(wire string) string {
	if i := strings.LastIndex(wire, "."); i >= 0 {
		return wire[i+1:]
	}

	return wire
}

var notSlug = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(s string) string {
	return strings.Trim(notSlug.ReplaceAllString(strings.ToLower(s), "-"), "-")
}

func plural(n int, noun string) string {
	if n == 1 {
		return "1 " + noun
	}

	return strconv.Itoa(n) + " " + noun + "s"
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}

	return ""
}
