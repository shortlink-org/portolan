package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
	"gopkg.in/yaml.v3"
)

func extract(in plugin.Input, opts Options) (plugin.Response, error) {
	b := &plugin.Builder{}
	root := in.Root

	if opts.Context == "" {
		opts.Context = filepath.Base(root)
	}
	if opts.Service == "" {
		opts.Service = filepath.Base(root)
	}

	specPath, err := findSpec(root, opts.Spec, b)
	if err != nil {
		return plugin.Response{}, err
	}

	doc, err := load(specPath)
	if err != nil {
		return plugin.Response{}, fmt.Errorf("%s: %w", specPath, err)
	}

	source := filepath.ToSlash(specPath)
	service := opts.Context + "." + opts.Service

	channels := readChannels(doc, source, service, b)
	if len(channels) == 0 {
		b.Warn(service, source+" declares no channels")
	}

	fragment := catalog.Catalog{
		GeneratedAt: in.GeneratedAt,
		Commit:      in.Commit,
		Contexts: []catalog.BoundedContext{{
			ID:   opts.Context,
			Slug: opts.Context,
			// Named by whichever source knows the name, as the OpenAPI
			// extractor's fragment says beside the same gap: this document
			// describes what the service says on the bus, not what it is
			// called.
			Services: []catalog.Service{{
				ID:         service,
				Slug:       opts.Service,
				Provides:   []catalog.RpcService{},
				Consumes:   []catalog.RpcCall{},
				Aggregates: []catalog.Aggregate{},
				Channels:   channels,
			}},
		}},
		Defs:  map[string]catalog.TypeDef{},
		Flows: []catalog.Flow{},
		Adrs:  []catalog.Adr{},
	}

	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}

	b.File(firstNonEmpty(opts.Out, "bus.json"), string(encoded)+"\n")

	return b.Response(), nil
}

// draft is a channel while it is being read: the messages arrive from the
// operations that name them, one direction at a time, and the same message may
// be named twice.
type draft struct {
	channel catalog.Channel
	seen    map[string]bool
}

func (d *draft) add(message catalog.ChannelMessage) {
	if message.Name == "" {
		return
	}
	key := string(message.Direction) + " " + message.Name
	if d.seen[key] {
		return
	}
	d.seen[key] = true
	d.channel.Messages = append(d.channel.Messages, message)
}

func readChannels(doc *document, source, service string, b *plugin.Builder) []catalog.Channel {
	if doc.major == 2 {
		return channelsV2(doc, source, service, b)
	}

	return channelsV3(doc, source, service, b)
}

// channelsV3 reads 3.x: channels declare addresses and messages, and operations
// say which way each message travels.
func channelsV3(doc *document, source, service string, b *plugin.Builder) []catalog.Channel {
	drafts := map[string]*draft{}
	var order []string

	for _, c := range entries(child(doc.root, "channels")) {
		address := firstNonEmpty(text(child(c.value, "address")), c.key)
		drafts[c.key] = &draft{
			channel: catalog.Channel{
				Address:  address,
				Title:    text(child(c.value, "title")),
				Doc:      text(child(c.value, "description")),
				Messages: []catalog.ChannelMessage{},
				Source:   source,
			},
			seen: map[string]bool{},
		}
		order = append(order, c.key)
	}

	for _, op := range entries(child(doc.root, "operations")) {
		direction, ok := directionOf(text(child(op.value, "action")))
		if !ok {
			b.Warn(service, source+": operation "+op.key+" has no action, so nothing says which way its messages travel")

			continue
		}

		_, ref := doc.deref(child(op.value, "channel"))
		key := refKey(ref)
		d, found := drafts[key]
		if !found {
			b.Warn(service, source+": operation "+op.key+" names channel "+key+", which the document does not declare")

			continue
		}

		named := items(child(op.value, "messages"))
		if len(named) == 0 {
			// An operation that names no message carries everything the
			// channel declares, which is how a document says "this whole
			// channel goes this way".
			for _, m := range entries(child(channelNode(doc, key), "messages")) {
				d.add(doc.message(m.value, m.key, direction))
			}

			continue
		}

		for _, message := range named {
			node, ref := doc.deref(message)
			if node == nil {
				b.Warn(service, source+": operation "+op.key+" names message "+ref+", which is not in this document")

				continue
			}
			d.add(doc.message(node, refKey(ref), direction))
		}
	}

	out := make([]catalog.Channel, 0, len(order))
	for _, key := range order {
		d := drafts[key]
		if len(d.channel.Messages) == 0 {
			b.Warn(service, source+": channel "+d.channel.Address+" has no operation, so nothing says which way it travels")
		}
		out = append(out, d.channel)
	}

	return out
}

