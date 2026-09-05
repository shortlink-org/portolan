package main

import (
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

func (s *site) renderService(ctx *catalog.BoundedContext, svc *catalog.Service) {
	self := s.pathOf[svc.ID]

	var b strings.Builder
	b.WriteString("# " + svc.Name + "\n\n")
	b.WriteString(s.stamp() + "\n")

	b.WriteString(defList([][]string{
		{"Id", code(svc.ID)},
		{"Context", s.ref(self, ctx.ID, ctx.Name)},
		{"Repo", code(svc.Repo)},
		{"Path", code(svc.Path)},
	}))

	// The readme is a whole document of its own, so it goes in one level down
	// rather than being paraphrased.
	if readme := body(svc.Readme, svc.Name); readme != "" {
		b.WriteString("\n" + readme + "\n")
	}

	section(&b, "Aggregates", s.aggregateTable(self, svc))
	section(&b, "Provides", s.providesBlock(self, svc))
	section(&b, "Consumes", s.consumesTable(self, svc))
	section(&b, "Publishes", s.publishesTable(self, svc))
	section(&b, "Stores", s.storesTable(self, svc))
	section(&b, "Decisions", s.adrTable(self, s.adrsFor[svc.ID]))

	s.b.file(self, b.String())

	for i := range svc.Aggregates {
		s.renderAggregate(svc, &svc.Aggregates[i])
	}
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

func (s *site) providesBlock(from string, svc *catalog.Service) string {
	var b strings.Builder

	for i := range svc.Provides {
		rpc := &svc.Provides[i]
		b.WriteString("**" + code(rpc.ID) + "** — " + code(rpc.Source) + "\n\n")
		for _, method := range rpc.Methods {
			b.WriteString("- " + code(method.Name) + "\n")
		}

		for j := range rpc.Messages {
			msg := &rpc.Messages[j]
			b.WriteString("\n<details><summary>" + msg.Name + "</summary>\n\n")
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
		b.WriteString("\n")
	}

	return b.String()
}

func (s *site) consumesTable(from string, svc *catalog.Service) string {
	rows := make([][]string, 0, len(svc.Consumes))
	for i := range svc.Consumes {
		call := &svc.Consumes[i]
		rows = append(rows, []string{
			code(call.ID),
			s.ref(from, call.Peer, call.Peer),
			string(call.Status),
			code(call.Source),
			call.Note,
		})

		if call.Status == catalog.StatusUnresolved {
			s.b.warn(svc.ID, "%s calls %q, which nothing in this catalog resolves", svc.ID, call.ID)
		}
	}

	return table([]string{"Call", "Peer", "Status", "Source", "Note"}, rows)
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
				s.ref(from, agg.ID, event.Name),
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
		rows = append(rows, []string{
			s.ref(from, store.ID, store.Name),
			string(store.Kind),
			access,
			plural(len(store.Tables), "table"),
		})
	}

	return table([]string{"Store", "Kind", "Access", "Tables"}, rows)
}
