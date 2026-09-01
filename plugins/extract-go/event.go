package main

import (
	"path"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// extractEvents reads internal/domain/<aggregate>/event.
//
// An event is a struct with a `Name() string` that returns a literal - which is
// both how the domain declares the topic and how this tells an event apart from
// the helper types that live beside it.
func extractEvents(root, dir, aggID string, b *plugin.Builder) []catalog.Event {
	out := []catalog.Event{}

	pkg, err := parsePkg(root, path.Join("internal/domain", dir, "event"))
	if err != nil {
		return out
	}

	out = eventsIn(pkg, aggID)
	if len(out) == 0 {
		b.Warn(aggID, "internal/domain/"+dir+"/event declares no struct with a Name() method; the aggregate publishes nothing")
	}

	return out
}

// eventsIn is the reading itself, kept apart from where the package was found
// so it can be exercised on a package built in a test.
func eventsIn(pkg *pkg, aggID string) []catalog.Event {
	out := []catalog.Event{}

	for _, decl := range pkg.structs() {
		if !exported(decl.name) {
			continue
		}

		topic, named := returnedString(pkg.methods(decl.name)["Name"])
		if !named {
			// Not every struct in the package is an event. One without a Name
			// is a payload or a helper, and quietly documenting it as a
			// published fact would be worse than missing it.
			continue
		}

		doc := decl.doc
		if topic != "" {
			doc = strings.TrimSpace(doc + "\n\nPublished on the bus as `" + topic + "`.")
		}

		out = append(out, catalog.Event{
			ID:   eventID(aggID, decl.name),
			Slug: slug(decl.name),
			Name: decl.name,
			// One version, and it is declared rather than discovered: nothing
			// in the source carries a version, so saying v1 is saying "this is
			// what it looks like today", not "this is the first of several".
			Versions: []catalog.EventVersion{{
				Version: "v1",
				Doc:     doc,
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
