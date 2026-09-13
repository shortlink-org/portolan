package extractdebezium

import (
	"encoding/json"
	"regexp"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/internal/goscan"
	"github.com/shortlink-org/portolan/plugin"
)

var literalTable = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_$-]*\.[A-Za-z_][A-Za-z0-9_$-]*$`)

type estate struct {
	groups    map[string]*groupState
	flows     []catalog.Flow
	flowIDs   map[string]bool
	pipelines map[string]string
	warnings  *plugin.Builder
	context   string
	broker    string
}

type groupState struct {
	services map[string]*serviceState
}

type serviceState struct {
	service  catalog.Service
	channels map[string]*channelState
	stores   map[string]bool
}

type channelState struct {
	channel  catalog.Channel
	messages map[string]catalog.ChannelMessage
}

func extract(in plugin.Input, opts Options) (plugin.Response, error) {
	b := &plugin.Builder{}
	connectors, err := discover(in.Root, opts.Paths, b)
	if err != nil {
		return plugin.Response{}, err
	}
	if len(connectors) == 0 {
		b.Warn(filepathLabel(in.Root, opts.Paths), "no Debezium connector configuration was found")
	}

	e := &estate{groups: map[string]*groupState{}, flowIDs: map[string]bool{}, pipelines: map[string]string{}, warnings: b, context: opts.Context, broker: opts.Broker}
	seenOptions := map[string]bool{}
	for _, found := range connectors {
		cfg := opts.Connectors[found.name]
		if _, configured := opts.Connectors[found.name]; configured {
			seenOptions[found.name] = true
		}
		e.add(found, cfg)
	}
	for name := range opts.Connectors {
		if !seenOptions[name] {
			b.Warn(name, "connector options name no Debezium declaration under the selected paths")
		}
	}

	fragment := e.catalog()
	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}
	b.File(opts.Out, string(encoded)+"\n")
	return b.Response(), nil
}

func (e *estate) add(found connector, opts ConnectorOptions) {
	if !strings.HasSuffix(found.class, ".PostgresConnector") {
		e.warnings.Warn(found.source, "Debezium connector "+found.name+" uses "+found.class+"; the first extractor release reads PostgreSQL connectors only")
		return
	}

	slug := goscan.Slug(found.name)
	if slug == "" {
		e.warnings.Warn(found.source, "Debezium connector has no usable name")
		return
	}
	serviceID := e.context + "." + slug
	if held := e.pipelines[serviceID]; held != "" && held != found.name {
		e.warnings.Warn(found.source, "Debezium connector "+found.name+" has the same catalog slug as "+held+"; the second declaration is ignored")
		return
	}
	e.pipelines[serviceID] = found.name
	service := e.service(serviceID)
	service.service.Name = found.name
	service.service.Path = strings.Split(found.source, ":")[0]
	service.service.Kind = catalog.ComponentKindDataPipeline
	service.service.Technologies = []string{"Debezium", "Kafka Connect", "PostgreSQL"}
	if opts.Store != "" {
		service.stores[opts.Store] = true
	}

	tables := tablesOf(found, e.warnings)
	prefix := strings.TrimSpace(found.config["topic.prefix"])
	if prefix == "" {
		prefix = strings.TrimSpace(found.config["database.server.name"])
		if prefix != "" {
			e.warnings.Warn(found.source, found.name+" uses legacy database.server.name; topic.prefix is the current Debezium property")
		}
	}
	if prefix == "" || strings.Contains(prefix, "${") {
		e.warnings.Warn(found.source, found.name+" has no literal topic.prefix, so exact Kafka topics cannot be derived")
		return
	}
	if customTopicNaming(found.config["topic.naming.strategy"]) {
		e.warnings.Warn(found.source, found.name+" uses custom topic.naming.strategy "+found.config["topic.naming.strategy"]+"; exact topics are not inferred")
		return
	}

	transforms := transformsOf(found)
	if transforms.topicRouting != "" && transforms.outboxAlias == "" {
		e.warnings.Warn(found.source, found.name+" uses topic-routing SMT "+transforms.topicRouting+"; exact topics after that transform are not inferred")
		return
	}

	if transforms.outboxAlias != "" {
		e.addOutbox(found, opts, serviceID, tables, transforms.outboxAlias)
		return
	}

	shape := "Envelope"
	if transforms.unwrap {
		shape = "Value"
	}
	encoding := encodingOf(found.config["value.converter"])
	for _, table := range tables {
		topic := prefix + "." + table
		message := schemaName(topic, shape, found.config["schema.name.adjustment.mode"])
		if message == "" {
			e.warnings.Warn(found.source, topic+" is an exact topic, but its generated schema name cannot be derived safely; the channel is kept without a message")
		}
		channel := service.channel(topic, catalog.ChannelKindMessage, found.source, "Debezium change-data-capture topic.")
		if message != "" {
			channel.add(catalog.ChannelMessage{Name: message, Title: goscan.Title(strings.TrimSuffix(message, "."+shape)), Doc: "Row changes captured from `" + table + "`.", Direction: catalog.ChannelSend, Encoding: encoding})
		}
		e.addFlow(e.flow(found, opts, serviceID, table, topic, message, false))
	}
}

type transforms struct {
	outboxAlias  string
	unwrap       bool
	topicRouting string
}

func transformsOf(found connector) transforms {
	var out transforms
	for _, alias := range comma(found.config["transforms"]) {
		kind := found.config["transforms."+alias+".type"]
		switch {
		case strings.HasSuffix(kind, ".outbox.EventRouter"):
			out.outboxAlias = alias
		case strings.HasSuffix(kind, ".ExtractNewRecordState"):
			out.unwrap = true
		case strings.Contains(kind, "RegexRouter"), strings.Contains(kind, "ByLogicalTableRouter"), strings.Contains(kind, "ContentBasedRouter"), strings.Contains(kind, "TopicRouting"):
			out.topicRouting = kind
		}
	}
	return out
}

func (e *estate) addOutbox(found connector, opts ConnectorOptions, connectorID string, tables []string, alias string) {
	if len(tables) != 1 {
		e.warnings.Warn(found.source, found.name+" uses Outbox Event Router but table.include.list does not name exactly one literal outbox table")
	}
	if opts.SourceService == "" {
		e.warnings.Warn(found.source, found.name+" uses Outbox Event Router; set connectors."+found.name+".sourceService so the source service remains the logical publisher")
	}
	if len(opts.Routes) == 0 {
		e.warnings.Warn(found.source, found.name+" routes by a value stored in outbox rows; add connectors."+found.name+".routes to enumerate topics and messages")
		for _, table := range tables {
			e.addFlow(e.flow(found, opts, connectorID, table, "", "", true))
		}
		return
	}

	replacement := found.config["transforms."+alias+".route.topic.replacement"]
	if replacement == "" {
		replacement = "outbox.event.${routedByValue}"
	}
	regex := found.config["transforms."+alias+".route.topic.regex"]
	customRegex := regex != "" && regex != "(?<routedByValue>.*)"
	encoding := encodingOf(found.config["value.converter"])
	table := "outbox"
	if len(tables) > 0 {
		table = tables[0]
	}
	for _, route := range opts.Routes {
		topic := strings.TrimSpace(route.Topic)
		if topic == "" && !customRegex {
			topic = strings.ReplaceAll(replacement, "${routedByValue}", route.Value)
		}
		if topic == "" || strings.Contains(topic, "${") {
			e.warnings.Warn(found.source, found.name+" route "+route.Value+" needs an explicit topic because its route expression cannot be resolved")
			continue
		}

		if opts.SourceService != "" {
			publisher := e.service(opts.SourceService)
			channel := publisher.channel(topic, catalog.ChannelKindEvent, found.source, "Delivered through Debezium Outbox Event Router `"+found.name+"`.")
			channel.add(catalog.ChannelMessage{Name: route.Message, Title: goscan.Title(route.Message), Doc: "Routed when `" + route.Value + "` is read from the outbox route column.", Direction: catalog.ChannelSend, Encoding: encoding})
		}
		e.addFlow(e.flow(found, opts, connectorID, table, topic, route.Message, true))
	}
}

func tablesOf(found connector, b *plugin.Builder) []string {
	raw := found.config["table.include.list"]
	if raw == "" {
		b.Warn(found.source, found.name+" has no table.include.list; an unbounded capture set cannot be enumerated into catalog channels")
		return nil
	}
	seen := map[string]bool{}
	var out []string
	for _, value := range comma(raw) {
		if !literalTable.MatchString(value) {
			b.Warn(found.source, found.name+" table.include.list entry "+value+" is a pattern rather than one literal schema.table; it is not expanded")
			continue
		}
		if !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	sort.Strings(out)
	return out
}

func comma(value string) []string {
	var out []string
	for _, part := range strings.Split(value, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}

func customTopicNaming(value string) bool {
	return value != "" && !strings.HasSuffix(value, ".SchemaTopicNamingStrategy") && !strings.HasSuffix(value, ".DefaultTopicNamingStrategy")
}

func encodingOf(converter string) string {
	switch value := strings.ToLower(converter); {
	case strings.Contains(value, "avro"):
		return "avro"
	case strings.Contains(value, "protobuf"):
		return "protobuf"
	case strings.Contains(value, "json"):
		return "json"
	}
	return ""
}

func schemaName(topic, suffix, adjustment string) string {
	parts := strings.Split(topic, ".")
	for i, part := range parts {
		if validSchemaPart(part) {
			continue
		}
		if !strings.EqualFold(adjustment, "avro") {
			return ""
		}
		parts[i] = adjustSchemaPart(part)
	}
	return strings.Join(parts, ".") + "." + suffix
}

func validSchemaPart(value string) bool {
	if value == "" || !((value[0] >= 'A' && value[0] <= 'Z') || (value[0] >= 'a' && value[0] <= 'z') || value[0] == '_') {
		return false
	}
	for i := 1; i < len(value); i++ {
		c := value[i]
		if !((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_') {
			return false
		}
	}
	return true
}

func adjustSchemaPart(value string) string {
	var out strings.Builder
	for i := 0; i < len(value); i++ {
		c := value[i]
		valid := (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_' || i > 0 && c >= '0' && c <= '9'
		if valid {
			out.WriteByte(c)
		} else {
			out.WriteByte('_')
		}
	}
	return out.String()
}

func filepathLabel(root string, paths []string) string {
	if len(paths) == 0 {
		return root
	}
	return strings.Join(paths, ", ")
}
