package extractterraform

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/internal/goscan"
	"github.com/shortlink-org/portolan/plugin"
)

func extract(in plugin.Input, opts Options) (plugin.Response, error) {
	b := &plugin.Builder{}
	dir, err := findDir(in.Root, opts.Dir, b)
	if err != nil {
		return plugin.Response{}, err
	}
	t, err := readTree(in.Root, dir, b)
	if err != nil {
		return plugin.Response{}, err
	}
	found := read(t, b)
	if len(found.queues)+len(found.topics)+len(found.functions)+len(found.stores) == 0 {
		b.Warn(filepath.ToSlash(filepath.Join(in.Root, dir)), "no AWS resource this reader knows was found")
	}

	fragment := assemble(found, opts)
	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}
	b.File(goscan.FirstNonEmpty(opts.Out, "terraform.json"), string(encoded)+"\n")
	return b.Response(), nil
}

// findDir is where the *.tf files are: the directory given, else the root
// when it holds any, else the first directory under it that does.
func findDir(root, given string, b *plugin.Builder) (string, error) {
	if given != "" {
		return filepath.ToSlash(filepath.Clean(given)), nil
	}
	if hasTF(root) {
		return ".", nil
	}
	var candidates []string
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() {
			return nil
		}
		name := entry.Name()
		if path != root && (strings.HasPrefix(name, ".") || name == "node_modules" || name == "vendor" || name == "target") {
			return filepath.SkipDir
		}
		if path != root && hasTF(path) {
			rel, _ := filepath.Rel(root, path)
			candidates = append(candidates, filepath.ToSlash(rel))
			return filepath.SkipDir
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	sort.Strings(candidates)
	if len(candidates) == 0 {
		return ".", nil
	}
	if len(candidates) > 1 {
		b.Warn(filepath.ToSlash(root), "found Terraform in "+strings.Join(candidates, ", ")+"; reading the first and ignoring the rest - set dir to choose")
	}
	return candidates[0], nil
}

func hasTF(dir string) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".tf") {
			return true
		}
	}
	return false
}

// component is one service being assembled: the base service the module
// sits beside, or a Lambda function. Channels are keyed by address and
// their notes gathered as a set, so that two facts about one queue on one
// component become one channel with two sentences.
type component struct {
	service  *catalog.Service
	channels map[string]*channelState
	stores   map[string]bool
}

type channelState struct {
	channel catalog.Channel
	notes   map[string]bool
}

func (c *component) channel(address string, base catalog.Channel) *channelState {
	state := c.channels[address]
	if state == nil {
		state = &channelState{channel: base, notes: map[string]bool{}}
		c.channels[address] = state
	}
	return state
}

func (c *component) note(address string, base catalog.Channel, note string) {
	c.channel(address, base).notes[note] = true
}

