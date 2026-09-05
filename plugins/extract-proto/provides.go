package main

// What a service ANSWERS, read from the protos it publishes.
//
// One rpc service becomes one catalog interface; one rpc method becomes one
// catalog method, carrying the two shapes it moves and how it streams. The
// messages listed alongside are the ones REACHABLE from those methods, walked
// transitively - the same rule extract-openapi applies to schemas, for the same
// reason its comment gives: a reader who has to follow three links to find out
// what comes back has been given a worse document.

import (
	"path/filepath"
	"sort"
	"strconv"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// shared collects the messages promoted to catalog.defs, by their bare name.
type shared struct {
	defs map[string]catalog.TypeDef
	// from records which fully-qualified type each def key was taken from, so a
	// second message with the same short name can be spotted rather than
	// silently overwriting the first.
	from map[string]string
	on   bool
}

func newShared(on bool) *shared {
	return &shared{defs: map[string]catalog.TypeDef{}, from: map[string]string{}, on: on}
}

// interfaces turns every rpc service in the owned files into a catalog entry.
func interfaces(ix *Index, files []*File, moduleID string, sh *shared, b *plugin.Builder) []catalog.RpcService {
	var out []catalog.RpcService

	for _, file := range files {
		for _, svc := range file.Services {
			id := interfaceID(file.Package, svc.Name)

			provided := catalog.RpcService{
				ID:      id,
				Methods: make([]catalog.RpcMethod, 0, len(svc.Methods)),
				Source:  sourceRef(file.Path, svc.Line),
				Module:  moduleID,
			}

			// The messages this interface moves, in the order they are first
			// reached: the request and response of each method, then whatever
			// those refer to.
			var queue []string
			seen := map[string]bool{}

			for _, m := range svc.Methods {
				method := catalog.RpcMethod{
					Name:       m.Name,
					Doc:        m.Doc,
					Deprecated: m.Deprecated,
					Streaming:  streamingOf(m),
				}

				method.Request, method.RequestRef = shapeRef(ix, file, m.Request, sh, &queue, seen, id, b)
				method.Response, method.ResponseRef = shapeRef(ix, file, m.Response, sh, &queue, seen, id, b)

				provided.Methods = append(provided.Methods, method)
			}

			provided.Messages = messagesFrom(ix, queue, seen, sh, id, b)
			out = append(out, provided)
		}
	}

	// Sorted, because the fragment is committed and compared by gen:check and
	// the file walk that produced these is only as ordered as the filesystem.
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })

	return out
}

// streamingOf maps a method's two stream flags onto the catalog's one value.
func streamingOf(m *Method) catalog.Streaming {
	switch {
	case m.ClientStreaming && m.ServerStreaming:
		return catalog.StreamingBidi
	case m.ClientStreaming:
		return catalog.StreamingClient
	case m.ServerStreaming:
		return catalog.StreamingServer
	default:
		// Unary. Empty rather than a fourth constant, because unary is the case
		// not worth writing down and the catalog says so by leaving it out.
		return ""
	}
}

// shapeRef names a method's request or response and queues it for listing.
//
// It returns the name as a reader says it and the defs key, when the type is
// one the author shared through an import.
func shapeRef(ix *Index, from *File, name string, sh *shared, queue *[]string, seen map[string]bool, where string, b *plugin.Builder) (string, string) {
	if name == "" {
		return "", ""
	}

	fqn, ok := ix.Resolve(from.Package, name)
	if !ok {
		// Not a failure. A narrowed vendored copy imports files nobody
		// vendored beside it, which is the whole reason this reader is tolerant.
		b.Warn(where, name+" is not declared in the protos read here; it is named but not described")

		return shortName(name), ""
	}

	if !seen[fqn] {
		seen[fqn] = true
		*queue = append(*queue, fqn)
	}

	// Shared by the same rule as a field's type: the author put it in another
	// file, which is their own signal that it is not local to this interface.
	ref := ""
	if sh.on && ix.FileOf(fqn) != from {
		ref = sh.promote(ix, fqn, where, b)
	}

	return shortName(fqn), ref
}

// messagesFrom walks the queue, describing each message and adding whatever its
// fields refer to, until nothing new is reached.
func messagesFrom(ix *Index, queue []string, seen map[string]bool, sh *shared, where string, b *plugin.Builder) []catalog.RpcMessage {
	var out []catalog.RpcMessage

	for i := 0; i < len(queue); i++ {
		fqn := queue[i]
		msg := ix.Message(fqn)
		if msg == nil {
			// An enum, or something only an import declares. Neither is a
			// message and neither belongs in this list.
			continue
		}

		fields := make([]catalog.Field, 0, len(msg.Fields))
		for _, f := range msg.Fields {
			ref := ix.resolveType(fqn, f)
			if ref.Unresolved != "" {
				b.Warn(where, ref.Unresolved+" is not declared in the protos read here; "+
					shortName(fqn)+"."+f.Name+" is listed with the type as written")
			}

			field := catalog.Field{Name: f.Name, Type: ref.Written, Doc: f.Doc}

			if ref.FQN != "" {
				if !seen[ref.FQN] {
					seen[ref.FQN] = true
					queue = append(queue, ref.FQN)
				}
				// A type is SHARED when the author put it in another file - an
				// import is their own signal that it is not local to this
				// message. No reference counting, no heuristic.
				if sh.on && ix.FileOf(ref.FQN) != ix.FileOf(fqn) {
					field.Ref = sh.promote(ix, ref.FQN, where, b)
				}
			}

			fields = append(fields, field)
		}

		out = append(out, catalog.RpcMessage{Name: shortName(fqn), Fields: fields})
	}

	return out
}

// promote records a message as a shared type and returns its defs key.
//
// The key is the message's BARE name - `Money`, not `shop.v1.Money`. That is
// what src/merge.ts argues for at length: bare keys are deliberate, so that two
// sources meaning different things by `Money` produce a visible conflict
// instead of two quietly coexisting entries. Fully-qualified keys would hide
// exactly the problem the merge exists to expose.
func (sh *shared) promote(ix *Index, fqn, where string, b *plugin.Builder) string {
	key := shortName(fqn)

	if previous, ok := sh.from[key]; ok {
		if previous != fqn {
			b.Warn(where, "two different types are both called "+key+" ("+previous+" and "+fqn+
				"); the first one read is the shared type")
		}

		return key
	}

	msg := ix.Message(fqn)
	if msg == nil {
		return ""
	}

	fields := make([]catalog.Field, 0, len(msg.Fields))
	for _, f := range msg.Fields {
		ref := ix.resolveType(fqn, f)
		fields = append(fields, catalog.Field{Name: f.Name, Type: ref.Written, Doc: f.Doc})
	}

	sh.from[key] = fqn
	sh.defs[key] = catalog.TypeDef{Fields: fields}

	return key
}

// sourceRef is where a declaration lives, as a reader would type it:
// `proto/shop/v1/orders.proto:12`. Already the format `RpcService.source`
// documents.
func sourceRef(path string, line int) string {
	return filepath.ToSlash(path) + ":" + strconv.Itoa(line)
}
