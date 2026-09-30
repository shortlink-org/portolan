package extractgo

import (
	"go/ast"
	"path"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// extractEvents reads event below a discovered aggregate domain package.
//
// An event is a struct with a `Name() string` that returns a name rather than
// a field - which is both how the domain declares the event's name on the wire
// and how this tells an event apart from the helper types that live beside it.
func extractEvents(root, aggregateName, domainPath string, layout sourceLayout, aggID string, b *plugin.Builder) []catalog.Event {
	out := []catalog.Event{}

	pkg, err := parsePkg(root, path.Join(domainPath, "event"), layout.index)
	if err != nil {
		return out
	}

	out = readEvents(pkg, aggID, channelOf(root, aggregateName, layout), func(id, message string) { b.Warn(id, message) })
	if len(out) == 0 {
		b.Warn(aggID, path.Join(domainPath, "event")+" declares no struct with a Name() method; the aggregate publishes nothing")
	}

	return out
}

// channelOf reads where an aggregate's events go: the `Topic` constant of
// the discovered integration event DTO package, which may live beside a
// feature or beside a legacy repository adapter. The domain names the event and the adapter
// names the channel, because the channel is a fact about the transport, not
// about what happened. Empty when the package or the constant is missing: a
// domain nobody publishes has no channel to name, and saying so is better
// than guessing one from the aggregate's name.
func channelOf(root, aggregateName string, layout sourceLayout) string {
	dir := layout.integrationEvents[aggregateName]
	if dir == "" {
		return ""
	}
	pkg, err := parsePkg(root, dir, layout.index)
	if err != nil {
		return ""
	}

	return stringConsts(pkg)["Topic"]
}

// eventsIn is the reading itself, kept apart from where the package was found
// so it can be exercised on a package built in a test. channel is where every
// event of the aggregate is published, or empty.
func eventsIn(pkg *pkg, aggID, channel string) []catalog.Event {
	return readEvents(pkg, aggID, channel, func(string, string) {})
}

// readEvents is eventsIn saying, through warn, which event it could not name.
func readEvents(pkg *pkg, aggID, channel string, warn func(id, message string)) []catalog.Event {
	out := []catalog.Event{}

	for _, decl := range pkg.structs() {
		if !exported(decl.name) {
			continue
		}

		// Name may be promoted from an embedded type, and its constant is
		// read in the package that declares it.
		owner, nameFn := pkg.method(decl.name, "Name")
		wire, named := eventName(owner, nameFn)
		if !named {
			// Not every struct in the package is an event. One without a Name
			// is a payload or a helper, and quietly documenting it as a
			// published fact would be worse than missing it.
			continue
		}

		// A Name that resolves to no string names the event in a way this
		// reader cannot follow, and a wire with no name is no wire at all -
		// but it is still an event, and the gap is said out loud.
		var onWire *catalog.EventWire
		if wire != "" {
			onWire = &catalog.EventWire{Name: wire, Channel: channel}
		} else {
			source, line := owner.position(nameFn.Pos())
			warn(eventID(aggID, decl.name), at(source, line)+": "+decl.name+".Name() returns no string this reader can resolve (a literal, a constant or a concatenation of them); the event is listed without its wire name")
		}

		out = append(out, catalog.Event{
			ID:   eventID(aggID, decl.name),
			Slug: slug(decl.name),
			Name: decl.name,
			Wire: onWire,
			// One version, and it is declared rather than discovered: nothing
			// in the source carries a version, so saying v1 is saying "this is
			// what it looks like today", not "this is the first of several".
			Versions: []catalog.EventVersion{{
				Version: "v1",
				Doc:     decl.doc,
				Source:  decl.source,
				Fields:  pkg.fieldsOf(decl),
			}},
			// Consumers live in other services, and this extractor is reading
			// one. An empty list is the honest answer; the merge is where the
			// other side of the arrow arrives.
			Consumers: []catalog.EventConsumer{},
		})
	}

	return out
}

// eventName reads an event's name on the wire off its Name method: a literal;
// a constant, declared in any file of the package or imported, followed
// through the constants it is defined by; a concatenation of those; a local
// or a one-line function that is one of them. named is whether the method has
// the shape of an event's name at all - no parameters, one result, returned
// without reading the value it is called on - even when the name itself
// cannot be read: a Name that returns a field is a helper's getter, one that
// returns an expression this cannot follow is still an event's.
func eventName(p *pkg, fn *ast.FuncDecl) (wire string, named bool) {
	if fn == nil || fn.Body == nil || fn.Type.Results == nil || fn.Type.Results.NumFields() != 1 {
		return "", false
	}
	if fn.Type.Params != nil && fn.Type.Params.NumFields() != 0 {
		return "", false
	}
	var returned []ast.Expr
	for _, stmt := range fn.Body.List {
		if ret, ok := stmt.(*ast.ReturnStmt); ok && len(ret.Results) == 1 {
			returned = append(returned, ret.Results[0])
		}
	}
	if len(returned) == 0 || readsReceiver(fn, returned) {
		return "", false
	}

	values := map[string]bool{}
	info, entry := p.types(), p.types().function(fn)
	for _, expr := range returned {
		if value, ok := constString(expr, stringConsts(p)); ok {
			values[value] = true
			continue
		}
		if entry == nil {
			return "", true
		}
		resolved := info.Resolve(expr, entry, 0, map[string]bool{})
		if len(resolved) == 0 {
			return "", true
		}
		for _, value := range resolved {
			values[value.Value] = true
		}
	}
	if len(values) != 1 {
		return "", true
	}

	return sortedKeys(values)[0], true
}

// readsReceiver is whether any of these expressions names the receiver.
func readsReceiver(fn *ast.FuncDecl, exprs []ast.Expr) bool {
	recv := receiverIdent(fn)
	if recv == "" || recv == "_" {
		return false
	}
	reads := false
	for _, expr := range exprs {
		ast.Inspect(expr, func(node ast.Node) bool {
			if ident, ok := node.(*ast.Ident); ok && ident.Name == recv {
				reads = true
			}
			return !reads
		})
	}

	return reads
}