// assemble turns what was read into the fragment: the base service, one
// service of kind function per Lambda, the stores at the root owned by the
// base service, and every queue and topic on the components that touch it -
// or on the base service when nothing does.
func assemble(found *infra, opts Options) catalog.Catalog {
	owner := opts.Context + "." + opts.Service
	base := &component{
		service:  &catalog.Service{ID: owner, Slug: opts.Service, Provides: []catalog.RpcService{}, Consumes: []catalog.RpcCall{}, Aggregates: []catalog.Aggregate{}},
		channels: map[string]*channelState{},
		stores:   map[string]bool{},
	}
	components := map[*resource]*component{}
	all := []*component{base}
	for _, fn := range found.functions {
		slug := goscan.Slug(fn.name)
		technologies := []string{"AWS Lambda"}
		if fn.runtime != "" {
			technologies = append(technologies, fn.runtime)
		}
		if slug == opts.Service {
			base.service.Kind = catalog.ComponentKindFunction
			base.service.Name = fn.name
			base.service.Technologies = technologies
			components[fn.r] = base
			continue
		}
		c := &component{
			service: &catalog.Service{
				ID:           opts.Context + "." + slug,
				Slug:         slug,
				Name:         fn.name,
				Kind:         catalog.ComponentKindFunction,
				Technologies: technologies,
				Provides:     []catalog.RpcService{},
				Consumes:     []catalog.RpcCall{},
				Aggregates:   []catalog.Aggregate{},
			},
			channels: map[string]*channelState{},
			stores:   map[string]bool{},
		}
		components[fn.r] = c
		all = append(all, c)
	}

	// Stores first: their ids are what channels and functions point at.
	storeIDs := map[*resource]string{}
	taken := map[string]bool{}
	var stores []catalog.Store
	for _, st := range found.stores {
		slug := goscan.Slug(st.name)
		if taken[slug] {
			slug = goscan.Slug(st.name + "-" + st.r.Label)
		}
		taken[slug] = true
		id := owner + "." + slug
		storeIDs[st.r] = id
		tables := st.tables
		for i := range tables {
			tables[i].ID = id + "." + goscan.Slug(tables[i].Name)
		}
		if tables == nil {
			tables = []catalog.Table{}
		}
		stores = append(stores, catalog.Store{
			ID:     id,
			Slug:   slug,
			Name:   st.name,
			Kind:   st.kind,
			Owner:  owner,
			Tables: tables,
			Source: st.r.Source,
		})
		base.stores[id] = true
	}
	sort.Slice(stores, func(i, j int) bool { return stores[i].ID < stores[j].ID })

	functionNames := map[*resource]string{}
	for _, fn := range found.functions {
		functionNames[fn.r] = fn.name
	}

	queueBase := func(q *queue) catalog.Channel {
		doc := "Declared in Terraform as " + q.r.Address() + "."
		if q.fifo {
			doc += " FIFO."
		}
		return catalog.Channel{Address: q.name, Kind: catalog.ChannelKindMessage, Title: "SQS queue", Doc: doc, Messages: []catalog.ChannelMessage{}, Source: q.r.Source}
	}
	topicBase := func(tp *topic) catalog.Channel {
		doc := "Declared in Terraform as " + tp.r.Address() + "."
		if tp.fifo {
			doc += " FIFO."
		}
		return catalog.Channel{Address: tp.name, Kind: catalog.ChannelKindEvent, Title: "SNS topic", Doc: doc, Messages: []catalog.ChannelMessage{}, Source: tp.r.Source}
	}
	queueByResource := map[*resource]*queue{}
	for _, q := range found.queues {
		queueByResource[q.r] = q
	}
	topicByResource := map[*resource]*topic{}
	for _, tp := range found.topics {
		topicByResource[tp.r] = tp
	}

	// claimed is every queue and topic some component touches; the rest go
	// on the base service.
	claimed := map[*resource]bool{}
	// queueReaders is who receives from a queue, for a topic that reaches a
	// function through one.
	queueReaders := map[*resource][]*component{}

	for _, m := range found.mappings {
		c := components[m.fn]
		if c == nil {
			continue
		}
		fnName := functionNames[m.fn]
		switch m.source.target.Type {
		case typeQueue:
			q := queueByResource[m.source.target]
			if q == nil {
				continue
			}
			c.note(q.name, queueBase(q), "Received by `"+fnName+"` through an event source mapping.")
			claimed[q.r] = true
			queueReaders[q.r] = append(queueReaders[q.r], c)
		case typeTable:
			if id, ok := storeIDs[m.source.target]; ok {
				c.stores[id] = true
			}
		}
	}

	for _, fn := range found.functions {
		c := components[fn.r]
		keys := make([]string, 0, len(fn.env))
		for key := range fn.env {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			for _, found := range fn.env[key] {
				switch found.target.Type {
				case typeQueue:
					if q := queueByResource[found.target]; q != nil {
						c.note(q.name, queueBase(q), "Handed to `"+fn.name+"` as `"+key+"`; which way messages go is not said here.")
						claimed[q.r] = true
					}
				case typeTopic:
					if tp := topicByResource[found.target]; tp != nil {
						c.note(tp.name, topicBase(tp), "Handed to `"+fn.name+"` as `"+key+"`; which way messages go is not said here.")
						claimed[tp.r] = true
					}
				default:
					if id, ok := storeIDs[found.target]; ok {
						c.stores[id] = true
					}
				}
			}
		}
	}

	for _, sub := range found.subscriptions {
		tp := topicByResource[sub.topic]
		if tp == nil {
			continue
		}
		switch sub.endpoint.Type {
		case typeQueue:
			q := queueByResource[sub.endpoint]
			if q == nil {
				continue
			}
			// The queue says what fills it, wherever it is listed; the
			// functions reading the queue are reading the topic through it.
			for _, c := range queueReaders[q.r] {
				c.note(q.name, queueBase(q), "Subscribed to SNS topic `"+tp.name+"`.")
				c.note(tp.name, topicBase(tp), "Received by `"+c.service.Name+"` through SQS queue `"+q.name+"`.")
				claimed[tp.r] = true
			}
			if len(queueReaders[q.r]) == 0 {
				holder := base
				if holders := holdersOf(all, q.name); len(holders) > 0 {
					holder = holders[0]
				}
				holder.note(q.name, queueBase(q), "Subscribed to SNS topic `"+tp.name+"`.")
				base.note(tp.name, topicBase(tp), "Delivered to SQS queue `"+q.name+"`.")
				claimed[q.r] = true
				claimed[tp.r] = true
			}
		case typeFunction:
			c := components[sub.endpoint]
			if c == nil {
				continue
			}
			c.note(tp.name, topicBase(tp), "Received by `"+functionNames[sub.endpoint]+"` through an SNS subscription.")
			claimed[tp.r] = true
		}
	}

	for _, n := range found.notifications {
		bucketID, ok := storeIDs[n.bucket]
		if !ok {
			continue
		}
		bucketName := ""
		for _, st := range found.stores {
			if st.r == n.bucket {
				bucketName = st.name
			}
		}
		for _, target := range n.targets {
			events := strings.Join(target.events, ", ")
			if events == "" {
				events = "its events"
			}
			switch target.target.Type {
			case typeFunction:
				c := components[target.target]
				if c == nil {
					continue
				}
				c.stores[bucketID] = true
			case typeQueue:
				if q := queueByResource[target.target]; q != nil {
					holder := base
					if holders := holdersOf(all, q.name); len(holders) > 0 {
						holder = holders[0]
					}
					holder.note(q.name, queueBase(q), "Filled by S3 bucket `"+bucketName+"` on "+events+".")
					claimed[q.r] = true
				}
			case typeTopic:
				if tp := topicByResource[target.target]; tp != nil {
					base.note(tp.name, topicBase(tp), "Filled by S3 bucket `"+bucketName+"` on "+events+".")
					claimed[tp.r] = true
				}
			}
		}
	}

	for _, q := range found.queues {
		if q.dlq != nil {
			if dlq := queueByResource[q.dlq]; dlq != nil {
				after := ""
				if q.maxReceive != "" {
					after = " after " + q.maxReceive + " receives"
				}
				for _, c := range holdersOf(all, q.name) {
					c.note(q.name, queueBase(q), "Dead letters go to `"+dlq.name+"`"+after+".")
				}
				if len(holdersOf(all, q.name)) == 0 {
					base.note(q.name, queueBase(q), "Dead letters go to `"+dlq.name+"`"+after+".")
				}
				holder := base
				if readers := holdersOf(all, dlq.name); len(readers) > 0 {
					holder = readers[0]
				}
				holder.note(dlq.name, queueBase(dlq), "Dead-letter queue of `"+q.name+"`.")
				claimed[dlq.r] = true
			}
		}
	}

	for _, q := range found.queues {
		if !claimed[q.r] {
			base.note(q.name, queueBase(q), "Nothing in the module receives from it or is configured with it.")
		}
	}
	for _, tp := range found.topics {
		if !claimed[tp.r] {
			base.note(tp.name, topicBase(tp), "Nothing in the module subscribes to it or is configured with it.")
		}
	}

	var services []catalog.Service
	for _, c := range all {
		addresses := make([]string, 0, len(c.channels))
		for address := range c.channels {
			addresses = append(addresses, address)
		}
		sort.Strings(addresses)
		for _, address := range addresses {
			state := c.channels[address]
			notes := make([]string, 0, len(state.notes))
			for note := range state.notes {
				notes = append(notes, note)
			}
			sort.Strings(notes)
			channel := state.channel
			if len(notes) > 0 {
				channel.Doc += " " + strings.Join(notes, " ")
			}
			c.service.Channels = append(c.service.Channels, channel)
		}
		if len(c.stores) > 0 {
			ids := make([]string, 0, len(c.stores))
			for id := range c.stores {
				ids = append(ids, id)
			}
			sort.Strings(ids)
			c.service.Stores = ids
		}
		services = append(services, *c.service)
	}
	sort.SliceStable(services[1:], func(i, j int) bool { return services[1+i].ID < services[1+j].ID })

	return catalog.Catalog{
		Contexts: []catalog.BoundedContext{{
			ID:       opts.Context,
			Slug:     opts.Context,
			Services: services,
		}},
		Defs:   map[string]catalog.TypeDef{},
		Flows:  []catalog.Flow{},
		Adrs:   []catalog.Adr{},
		Stores: stores,
	}
}

// holdersOf is every component already listing a channel.
func holdersOf(all []*component, address string) []*component {
	var out []*component
	for _, c := range all {
		if _, ok := c.channels[address]; ok {
			out = append(out, c)
		}
	}
	return out
}