// channelsV2 reads 2.x, where the channel key is the address and the two
// operations are named from the client's side: `subscribe` is what the
// application produces, `publish` is what it consumes.
func channelsV2(doc *document, source, service string, b *plugin.Builder) []catalog.Channel {
	var out []catalog.Channel

	for _, c := range entries(child(doc.root, "channels")) {
		d := &draft{
			channel: catalog.Channel{
				Address:  c.key,
				Doc:      text(child(c.value, "description")),
				Messages: []catalog.ChannelMessage{},
				Source:   source,
			},
			seen: map[string]bool{},
		}

		for _, op := range []struct {
			key       string
			direction catalog.ChannelDirection
		}{
			{"subscribe", catalog.ChannelSend},
			{"publish", catalog.ChannelReceive},
		} {
			node := child(c.value, op.key)
			if node == nil {
				continue
			}

			message := child(node, "message")
			candidates := items(child(message, "oneOf"))
			if len(candidates) == 0 && message != nil {
				candidates = []*yaml.Node{message}
			}

			for _, candidate := range candidates {
				resolved, ref := doc.deref(candidate)
				if resolved == nil {
					b.Warn(service, source+": channel "+c.key+" names message "+ref+", which is not in this document")

					continue
				}
				d.add(doc.message(resolved, refKey(ref), op.direction))
			}
		}

		if len(d.channel.Messages) == 0 {
			b.Warn(service, source+": channel "+c.key+" declares no message")
		}

		out = append(out, d.channel)
	}

	return out
}

// message reads one message object into the fact the catalog keeps: the name it
// goes by on the wire, and enough prose to read it without opening the
// document.
//
// The name is the message's own `name` when it has one, and the key it is filed
// under when it does not. Those are different things - the key is the
// document's, the name is the bus's - and an event's wire name is compared
// against this, so a document that leaves `name` out is saying the two are the
// same.
func (d *document) message(node *yaml.Node, key string, direction catalog.ChannelDirection) catalog.ChannelMessage {
	resolved, _ := d.deref(node)
	if resolved == nil {
		resolved = node
	}

	return catalog.ChannelMessage{
		Name:      firstNonEmpty(text(child(resolved, "name")), key),
		Title:     text(child(resolved, "title")),
		Doc:       firstNonEmpty(text(child(resolved, "summary")), text(child(resolved, "description"))),
		Direction: direction,
	}
}

func channelNode(doc *document, key string) *yaml.Node {
	return child(doc.root, "channels", key)
}

func directionOf(action string) (catalog.ChannelDirection, bool) {
	switch action {
	case "send":
		return catalog.ChannelSend, true
	case "receive":
		return catalog.ChannelReceive, true
	}

	return "", false
}

// findSpec locates the document. Told where it is, it looks there; otherwise it
// searches, and says what it found so a service with two documents does not get
// described from whichever one sorted first without anybody noticing.
func findSpec(root, declared string, b *plugin.Builder) (string, error) {
	if declared != "" {
		return filepath.Join(root, filepath.FromSlash(declared)), nil
	}

	var found []string
	err := filepath.WalkDir(root, func(p string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		switch entry.Name() {
		case "asyncapi.yaml", "asyncapi.yml":
			found = append(found, p)
		}

		return nil
	})
	if err != nil {
		return "", err
	}

	if len(found) == 0 {
		return "", fmt.Errorf("no asyncapi document under %s, and none named in the options", root)
	}
	if len(found) > 1 {
		b.Warn("", "found "+strings.Join(found, ", ")+"; reading the first and ignoring the rest")
	}

	return found[0], nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}

	return ""
}
