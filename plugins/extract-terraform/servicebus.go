package extractterraform

import (
	"path"
	"sort"
	"strings"

	"github.com/hashicorp/hcl/v2/hclsyntax"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// Service Bus is topology declared by AzureRM: a queue is a channel each
// message waits in for one receiver, a topic a channel every subscription
// takes its own copy of. A subscription is not a channel - it is a named copy
// of the topic with the rules that decide what reaches it, and a function
// reading it reads the topic. Values stay behind: a SQL filter is read for the
// properties it looks at, never the values it compares them with, and the
// connection setting a trigger names is never opened.

type busNamespace struct {
	r    *resource
	name string
	sku  string
}

// busTarget is an entity named by another: a forward_to, a binding. It is a
// declared resource when the name reaches one, and the name otherwise.
type busTarget struct {
	r    *resource
	name string
}

func (t busTarget) set() bool { return t.r != nil || t.name != "" }

type busEntity struct {
	r             *resource
	name          string
	topic         bool
	namespace     *resource
	namespaceName string
	partitioned   bool
	sessions      bool
	duplicates    bool
	expiryDead    bool
	maxDelivery   string
	forwardTo     busTarget
	forwardDead   busTarget
	// origin is the binding that named an entity the module does not declare.
	origin *resource

	facts   map[string]bool
	holders map[*component]map[string]bool
	readers []*component
}

type busSubscription struct {
	r           *resource
	name        string
	topic       *resource
	sessions    bool
	maxDelivery string
	forwardTo   busTarget
	forwardDead busTarget
}

type busRule struct {
	r            *resource
	name         string
	subscription *resource
	filter       string
}

type busGrant struct {
	r         *resource
	role      string
	scope     *resource
	principal string
}

// busBinding is a Service Bus binding of an Azure Function: a trigger it is
// run by, or an output it sends through.
type busBinding struct {
	fn           *resource
	trigger      bool
	target       busTarget
	topic        bool
	subscription string
}

type busFound struct {
	namespaces    []*busNamespace
	entities      []*busEntity
	subscriptions []*busSubscription
	rules         []*busRule
	grants        []*busGrant
	bindings      []*busBinding
}

func isBusEntity(r *resource) bool {
	return r != nil && (r.Type == typeAzureServiceBusQueue || r.Type == typeAzureServiceBusTopic)
}

func readBusNamespace(r *resource, b *plugin.Builder) *busNamespace {
	name, ok := named(r, "name", b)
	if !ok {
		return nil
	}
	sku, _ := r.scope.stringOf(r.attr("sku"), nil)
	return &busNamespace{r: r, name: name, sku: sku}
}

func readBusEntity(r *resource, b *plugin.Builder) *busEntity {
	name, ok := named(r, "name", b)
	if !ok {
		return nil
	}
	s := r.scope
	e := &busEntity{r: r, name: name, topic: r.Type == typeAzureServiceBusTopic}
	e.namespace = firstRef(s, r.attr("namespace_id"), typeServiceBusNamespace)
	if e.namespace == nil {
		e.namespaceName, _ = s.stringOf(r.attr("namespace_name"), nil)
	}
	e.partitioned, _ = s.boolOf(firstExpression(r, "partitioning_enabled", "enable_partitioning"))
	e.sessions, _ = s.boolOf(r.attr("requires_session"))
	e.duplicates, _ = s.boolOf(r.attr("requires_duplicate_detection"))
	e.expiryDead, _ = s.boolOf(r.attr("dead_lettering_on_message_expiration"))
	e.maxDelivery, _ = s.stringOf(r.attr("max_delivery_count"), nil)
	e.forwardTo = readBusTarget(s, r.attr("forward_to"))
	e.forwardDead = readBusTarget(s, r.attr("forward_dead_lettered_messages_to"))
	return e
}

func readBusSubscription(r *resource, b *plugin.Builder) *busSubscription {
	name, ok := named(r, "name", b)
	if !ok {
		return nil
	}
	s := r.scope
	sub := &busSubscription{r: r, name: name}
	sub.topic = firstRef(s, r.attr("topic_id"), typeAzureServiceBusTopic)
	if sub.topic == nil {
		b.Warn(r.Source, "topic_id of "+r.Address()+" could not be followed to a Service Bus topic declared here, so the subscription is not read")
		return nil
	}
	sub.sessions, _ = s.boolOf(r.attr("requires_session"))
	sub.maxDelivery, _ = s.stringOf(r.attr("max_delivery_count"), nil)
	sub.forwardTo = readBusTarget(s, r.attr("forward_to"))
	sub.forwardDead = readBusTarget(s, r.attr("forward_dead_lettered_messages_to"))
	return sub
}

func readBusRule(r *resource, b *plugin.Builder) *busRule {
	name, ok := named(r, "name", b)
	if !ok {
		return nil
	}
	rule := &busRule{r: r, name: name}
	rule.subscription = firstRef(r.scope, r.attr("subscription_id"), typeServiceBusSubscription)
	if rule.subscription == nil {
		b.Warn(r.Source, "subscription_id of "+r.Address()+" could not be followed to a Service Bus subscription declared here, so the rule is not read")
		return nil
	}
	rule.filter = describeFilter(r)
	return rule
}

// busRoles are the data-plane roles that say who may send and receive,
// by name and by the id of the built-in definition.
var busRoles = map[string]string{
	"azure service bus data owner":         "Azure Service Bus Data Owner",
	"azure service bus data receiver":      "Azure Service Bus Data Receiver",
	"azure service bus data sender":        "Azure Service Bus Data Sender",
	"090c5cfd-751d-490a-894a-3ce6f1109419": "Azure Service Bus Data Owner",
	"4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0": "Azure Service Bus Data Receiver",
	"69a216fc-b8fb-44d8-bc22-1f3c2cd27a39": "Azure Service Bus Data Sender",
}

// readBusGrant is a role assignment of a Service Bus data role, or nil for
// any other role - those are not the estate's shape.
func readBusGrant(r *resource, b *plugin.Builder) *busGrant {
	s := r.scope
	role := ""
	if name, ok := s.stringOf(r.attr("role_definition_name"), nil); ok {
		role = busRoles[strings.ToLower(name)]
	} else if id, ok := s.stringOf(r.attr("role_definition_id"), nil); ok {
		role = busRoles[strings.ToLower(path.Base(id))]
	}
	if role == "" {
		return nil
	}
	grant := &busGrant{r: r, role: role}
	for _, found := range s.refsOf(r.attr("scope"), nil) {
		switch found.target.Type {
		case typeServiceBusNamespace, typeAzureServiceBusQueue, typeAzureServiceBusTopic, typeServiceBusSubscription:
			grant.scope = found.target
		}
		if grant.scope != nil {
			break
		}
	}
	if grant.scope == nil {
		b.Warn(r.Source, "scope of "+r.Address()+" could not be followed to a Service Bus namespace, queue, topic or subscription declared here, so the grant is not read")
		return nil
	}
	grant.principal = principalOf(s, r.attr("principal_id"))
	return grant
}

// principalOf names who a role is granted to: the resource whose identity
// it is, or the variable or data source that gives the id. An id written
// out is not repeated.
func principalOf(s *scope, expr hclsyntax.Expression) string {
	if target := firstRef(s, expr, ""); target != nil {
		return "`" + target.Address() + "`"
	}
	if traversal, ok := expr.(*hclsyntax.ScopeTraversalExpr); ok {
		if parts := attrNames(traversal.Traversal); len(parts) > 1 {
			return "`" + strings.Join(parts, ".") + "`"
		}
	}
	return "a principal given by id"
}

func readBusTarget(s *scope, expr hclsyntax.Expression) busTarget {
	if expr == nil {
		return busTarget{}
	}
	for _, found := range s.refsOf(expr, nil) {
		if isBusEntity(found.target) {
			return busTarget{r: found.target}
		}
	}
	if name, ok := s.stringOf(expr, nil); ok {
		return busTarget{name: name}
	}
	if shape, holes := s.shapeOf(expr, nil); len(holes) > 0 && hasLiteral(shape) {
		return busTarget{name: shape}
	}
	return busTarget{}
}

// describeFilter is what a rule lets through, as the properties it looks at.
func describeFilter(r *resource) string {
	s := r.scope
	kind, _ := s.stringOf(r.attr("filter_type"), nil)
	var desc string
	switch kind {
	case "SqlFilter":
		expr := r.attr("sql_filter")
		sql, ok := s.stringOf(expr, nil)
		if !ok && expr != nil {
			sql = literalText(expr)
		}
		names := sqlNames(sql)
		switch {
		case len(names) > 0:
			desc = "a SQL filter on `" + strings.Join(names, "`, `") + "`"
		case strings.ReplaceAll(sql, " ", "") == "1=1":
			desc = "a SQL filter that passes every message"
		default:
			desc = "a SQL filter"
		}
	case "CorrelationFilter":
		desc = "a correlation filter"
		filters := r.nested("correlation_filter")
		if len(filters) == 0 {
			break
		}
		filter := filters[0]
		var parts []string
		// The label is the message's type, as an event type is on Event
		// Grid; the rest are routing fields whose values are not topology.
		if label, ok := s.stringOf(filter.attr("label"), nil); ok && label != "" {
			parts = append(parts, "label `"+label+"`")
		}
		var fields []string
		for _, field := range []string{"to", "reply_to", "session_id", "reply_to_session_id", "content_type", "correlation_id", "message_id"} {
			if filter.attr(field) != nil {
				fields = append(fields, field)
			}
		}
		var properties []string
		if obj, ok := filter.attr("properties").(*hclsyntax.ObjectConsExpr); ok {
			for _, item := range obj.Items {
				if key := keyOf(s, item.KeyExpr); key != "" {
					properties = append(properties, key)
				}
			}
		}
		sort.Strings(properties)
		fields = append(fields, properties...)
		if len(fields) > 0 {
			parts = append(parts, "`"+strings.Join(fields, "`, `")+"`")
		}
		if len(parts) > 0 {
			desc += " on " + strings.Join(parts, " and ")
		}
	default:
		desc = "a filter this reader does not know"
	}
	if r.attr("action") != nil {
		desc += ", with a SQL action that rewrites what passes"
	}
	return desc
}

// sqlWords are the words of the filter language that are not properties.
var sqlWords = map[string]bool{
	"and": true, "or": true, "not": true, "in": true, "is": true, "null": true,
	"like": true, "escape": true, "exists": true, "true": true, "false": true,
}

// sqlNames is the properties a SQL filter names, in order of appearance.
// String literals, numbers and parameters are passed over, so no value the
// filter compares with is read.
func sqlNames(sql string) []string {
	seen := map[string]bool{}
	var out []string
	add := func(name string) {
		if name != "" && !seen[name] {
			seen[name] = true
			out = append(out, name)
		}
	}
	isWord := func(c byte) bool {
		return c == '_' || c == '.' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
	}
	for i := 0; i < len(sql); {
		c := sql[i]
		switch {
		case c == '\'':
			i++
			for i < len(sql) {
				if sql[i] == '\'' {
					if i+1 < len(sql) && sql[i+1] == '\'' {
						i += 2
						continue
					}
					break
				}
				i++
			}
			i++
		case c == '[':
			end := strings.IndexByte(sql[i:], ']')
			if end < 0 {
				return out
			}
			add(sql[i+1 : i+end])
			i += end + 1
		case c == '@' || (c >= '0' && c <= '9'):
			i++
			for i < len(sql) && isWord(sql[i]) {
				i++
			}
		case isWord(c):
			start := i
			for i < len(sql) && isWord(sql[i]) {
				i++
			}
			word := strings.TrimSuffix(sql[start:i], ".")
			if i < len(sql) && sql[i] == '[' {
				continue
			}
			if !sqlWords[strings.ToLower(word)] {
				add(word)
			}
		default:
			i++
		}
	}
	return out
}

// busState is the Service Bus of the module while it is assembled: every
// entity by resource and by name, with the facts said about it so far.
type busState struct {
	found      *busFound
	namespaces map[*resource]*busNamespace
	byResource map[*resource]*busEntity
	byName     map[string]*busEntity
	entities   []*busEntity
}

func newBusState(found *busFound) *busState {
	bus := &busState{
		found:      found,
		namespaces: map[*resource]*busNamespace{},
		byResource: map[*resource]*busEntity{},
		byName:     map[string]*busEntity{},
	}
	for _, ns := range found.namespaces {
		bus.namespaces[ns.r] = ns
	}
	for _, e := range found.entities {
		bus.add(e)
		bus.byResource[e.r] = e
	}
	return bus
}

func (bus *busState) add(e *busEntity) {
	e.facts = map[string]bool{}
	e.holders = map[*component]map[string]bool{}
	bus.entities = append(bus.entities, e)
	if _, taken := bus.byName[e.name]; !taken {
		bus.byName[e.name] = e
	}
}

// entity is what a target names: the declared entity it reaches, or the one
// of that name, or nil for a name the module does not declare.
func (bus *busState) entity(t busTarget) *busEntity {
	if t.r != nil {
		return bus.byResource[t.r]
	}
	return bus.byName[t.name]
}

// name is how a target is spelled in a sentence.
func (bus *busState) name(t busTarget) string {
	if e := bus.entity(t); e != nil {
		return e.name
	}
	if t.name != "" {
		return t.name
	}
	return resourceName(t.r)
}

func (e *busEntity) fact(note string) { e.facts[note] = true }

func (e *busEntity) hold(c *component, note string) {
	notes := e.holders[c]
	if notes == nil {
		notes = map[string]bool{}
		e.holders[c] = notes
	}
	notes[note] = true
}

func (bus *busState) base(e *busEntity) catalog.Channel {
	title, kind := "Azure Service Bus queue", catalog.ChannelKindMessage
	if e.topic {
		title, kind = "Azure Service Bus topic", catalog.ChannelKindEvent
	}
	if e.r == nil {
		return catalog.Channel{
			Address:  e.name,
			Kind:     kind,
			Protocol: "servicebus",
			Title:    title,
			Doc:      "Named by a Service Bus binding of " + e.origin.Address() + "; not declared in this module.",
			Messages: []catalog.ChannelMessage{},
			Source:   e.origin.Source,
		}
	}
	doc := "Declared in Terraform as " + e.r.Address() + "."
	if ns := bus.namespaces[e.namespace]; ns != nil {
		doc += " In namespace `" + ns.name + "`"
		if ns.sku != "" {
			doc += " (" + ns.sku + ")"
		}
		doc += "."
	} else if e.namespaceName != "" {
		doc += " In namespace `" + e.namespaceName + "`."
	}
	if e.partitioned {
		doc += " Partitioned."
	}
	if e.sessions {
		doc += " Sessions required."
	}
	if e.duplicates {
		doc += " Duplicate detection on."
	}
	return catalog.Channel{
		Address:  e.name,
		Kind:     kind,
		Protocol: "servicebus",
		Title:    title,
		Doc:      doc,
		Messages: []catalog.ChannelMessage{},
		Source:   e.r.Source,
	}
}

func deliveries(count string) string {
	if count == "1" {
		return " Dead-lettered after 1 delivery."
	}
	return " Dead-lettered after " + count + " deliveries."
}

// assemble says every fact on the entities it is about, and puts each entity
// on the components bound to it - on the base service when none is.
func (bus *busState) assemble(base *component, components map[*resource]*component) {
	for _, e := range bus.entities {
		if e.maxDelivery != "" {
			e.fact(strings.TrimSpace(deliveries(e.maxDelivery)))
		}
		if e.expiryDead {
			e.fact("Expired messages are dead-lettered.")
		}
		if e.forwardTo.set() {
			e.fact("Forwards every message to `" + bus.name(e.forwardTo) + "`.")
			if target := bus.entity(e.forwardTo); target != nil {
				target.fact("Filled by forwarding from `" + e.name + "`.")
			}
		}
		if e.forwardDead.set() {
			e.fact("Dead letters are forwarded to `" + bus.name(e.forwardDead) + "`.")
			if target := bus.entity(e.forwardDead); target != nil {
				target.fact("Takes the dead letters of `" + e.name + "`.")
			}
		}
	}

	rules := map[*resource][]*busRule{}
	for _, rule := range bus.found.rules {
		rules[rule.subscription] = append(rules[rule.subscription], rule)
	}
	subscribed := map[*busEntity]bool{}
	subscriptions := map[*resource]*busSubscription{}
	for _, sub := range bus.found.subscriptions {
		subscriptions[sub.r] = sub
		topic := bus.byResource[sub.topic]
		if topic == nil {
			continue
		}
		subscribed[topic] = true
		topic.fact(sub.note(bus, rules[sub.r]))
		if target := bus.entity(sub.forwardTo); target != nil {
			target.fact("Filled by subscription `" + sub.name + "` of topic `" + topic.name + "`.")
		}
		if target := bus.entity(sub.forwardDead); target != nil {
			target.fact("Takes the dead letters of subscription `" + sub.name + "` of topic `" + topic.name + "`.")
		}
	}

	for _, grant := range bus.found.grants {
		switch grant.scope.Type {
		case typeServiceBusNamespace:
			ns := bus.namespaces[grant.scope]
			if ns == nil {
				continue
			}
			for _, e := range bus.entities {
				if e.namespace == grant.scope {
					e.fact("`" + grant.role + "` granted to " + grant.principal + " on the whole namespace `" + ns.name + "`.")
				}
			}
		case typeServiceBusSubscription:
			sub := subscriptions[grant.scope]
			if sub == nil {
				continue
			}
			if topic := bus.byResource[sub.topic]; topic != nil {
				topic.fact("`" + grant.role + "` granted to " + grant.principal + " on subscription `" + sub.name + "`.")
			}
		default:
			if e := bus.byResource[grant.scope]; e != nil {
				e.fact("`" + grant.role + "` granted to " + grant.principal + ".")
			}
		}
	}

	for _, binding := range bus.found.bindings {
		c := components[binding.fn]
		if c == nil {
			continue
		}
		e := bus.entity(binding.target)
		if e == nil {
			e = &busEntity{name: binding.target.name, topic: binding.topic, origin: binding.fn}
			bus.add(e)
		}
		switch {
		case !binding.trigger:
			e.hold(c, "Sent by `"+c.service.Name+"` through a Service Bus output binding.")
		case e.topic && binding.subscription != "":
			e.hold(c, "Received by `"+c.service.Name+"` through subscription `"+binding.subscription+"`.")
			e.readers = append(e.readers, c)
		default:
			e.hold(c, "Received by `"+c.service.Name+"` through a Service Bus trigger.")
			e.readers = append(e.readers, c)
		}
	}

	// A function reading the queue a subscription forwards to reads the
	// topic through it.
	for _, sub := range bus.found.subscriptions {
		topic := bus.byResource[sub.topic]
		queue := bus.entity(sub.forwardTo)
		if topic == nil || queue == nil {
			continue
		}
		for _, c := range queue.readers {
			topic.hold(c, "Received by `"+c.service.Name+"` through subscription `"+sub.name+"`, forwarded to `"+queue.name+"`.")
		}
	}

	for _, e := range bus.entities {
		channel := bus.base(e)
		if len(e.holders) == 0 {
			for note := range e.facts {
				base.note(e.name, channel, note)
			}
			switch {
			case e.topic && !subscribed[e]:
				base.note(e.name, channel, "Nothing in the module subscribes to it.")
			case !e.topic && !e.forwardTo.set():
				base.note(e.name, channel, "Nothing in the module receives from it.")
			default:
				base.channel(e.name, channel)
			}
			continue
		}
		for c, notes := range e.holders {
			c.channel(e.name, channel)
			for note := range e.facts {
				c.note(e.name, channel, note)
			}
			for note := range notes {
				c.note(e.name, channel, note)
			}
		}
	}
}

func (sub *busSubscription) note(bus *busState, rules []*busRule) string {
	note := "Subscription `" + sub.name + "`"
	if len(rules) == 0 {
		note += " takes every message; no rule is declared here."
	} else {
		sort.Slice(rules, func(i, j int) bool { return rules[i].name < rules[j].name })
		descs := make([]string, 0, len(rules))
		for _, rule := range rules {
			descs = append(descs, "rule `"+rule.name+"`, "+rule.filter)
		}
		note += " filters with " + strings.Join(descs, "; ") + "."
	}
	if sub.sessions {
		note += " Sessions required."
	}
	if sub.maxDelivery != "" {
		note += deliveries(sub.maxDelivery)
	}
	if sub.forwardTo.set() {
		note += " Forwards to `" + bus.name(sub.forwardTo) + "`."
	}
	if sub.forwardDead.set() {
		note += " Dead letters are forwarded to `" + bus.name(sub.forwardDead) + "`."
	}
	return note
}
