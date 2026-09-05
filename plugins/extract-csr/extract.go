package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// LockName is what fetch-csr writes beside each vendored schema. Finding one
// is what makes a directory a subject rather than a directory that happens to
// hold a .avsc.
const LockName = "csr.lock.json"

func extract(in plugin.Input, opts Options) (plugin.Response, error) {
	b := &plugin.Builder{}
	root := in.Root

	if opts.Context == "" {
		opts.Context = filepath.Base(root)
	}
	if opts.Service == "" {
		opts.Service = filepath.Base(root)
	}
	service := opts.Context + "." + opts.Service
	strategy := strategyOf(opts.Strategy)

	locks, err := find(root, opts.Paths)
	if err != nil {
		return plugin.Response{}, err
	}
	if len(locks) == 0 {
		b.Warn(service, "no "+LockName+" under "+root+"; nothing was fetched from a schema registry, or it was fetched somewhere this step is not looking")
	}

	defs := map[string]catalog.TypeDef{}
	channels := newChannels()

	for _, at := range locks {
		if err := readSubject(b, at, root, service, strategy, opts, defs, channels); err != nil {
			return plugin.Response{}, err
		}
	}

	// A field pointing at a shape nobody vendored would fail the catalog's own
	// validation, and the reference is a real fact worth keeping as a label
	// even when the shape behind it is not in this estate. So the label stays
	// and the ref goes.
	drop(defs, b, service)

	fragment := catalog.Catalog{
		GeneratedAt: in.GeneratedAt,
		Commit:      in.Commit,
		Contexts: []catalog.BoundedContext{{
			ID:   opts.Context,
			Slug: opts.Context,
			// Named by whichever source knows the name, the way the AsyncAPI
			// and OpenAPI fragments leave it: a registry describes what a
			// service puts on a topic, not what the service is called.
			Services: []catalog.Service{{
				ID:         service,
				Slug:       opts.Service,
				Provides:   []catalog.RpcService{},
				Consumes:   []catalog.RpcCall{},
				Aggregates: []catalog.Aggregate{},
				Channels:   channels.all(),
			}},
		}},
		Defs:  defs,
		Flows: []catalog.Flow{},
		Adrs:  []catalog.Adr{},
	}

	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}

	b.File(firstNonEmpty(opts.Out, "schemas.json"), string(encoded)+"\n")

	return b.Response(), nil
}

// readSubject reads one vendored subject: its lock, its schema, and the two
// facts they add up to.
func readSubject(
	b *plugin.Builder,
	at, root, service, strategy string,
	opts Options,
	defs map[string]catalog.TypeDef,
	channels *channelSet,
) error {
	dir := filepath.Dir(at)
	where := filepath.ToSlash(at)

	raw, err := os.ReadFile(at)
	if err != nil {
		return err
	}

	var lock Lock
	if err := json.Unmarshal(raw, &lock); err != nil {
		return fmt.Errorf("%s: %w", where, err)
	}
	if len(lock.Subjects) != 1 {
		return fmt.Errorf("%s names %d subjects; expected exactly one", where, len(lock.Subjects))
	}

	entry := lock.Subjects[0]
	if len(entry.Files) == 0 {
		b.Warn(entry.Subject, where+" names no schema file")

		return nil
	}

	schemaAt := filepath.Join(dir, filepath.FromSlash(entry.Files[0].Path))
	schema, err := os.ReadFile(schemaAt)
	if err != nil {
		return fmt.Errorf("%s: %w", where, err)
	}
	source := filepath.ToSlash(schemaAt)

	declared, shapes, err := shapesOf(entry, schema, b, source)
	if err != nil {
		return fmt.Errorf("%s: %w", source, err)
	}
	for name, def := range shapes {
		// Two subjects vendoring one shared record is the ordinary case - it
		// is what a registry reference is for - and the two copies are the
		// same bytes, so the first one wins and the second is not a conflict.
		if _, held := defs[name]; !held {
			defs[name] = def
		}
	}

	registered := resolve(entry.Subject, declared, strategy)
	if registered.Topic == "" {
		// RecordNameStrategy says nothing about topics on purpose, so this is
		// not a gap to report. The shape is still the fact worth having.
		return nil
	}

	if registered.Key {
		// A key is part of every message on the topic rather than a message on
		// it, so its shape is kept and its name is not put on the channel.
		return nil
	}

	channels.add(registered.Topic, catalog.ChannelMessage{
		Name:      registered.Record,
		Doc:       fmt.Sprintf("Registered as %s version %d.", entry.Subject, entry.Version),
		Direction: directionFor(entry.Subject, opts),
	}, source)

	return nil
}

