package main

// What a service CALLS, read from the client copies it vendors.
//
// docs/adr/org.0001.md puts a narrowed copy of the producer's proto in the
// consumer's infrastructure layer, with a header comment saying where it came
// from. That copy is a statement about what this service intends to call, and
// reading it is how a call edge gets into the catalog from the calling end.

import (
	"sort"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// calls turns every method in the vendored files into a catalog call.
//
// STATUS IS ALWAYS "declared", NEVER "verified". Three reasons, and the test
// that holds this is deliberate:
//
//  1. `problems()` treats status as authored, not derived.
//  2. Verification is a property of the UNION, and every extractor runs before
//     one exists - `plugin.Request.Catalog` is the zero value for an extractor.
//  3. In the shipped catalog `verified` already means something a proto cannot
//     supply: it sits next to a note naming the integration test that covers
//     the call end to end.
//
// Reading a .proto proves the call was WRITTEN DOWN, which is what `declared`
// means. Whether it is exercised is not a question this file can answer.
func calls(files []*File, peers map[string]string, moduleID string, b *plugin.Builder) []catalog.RpcCall {
	var out []catalog.RpcCall

	for _, file := range files {
		peer, named := peers[file.Package]
		if !named {
			// The raw package name, which is exactly what `RpcCall.peer`
			// documents: "service id if resolved, else raw name". Guessing a
			// service id from a proto package would be inventing an edge.
			peer = file.Package
		}

		for _, svc := range file.Services {
			iface := interfaceID(file.Package, svc.Name)
			if !named {
				b.Warn(iface, "no peer is mapped for proto package "+file.Package+
					"; the call is listed against the package name")
			}

			for _, m := range svc.Methods {
				out = append(out, catalog.RpcCall{
					ID:     callID(iface, m.Name),
					Peer:   peer,
					Status: catalog.StatusDeclared,
					Source: sourceRef(file.Path, m.Line),
					Note:   file.headerNote(),
					Module: moduleID,
				})
			}
		}
	}

	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })

	return out
}

// headerNote is the comment at the top of a vendored copy.
//
// The ADR already requires that header - "the header comment on every vendored
// copy says so" - so surfacing it costs nothing and makes the boundary
// self-documenting on the page rather than only in the file. It sits above
// `syntax` rather than above a declaration, which is why the parser keeps it
// on the file instead of on whatever happens to come first.
func (f *File) headerNote() string {
	return f.Doc
}
