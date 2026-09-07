package main

import (
	"path"
	"regexp"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

func (s *site) renderService(ctx *catalog.BoundedContext, svc *catalog.Service) {
	self := s.pathOf[svc.ID]

	var b strings.Builder
	b.WriteString("# " + svc.Name + "\n\n")
	b.WriteString(s.stamp() + "\n")

	groupLabel := "Context"
	if ctx.Kind != "" && ctx.Kind != catalog.GroupKindBoundedContext {
		groupLabel = "Group"
	}
	rows := [][]string{
		{"Id", code(svc.ID)},
		{groupLabel, s.ref(self, ctx.ID, ctx.Name)},
		{"Repo", repoLink(svc.Repo)},
		{"Path", s.source(self, strings.TrimSuffix(svc.Path, "/")+"/", svc)},
	}
	if svc.Kind != "" {
		rows = append(rows, []string{"Kind", string(svc.Kind)})
	}
	if len(svc.Technologies) > 0 {
		rows = append(rows, []string{"Technologies", strings.Join(svc.Technologies, ", ")})
	}
	// Who to ask, when the estate keeps a CODEOWNERS. Left out entirely when
	// it does not: a line reading "Owners: none" is a claim, and nobody made
	// it.
	if len(svc.Owners) > 0 {
		handles := make([]string, 0, len(svc.Owners))
		for _, handle := range svc.Owners {
			handles = append(handles, code(handle))
		}
		rows = append(rows, []string{"Owners", strings.Join(handles, ", ")})
	}
	b.WriteString(defList(rows))

	// The readme is a whole document of its own, so it goes in one level down
	// rather than being paraphrased.
	if readme := body(s.rewriteServiceReadmeLinks(self, ctx, svc), svc.Name); readme != "" {
		b.WriteString("\n" + readme + "\n")
	}

	if svc.Kind == "" || svc.Kind == catalog.ComponentKindService || len(svc.Aggregates) > 0 {
		section(&b, "Aggregates", s.aggregateTable(self, svc))
	}
	section(&b, "Provides", s.providesBlock(self, svc.Provides, svc))
	section(&b, "Consumes", s.consumesTable(self, svc))
	section(&b, "Publishes", s.publishesTable(self, svc))
	section(&b, "Channels", s.channelsBlock(self, svc))
	section(&b, "Schema modules", s.modulesTable(self, svc))
	section(&b, "Stores", s.storesTable(self, svc))
	section(&b, "Commands", s.commandsTable(self, svc))
	section(&b, "Decisions", s.adrTable(self, s.adrsFor[svc.ID]))

	s.b.file(self, b.String())

	for i := range svc.Aggregates {
		s.renderAggregate(svc, &svc.Aggregates[i])
	}
}

var markdownLink = regexp.MustCompile(`\]\(([^\s)]+)([^)]*)\)`)

// rewriteServiceReadmeLinks keeps links copied from a service README useful
// after that README moves into the generated tree. ADRs and glossaries have
// canonical generated pages; linking back into the source tree would either
// be broken or make a checked-in documentation bundle depend on its old
// directory layout.
func (s *site) rewriteServiceReadmeLinks(from string, ctx *catalog.BoundedContext, svc *catalog.Service) string {
	if svc.Readme == "" || svc.Path == "" {
		return svc.Readme
	}

	targets := map[string]string{}
	for i := range s.cat.Adrs {
		adr := &s.cat.Adrs[i]
		if generated, ok := s.pathOf[adr.ID]; ok {
			targets[sourceFile(adr.Source)] = generated
			// A source README may already point at a repository-level docs/
			// output. It still has to be made relative to its new page.
			targets[path.Join("docs", generated)] = generated
		}
	}
	if terms := s.termsOf[ctx.ID]; len(terms) > 0 {
		generated := s.glossaryPath(ctx)
		for _, term := range terms {
			targets[sourceFile(term.Source)] = generated
		}
	}

	readmeDir := path.Dir(path.Join(svc.Path, "README.md"))
	return markdownLink.ReplaceAllStringFunc(svc.Readme, func(match string) string {
		parts := markdownLink.FindStringSubmatch(match)
		if len(parts) != 3 {
			return match
		}
		destination, suffix := splitDestination(parts[1])
		if destination == "" || strings.HasPrefix(destination, "#") || strings.Contains(destination, "://") || strings.HasPrefix(destination, "mailto:") {
			return match
		}

		sourceTarget := path.Clean(path.Join(readmeDir, destination))
		generated, ok := targets[sourceTarget]
		if !ok {
			return match
		}
		return "](" + rel(from, generated) + suffix + parts[2] + ")"
	})
}

func sourceFile(source string) string {
	if at := strings.LastIndex(source, ":"); at > 0 {
		if isDigits(source[at+1:]) {
			return source[:at]
		}
	}
	return source
}

func isDigits(value string) bool {
	if value == "" {
		return false
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}

func splitDestination(destination string) (string, string) {
	if at := strings.IndexAny(destination, "#?"); at >= 0 {
		return destination[:at], destination[at:]
	}
	return destination, ""
}

func (s *site) aggregateTable(from string, svc *catalog.Service) string {
	rows := make([][]string, 0, len(svc.Aggregates))
	for i := range svc.Aggregates {
		agg := &svc.Aggregates[i]

		commands, queries := 0, 0
		for _, op := range agg.Operations {
			if op.Kind == catalog.OperationQuery {
				queries++
			} else {
				commands++
			}
		}

		rows = append(rows, []string{
			s.ref(from, agg.ID, agg.Name),
			code(agg.Root),
			plural(commands, "command"),
			plural(queries, "query", "queries"),
			plural(len(agg.Events), "event"),
		})
	}

	return table([]string{"Aggregate", "Root", "Commands", "Queries", "Events"}, rows)
}

// providesBlock lists interfaces and their methods, for a service of the
// estate and for a system outside it alike: what something answers on is the
// same kind of fact whoever owns the far end.
func (s *site) providesBlock(from string, provides []catalog.RpcService, owner *catalog.Service) string {
	var b strings.Builder

	for i := range provides {
		rpc := &provides[i]
		b.WriteString("### " + rpc.ID + "\n\n")
		meta := [][]string{{"Source", s.source(from, rpc.Source, owner)}}
		if rpc.Module != "" {
			meta = append(meta, []string{"Module", s.ref(from, rpc.Module, rpc.Module)})
		}
		b.WriteString(defList(meta))

		methods := make([][]string, 0, len(rpc.Methods))
		for j := range rpc.Methods {
			method := &rpc.Methods[j]
			route := ""
			if method.HTTP != nil {
				route = code(method.HTTP.Method + " " + method.HTTP.Path)
			}
			if method.SOAP != nil {
				soap := "SOAP"
				if method.SOAP.Version != "" {
					soap += " " + method.SOAP.Version
				}
				if method.SOAP.Action != "" {
					soap += " " + method.SOAP.Action
				}
				route = code(soap)
			}
			streaming := string(method.Streaming)
			if method.Deprecated {
				streaming = strings.TrimSpace(streaming + " deprecated")
			}
			doc := method.Doc
			if method.SOAP != nil {
				var details []string
				if method.SOAP.Endpoint != "" {
					details = append(details, "endpoint "+code(method.SOAP.Endpoint))
				}
				if method.SOAP.Binding != "" {
					details = append(details, "binding "+code(method.SOAP.Binding))
				}
				if method.SOAP.Style != "" {
					details = append(details, method.SOAP.Style)
				}
				if len(method.SOAP.Headers) > 0 {
					details = append(details, "headers "+code(strings.Join(method.SOAP.Headers, ", ")))
				}
				if len(method.SOAP.Faults) > 0 {
					details = append(details, "faults "+code(strings.Join(method.SOAP.Faults, ", ")))
				}
				if len(details) > 0 {
					doc = strings.TrimSpace(strings.TrimSpace(doc) + " " + strings.Join(details, "; "))
				}
			}
			methods = append(methods, []string{
				code(method.Name), route, s.methodShape(from, method.Request, method.RequestRef),
				s.methodShape(from, method.Response, method.ResponseRef), streaming, doc,
			})
		}
		if rendered := table([]string{"Method", "Route", "Request", "Response", "Mode", "Doc"}, methods); rendered != "" {
			b.WriteString("\n" + rendered)
		}

		for j := range rpc.Messages {
			msg := &rpc.Messages[j]
			b.WriteString("\n<a id=\"message-" + anchorID(msg.Name) + "\"></a>\n")
			b.WriteString("<details><summary>" + msg.Name + "</summary>\n\n")
			if msg.Discriminator != nil {
				b.WriteString("Discriminator " + code(msg.Discriminator.Property) + ": ")
				variants := make([]string, 0, len(msg.Discriminator.Variants))
				for _, variant := range msg.Discriminator.Variants {
					variants = append(variants, code(variant.Value)+" → "+code(variant.Message))
				}
				b.WriteString(strings.Join(variants, ", ") + "\n\n")
			}
			b.WriteString(s.fieldTable(from, msg.Fields))
			b.WriteString("\n</details>\n")
		}
		for j := range rpc.Enums {
			set := &rpc.Enums[j]
			b.WriteString("\n<a id=\"enum-" + anchorID(set.Name) + "\"></a>\n")
			b.WriteString("<details><summary>" + set.Name + " (enum)</summary>\n\n")
			if set.Doc != "" {
				b.WriteString(set.Doc + "\n\n")
			}
			rows := make([][]string, 0, len(set.Values))
			for _, value := range set.Values {
				rows = append(rows, []string{code(value.Name), strconv.Itoa(value.Number), value.Doc})
			}
			b.WriteString(table([]string{"Value", "Number", "Doc"}, rows))
			b.WriteString("\n</details>\n")
		}
		b.WriteString("\n")
	}

	return b.String()
}

func (s *site) methodShape(from, local, shared string) string {
	if shared != "" {
		return s.defRef(from, shared)
	}
	if local != "" {
		return code(local)
	}
	return ""
}

func (s *site) consumesTable(from string, svc *catalog.Service) string {
	rows := make([][]string, 0, len(svc.Consumes))
	for i := range svc.Consumes {
		call := &svc.Consumes[i]
		rows = append(rows, []string{
			code(call.ID),
			s.ref(from, call.Peer, call.Peer),
			s.ref(from, call.Module, call.Module),
			string(call.Status),
			s.source(from, call.Source, svc),
			s.viaRef(from, call.Via),
			call.Note,
		})

		if call.Status == catalog.StatusUnresolved {
			s.b.warn(svc.ID, "%s calls %q, which nothing in this catalog resolves", svc.ID, call.ID)
		}
	}

	return table([]string{"Call", "Peer", "Module", "Status", "Source", "Via", "Note"}, rows)
}

func (s *site) channelsBlock(from string, svc *catalog.Service) string {
	var b strings.Builder
	for i := range svc.Channels {
		channel := &svc.Channels[i]
		b.WriteString("### " + channel.Address + "\n\n")
		if channel.Kind == catalog.ChannelKindJob {
			b.WriteString("`work queue`\n\n")
		} else if channel.Kind == catalog.ChannelKindMessage {
			b.WriteString("`message stream`\n\n")
		}
		if channel.Title != "" {
			b.WriteString("**" + channel.Title + "**\n\n")
		}
		if channel.Doc != "" {
			b.WriteString(channel.Doc + "\n\n")
		}
		if channel.Source != "" {
			b.WriteString("Source: " + s.source(from, channel.Source, svc) + "\n\n")
		}
		rows := make([][]string, 0, len(channel.Messages))
		for j := range channel.Messages {
			message := &channel.Messages[j]
			name := code(message.Name)
			if eventID := s.wireEvent[message.Name]; eventID != "" {
				name = s.eventRef(from, eventID, message.Name)
			}
			rows = append(rows, []string{string(message.Direction), name, message.Title, message.Doc})
		}
		if rendered := table([]string{"Direction", "Message", "Title", "Doc"}, rows); rendered != "" {
			b.WriteString(rendered)
		}
		b.WriteString("\n")
	}
	return b.String()
}

func (s *site) modulesTable(from string, svc *catalog.Service) string {
	rows := make([][]string, 0, len(svc.Modules))
	for _, id := range svc.Modules {
		module, ok := s.modules[id]
		if !ok {
			rows = append(rows, []string{code(id), "unknown", "", ""})
			continue
		}
		access := "reads"
		if module.Owner == svc.ID {
			access = "publishes"
		}
		rows = append(rows, []string{s.ref(from, id, module.Name), access, module.Commit, strings.Join(module.Packages, ", ")})
	}
	return table([]string{"Module", "Access", "Commit", "Packages"}, rows)
}

// publishesTable is the service's events gathered from every aggregate, which
// is the shape a reader integrating with the service wants: they do not care
// which aggregate inside it produced the event.
func (s *site) publishesTable(from string, svc *catalog.Service) string {
	var rows [][]string
	for i := range svc.Aggregates {
		agg := &svc.Aggregates[i]
		for j := range agg.Events {
			event := &agg.Events[j]

			consumers := make([]string, 0, len(event.Consumers))
			for _, consumer := range event.Consumers {
				text := consumer.Service
				if consumer.Status != catalog.StatusVerified {
					text += " (" + string(consumer.Status) + ")"
				}
				consumers = append(consumers, s.ref(from, consumer.Service, text))
			}

			latest := ""
			if len(event.Versions) > 0 {
				latest = event.Versions[len(event.Versions)-1].Version
			}

			rows = append(rows, []string{
				s.eventRef(from, event.ID, event.Name),
				latest,
				strings.Join(consumers, ", "),
			})
		}
	}

	return table([]string{"Event", "Latest", "Consumers"}, rows)
}

// storesTable separates what the service owns from what it only reads. The
// catalog does not state the difference on the service - a store names its own
// owner - so it is worked out here rather than asked of the reader.
func (s *site) storesTable(from string, svc *catalog.Service) string {
	rows := make([][]string, 0, len(svc.Stores))
	for _, id := range svc.Stores {
		store, known := s.stores[id]
		if !known {
			rows = append(rows, []string{code(id), "—", "unknown", "—"})
			s.b.warn(svc.ID, "%s touches store %q, which is not in this catalog", svc.ID, id)

			continue
		}

		access := "reads"
		if store.Owner == svc.ID {
			access = "owns"
		}
		schema := plural(len(store.Tables), "table")
		if len(store.Keyspaces) > 0 {
			schema = plural(len(store.Keyspaces), "key pattern")
		}
		rows = append(rows, []string{
			s.ref(from, store.ID, store.Name),
			string(store.Kind),
			access,
			schema,
		})
	}

	return table([]string{"Store", "Kind", "Access", "Schema"}, rows)
}

// commandsTable is what a developer types against the checkout, one row per
// entry of the runner files. The line to type comes first, because it is the
// one cell a reader copies; the body is what it does when the file says
// nothing about it, and is folded to its first line so a build script does
// not become the table.
func (s *site) commandsTable(from string, svc *catalog.Service) string {
	rows := make([][]string, 0, len(svc.Commands))
	for _, cmd := range svc.Commands {
		rows = append(rows, []string{
			code(cmd.Run),
			cmd.Doc,
			code(bodyLine(cmd.Body)),
			s.source(from, cmd.Source, svc),
		})
	}

	return table([]string{"Run", "Does", "Body", "Source"}, rows)
}

func bodyLine(s string) string {
	line, rest, more := strings.Cut(s, "\n")
	if more && strings.TrimSpace(rest) != "" {
		return line + " …"
	}

	return line
}
