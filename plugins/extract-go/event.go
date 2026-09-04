package main

import (
	"path"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// extractEvents reads internal/domain/<aggregate>/event.
//
// An event is a struct with a `Name() string` that returns a literal - which is
// both how the domain declares the event's name on the wire and how this tells
// an event apart from the helper types that live beside it.
func extractEvents(root, dir, aggID string, b *plugin.Builder) []catalog.Event {
	out := []catalog.Event{}

	pkg, err := parsePkg(root, path.Join("internal/domain", dir, "event"))
	if err != nil {
		return out
	}

	out = eventsIn(pkg, aggID, channelOf(root, dir))
	if len(out) == 0 {
		b.Warn(aggID, "internal/domain/"+dir+"/event declares no struct with a Name() method; the aggregate publishes nothing")
	}

	return out
}

// channelOf reads where an aggregate's events go: the `Topic` constant of
// internal/infrastructure/repository/<aggregate>/dto, the package that turns
// a domain event into a message. The domain names the event and the adapter
// names the channel, because the channel is a fact about the transport, not
// about what happened. Empty when the package or the constant is missing: a
// domain nobody publishes has no channel to name, and saying so is better
// than guessing one from the aggregate's name.
func channelOf(root, dir string) string {
	pkg, err := parsePkg(root, path.Join("internal/infrastructure/repository", dir, "dto"))
	if err != nil {
		return ""
	}

	return stringConsts(pkg)["Topic"]
}

// eventsIn is the reading itself, kept apart from where the package was found
// so it can be exercised on a package built in a test. channel is where every
// event of the aggregate is published, or empty.
func eventsIn(pkg *pkg, aggID, channel string) []catalog.Event {
	out := []catalog.Event{}

	for _, decl := range pkg.structs() {
		if !exported(decl.name) {
			continue
		}

		wire, named := returnedString(pkg, pkg.methods(decl.name)["Name"])
		if !named {
			// Not every struct in the package is an event. One without a Name
			// is a payload or a helper, and quietly documenting it as a
			// published fact would be worse than missing it.
			continue
		}

		// A Name that is not a literal names the event in a way this reader
		// cannot follow, and a wire with no name is no wire at all.
		var onWire *catalog.EventWire
		if wire != "" {
			onWire = &catalog.EventWire{Name: wire, Channel: channel}
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
				Fields:  fields(decl.fields),
			}},
			// Consumers live in other services, and this extractor is reading
			// one. An empty list is the honest answer; the merge is where the
			// other side of the arrow arrives.
			Consumers: []catalog.EventConsumer{},
		})
	}

	return out
}
