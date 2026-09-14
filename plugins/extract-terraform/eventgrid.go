package extractterraform

import (
	"path"
	"sort"
	"strconv"
	"strings"

	"github.com/hashicorp/hcl/v2/hclsyntax"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// Event Grid is topology declared by AzureRM: a custom, domain or system
// topic is the channel; an event subscription is the routing edge from it to
// a handler. Runtime delivery attempts and credentials are deliberately not
// read from Terraform state or the environment.
type eventGridTopic struct {
	r           *resource
	name        string
	domain      string
	inputSchema string
	topicType   string
	source      *resource
	sourceText  string
	synthetic   bool
}

type eventGridSubscription struct {
	r              *resource
	name           string
	topic          *resource
	scopeText      string
	endpoint       *resource
	endpointKind   string
	endpointName   string
	eventTypes     []string
	deliverySchema string
	subjectPrefix  string
	subjectSuffix  string
	caseSensitive  bool
	caseSet        bool
	advanced       int
	retryAttempts  string
	retryTTL       string
	deadLetter     string
}

type azureDestination struct {
	r     *resource
	name  string
	title string
}

func readAzureDestination(r *resource, b *plugin.Builder) *azureDestination {
	name, ok := named(r, "name", b)
	if !ok {
		return nil
	}
	title := map[string]string{
		typeAzureEventHub:        "Azure Event Hub",
		typeAzureServiceBusQueue: "Azure Service Bus queue",
		typeAzureServiceBusTopic: "Azure Service Bus topic",
		typeAzureStorageQueue:    "Azure Storage queue",
	}[r.Type]
	return &azureDestination{r: r, name: name, title: title}
}

func (destination *azureDestination) base() catalog.Channel {
	return catalog.Channel{
		Address:  destination.name,
		Kind:     catalog.ChannelKindMessage,
		Title:    destination.title,
		Doc:      "Declared in Terraform as " + destination.r.Address() + ".",
		Messages: []catalog.ChannelMessage{},
		Source:   destination.r.Source,
	}
}

func readEventGridTopic(r *resource, b *plugin.Builder) *eventGridTopic {
	name, ok := named(r, "name", b)
	if !ok {
		return nil
	}
	topic := &eventGridTopic{r: r, name: name}
	s := r.scope
	topic.inputSchema, _ = s.stringOf(r.attr("input_schema"), nil)
	switch r.Type {
	case typeEventGridSystemTopic:
		sourceExpr := firstExpression(r, "source_resource_id", "source_arm_resource_id")
		topic.source = firstRef(s, sourceExpr, "")
		topic.sourceText, _ = s.stringOf(sourceExpr, nil)
		topic.topicType, _ = s.stringOf(r.attr("topic_type"), nil)
	case typeEventGridDomainTopic:
		topic.domain, _ = s.stringOf(r.attr("domain_name"), nil)
	}
	return topic
}

func readEventGridSubscription(r *resource, b *plugin.Builder) *eventGridSubscription {
	name, ok := named(r, "name", b)
	if !ok {
		return nil
	}
	sub := &eventGridSubscription{r: r, name: name}
	s := r.scope
	scopeExpr := r.attr("scope")
	if r.Type == typeEventGridSystemSubscription {
		scopeExpr = r.attr("system_topic")
	}
	sub.topic = firstRef(s, scopeExpr, "")
	sub.scopeText, _ = s.stringOf(scopeExpr, nil)
	sub.eventTypes = stringsOf(s, r.attr("included_event_types"))
	sort.Strings(sub.eventTypes)
	sub.deliverySchema, _ = s.stringOf(r.attr("event_delivery_schema"), nil)

	if filters := r.nested("subject_filter"); len(filters) > 0 {
		sub.subjectPrefix, _ = s.stringOf(filters[0].attr("subject_begins_with"), nil)
		sub.subjectSuffix, _ = s.stringOf(filters[0].attr("subject_ends_with"), nil)
		sub.caseSensitive, sub.caseSet = s.boolOf(filters[0].attr("case_sensitive"))
	}
	for _, filter := range r.nested("advanced_filter") {
		if filter.body != nil {
			sub.advanced += len(filter.body.Blocks)
		}
	}
	if retry := r.nested("retry_policy"); len(retry) > 0 {
		sub.retryAttempts, _ = s.stringOf(retry[0].attr("max_delivery_attempts"), nil)
		sub.retryTTL, _ = s.stringOf(retry[0].attr("event_time_to_live"), nil)
	}
	if dead := r.nested("storage_blob_dead_letter_destination"); len(dead) > 0 {
		sub.deadLetter, _ = s.stringOf(dead[0].attr("storage_blob_container_name"), nil)
	}

	if endpoints := r.nested("azure_function_endpoint"); len(endpoints) > 0 {
		sub.endpoint = firstRef(s, endpoints[0].attr("function_id"), "")
		sub.endpointKind = "Azure Function"
	}
	if sub.endpointKind == "" {
		for _, candidate := range []struct {
			kind   string
			fields []string
		}{
			{"Event Hub", []string{"eventhub_id", "eventhub_endpoint_id"}},
			{"Service Bus queue", []string{"service_bus_queue_id", "service_bus_queue_endpoint_id"}},
			{"Service Bus topic", []string{"service_bus_topic_id", "service_bus_topic_endpoint_id"}},
			{"Relay hybrid connection", []string{"hybrid_connection_id", "hybrid_connection_endpoint_id"}},
		} {
			expr := firstExpression(r, candidate.fields...)
			if expr == nil {
				continue
			}
			sub.endpointKind = candidate.kind
			sub.endpoint = firstRef(s, expr, "")
			sub.endpointName, _ = s.stringOf(expr, nil)
			break
		}
	}
	if sub.endpointKind == "" {
		if endpoints := r.nested("storage_queue_endpoint"); len(endpoints) > 0 {
			sub.endpointKind = "Azure Storage queue"
			sub.endpoint = firstRef(s, endpoints[0].attr("queue_name"), "")
			sub.endpointName, _ = s.stringOf(endpoints[0].attr("queue_name"), nil)
		}
	}
	if sub.endpointKind == "" && len(r.nested("webhook_endpoint")) > 0 {
		// A webhook URL may contain a validation or access token. The topology
		// only needs the destination kind, so the URL never enters the catalog.
		sub.endpointKind = "webhook"
		sub.endpointName = "external endpoint"
	}
	if sub.endpointKind == "" {
		b.Warn(r.Source, r.Address()+" has no Event Grid destination this reader knows")
	}
	return sub
}

func firstExpression(r *resource, names ...string) hclsyntax.Expression {
	for _, name := range names {
		if expr := r.attr(name); expr != nil {
			return expr
		}
	}
	return nil
}

func (topic *eventGridTopic) address() string {
	if topic.r.Type == typeEventGridDomainTopic && topic.domain != "" {
		return topic.domain + "/" + topic.name
	}
	return topic.name
}

func (topic *eventGridTopic) base() catalog.Channel {
	title := "Azure Event Grid topic"
	if topic.synthetic {
		title = "Azure Event Grid source"
	}
	switch topic.r.Type {
	case typeEventGridSystemTopic:
		title = "Azure Event Grid system topic"
	case typeEventGridDomain:
		title = "Azure Event Grid domain"
	case typeEventGridDomainTopic:
		title = "Azure Event Grid domain topic"
	}
	doc := "Declared in Terraform as " + topic.r.Address() + "."
	if topic.synthetic {
		doc = "Event Grid subscription scope declared in Terraform as " + topic.r.Address() + "."
	}
	if topic.inputSchema != "" {
		doc += " Input schema `" + topic.inputSchema + "`."
	}
	if topic.r.Type == typeEventGridSystemTopic {
		source := topic.sourceText
		if topic.source != nil {
			source = topic.source.Address()
		}
		if source != "" {
			doc += " Carries events from `" + source + "`."
		}
		if topic.topicType != "" {
			doc += " Topic type `" + topic.topicType + "`."
		}
	}
	return catalog.Channel{
		Address:  topic.address(),
		Kind:     catalog.ChannelKindEvent,
		Title:    title,
		Doc:      doc,
		Messages: []catalog.ChannelMessage{},
		Source:   topic.r.Source,
	}
}

func (sub *eventGridSubscription) note(destination string) string {
	note := "Event Grid subscription `" + sub.name + "` delivers to " + destination + "."
	if len(sub.eventTypes) > 0 {
		note += " Includes event types `" + strings.Join(sub.eventTypes, "`, `") + "`."
	}
	if sub.subjectPrefix != "" || sub.subjectSuffix != "" {
		parts := []string{}
		if sub.subjectPrefix != "" {
			parts = append(parts, "begins with `"+sub.subjectPrefix+"`")
		}
		if sub.subjectSuffix != "" {
			parts = append(parts, "ends with `"+sub.subjectSuffix+"`")
		}
		note += " Subject " + strings.Join(parts, " and ")
		if sub.caseSet {
			note += map[bool]string{true: " (case-sensitive)", false: " (case-insensitive)"}[sub.caseSensitive]
		}
		note += "."
	}
	if sub.advanced > 0 {
		note += " " + strconv.Itoa(sub.advanced) + " advanced filter " + map[bool]string{true: "rules", false: "rule"}[sub.advanced != 1] + "."
	}
	if sub.deliverySchema != "" {
		note += " Delivery schema `" + sub.deliverySchema + "`."
	}
	if sub.retryAttempts != "" || sub.retryTTL != "" {
		note += " Retry policy"
		if sub.retryAttempts != "" {
			note += " up to " + sub.retryAttempts + " attempts"
		}
		if sub.retryTTL != "" {
			note += " within " + sub.retryTTL + " minutes"
		}
		note += "."
	}
	if sub.deadLetter != "" {
		note += " Dead letters go to blob container `" + sub.deadLetter + "`."
	}
	return note
}

func assembleEventGrid(found *infra, base *component, components map[*resource]*component) {
	byResource := map[*resource]*eventGridTopic{}
	bySource := map[*resource]*eventGridTopic{}
	for _, topic := range found.eventGrid {
		byResource[topic.r] = topic
		if topic.source != nil {
			bySource[topic.source] = topic
		}
	}
	claimed := map[*resource]bool{}
	destinations := map[*resource]*azureDestination{}
	claimedDestinations := map[*resource]bool{}
	for _, destination := range found.azureChannels {
		destinations[destination.r] = destination
	}
	for _, sub := range found.eventGridSubs {
		topic := byResource[sub.topic]
		if topic == nil {
			topic = bySource[sub.topic]
		}
		if topic == nil {
			topic = syntheticEventGridTopic(sub)
		}
		if topic == nil {
			continue
		}
		channel := topic.base()
		if receiver := components[sub.endpoint]; receiver != nil {
			for _, eventType := range sub.eventTypes {
				channel.Messages = append(channel.Messages, catalog.ChannelMessage{Name: eventType, Direction: catalog.ChannelReceive})
			}
			receiver.note(channel.Address, channel, sub.note("Azure Function `"+receiver.service.Name+"`"))
		} else {
			name := sub.endpointName
			if name == "" && sub.endpoint != nil {
				name = resourceName(sub.endpoint)
			}
			destination := sub.endpointKind
			if name != "" {
				destination += " `" + name + "`"
			}
			if destination == "" {
				destination = "an unresolved destination"
			}
			base.note(channel.Address, channel, sub.note(destination))
			if target := destinations[sub.endpoint]; target != nil {
				note := "Filled by Event Grid subscription `" + sub.name + "` from `" + channel.Address + "`."
				if len(sub.eventTypes) > 0 {
					note += " Includes event types `" + strings.Join(sub.eventTypes, "`, `") + "`."
				}
				base.note(target.name, target.base(), note)
				claimedDestinations[target.r] = true
			}
		}
		if _, declared := byResource[topic.r]; declared {
			claimed[topic.r] = true
		}
	}
	for _, topic := range found.eventGrid {
		if !claimed[topic.r] {
			base.note(topic.address(), topic.base(), "Nothing in the module subscribes to it.")
		}
	}
	for _, destination := range found.azureChannels {
		if !claimedDestinations[destination.r] {
			base.note(destination.name, destination.base(), "No Event Grid subscription in this module delivers to it.")
		}
	}
}

func syntheticEventGridTopic(sub *eventGridSubscription) *eventGridTopic {
	if sub.topic != nil {
		return &eventGridTopic{
			r:          sub.topic,
			name:       resourceName(sub.topic),
			source:     sub.topic,
			sourceText: sub.topic.Address(),
			synthetic:  true,
		}
	}
	if sub.scopeText == "" {
		return nil
	}
	name := path.Base(strings.TrimSuffix(sub.scopeText, "/"))
	if name == "." || name == "/" || name == "" {
		name = sub.scopeText
	}
	return &eventGridTopic{r: sub.r, name: name, sourceText: sub.scopeText, synthetic: true}
}

func resourceName(r *resource) string {
	for _, field := range []string{"name", "function_name", "queue_name"} {
		if name, ok := r.scope.stringOf(r.attr(field), nil); ok && name != "" {
			return name
		}
	}
	return r.Address()
}