// shapesOf reads the schema according to its declared type.
func shapesOf(entry LockSubject, schema []byte, b *plugin.Builder, source string) (string, map[string]catalog.TypeDef, error) {
	switch strings.ToUpper(entry.SchemaType) {
	case "", "AVRO":
		return avro(schema)

	case "JSON":
		return jsonSchema(schema, entry.Subject)

	case "PROTOBUF":
		// Reading protobuf properly is extract-proto's whole job, and a
		// second, worse parser here would be a second answer to one question.
		b.Warn(entry.Subject, source+" is protobuf; its topic is read but its shape is not. Point extract-proto at the vendored directory for the fields.")

		return "", nil, nil
	}

	return "", nil, fmt.Errorf("unknown schema type %q", entry.SchemaType)
}

// directionFor is which way a subject's channel travels. A registry records no
// producer and no consumer, so this is told rather than read.
func directionFor(subject string, opts Options) catalog.ChannelDirection {
	declared, named := opts.Subjects[subject]
	if !named {
		declared = opts.Direction
	}

	if declared == string(catalog.ChannelReceive) {
		return catalog.ChannelReceive
	}

	return catalog.ChannelSend
}

// channelSet collects topics as the subjects are read. Several subjects on one
// topic - a key and a value, or two record types multiplexed onto it - are one
// channel carrying several messages.
type channelSet struct {
	byTopic map[string]*catalog.Channel
	seen    map[string]bool
	order   []string
}

func newChannels() *channelSet {
	return &channelSet{byTopic: map[string]*catalog.Channel{}, seen: map[string]bool{}}
}

func (c *channelSet) add(topic string, message catalog.ChannelMessage, source string) {
	held, known := c.byTopic[topic]
	if !known {
		held = &catalog.Channel{
			Address:  topic,
			Messages: []catalog.ChannelMessage{},
			Source:   source,
		}
		c.byTopic[topic] = held
		c.order = append(c.order, topic)
	}

	key := topic + " " + string(message.Direction) + " " + message.Name
	if c.seen[key] {
		return
	}
	c.seen[key] = true

	held.Messages = append(held.Messages, message)
}

// all is the channels in topic order, and their messages in name order. Sorted
// rather than kept in the order the tree happened to be walked in, because the
// fragment is committed and an unstable order would rewrite it every run.
func (c *channelSet) all() []catalog.Channel {
	sort.Strings(c.order)

	out := make([]catalog.Channel, 0, len(c.order))
	for _, topic := range c.order {
		held := c.byTopic[topic]
		sort.Slice(held.Messages, func(i, j int) bool {
			if held.Messages[i].Name != held.Messages[j].Name {
				return held.Messages[i].Name < held.Messages[j].Name
			}

			return held.Messages[i].Direction < held.Messages[j].Direction
		})
		out = append(out, *held)
	}

	return out
}

// drop clears a field's ref when nothing in this estate declares the shape it
// names, which is the ordinary case for a record referenced across an estate
// boundary. The catalog validates that every ref resolves, so leaving one
// dangling would fail the whole run over a fact that is true.
func drop(defs map[string]catalog.TypeDef, b *plugin.Builder, service string) {
	var dangling []string

	for name, def := range defs {
		for i, field := range def.Fields {
			if field.Ref == "" {
				continue
			}
			if _, known := defs[field.Ref]; known {
				continue
			}
			dangling = append(dangling, field.Ref)
			def.Fields[i].Ref = ""
		}
		defs[name] = def
	}

	if len(dangling) == 0 {
		return
	}

	sort.Strings(dangling)
	b.Warn(service, "these shapes are referenced but not vendored, so they are named without a shape: "+
		strings.Join(unique(dangling), ", "))
}

// find locates every lock under the root, or under the declared paths.
//
// Sorted, so the fragment comes out the same way on every filesystem: WalkDir
// is ordered, but a manifest that names two paths is not.
func find(root string, paths []string) ([]string, error) {
	roots := []string{root}
	if len(paths) > 0 {
		roots = roots[:0]
		for _, at := range paths {
			roots = append(roots, filepath.Join(root, filepath.FromSlash(at)))
		}
	}

	var found []string
	for _, at := range roots {
		err := filepath.WalkDir(at, func(p string, entry os.DirEntry, err error) error {
			if err != nil {
				// A named path that is not there is worth reporting; one
				// inside a walk is not this plugin's to explain.
				if p == at && os.IsNotExist(err) {
					return fmt.Errorf("%s does not exist", filepath.ToSlash(at))
				}

				return err
			}
			if !entry.IsDir() && entry.Name() == LockName {
				found = append(found, p)
			}

			return nil
		})
		if err != nil {
			return nil, err
		}
	}

	sort.Strings(found)

	return found, nil
}

func unique(values []string) []string {
	out := values[:0]
	seen := map[string]bool{}

	for _, value := range values {
		if seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}

	return out
}
