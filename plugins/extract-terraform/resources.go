package extractterraform

import (
	"sort"
	"strings"

	"github.com/hashicorp/hcl/v2/hclsyntax"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// What the reader knows, resource type by resource type. A type not listed
// here is passed over without a word - IAM roles, security groups and the
// rest are not the estate's shape - except the ones in notYet, which are the
// shape and are named once so that the gap is visible.

const (
	typeQueue        = "aws_sqs_queue"
	typeTopic        = "aws_sns_topic"
	typeSubscription = "aws_sns_topic_subscription"
	typeFunction     = "aws_lambda_function"
	typeMapping      = "aws_lambda_event_source_mapping"
	typeBucket       = "aws_s3_bucket"
	typeNotification = "aws_s3_bucket_notification"
	typeTable        = "aws_dynamodb_table"
	typeDBInstance   = "aws_db_instance"
	typeDBCluster    = "aws_rds_cluster"
)

var notYet = map[string]string{
	"aws_kinesis_stream":                "Kinesis",
	"aws_cloudwatch_event_rule":         "EventBridge",
	"aws_cloudwatch_event_bus":          "EventBridge",
	"aws_cloudwatch_event_target":       "EventBridge",
	"aws_apigatewayv2_api":              "API Gateway",
	"aws_api_gateway_rest_api":          "API Gateway",
	"aws_sfn_state_machine":             "Step Functions",
	"aws_elasticache_cluster":           "ElastiCache",
	"aws_elasticache_replication_group": "ElastiCache",
	"aws_msk_cluster":                   "MSK",
	"aws_mq_broker":                     "Amazon MQ",
	"aws_ecs_service":                   "ECS",
}

// infra is the module as the reader understood it, before it is written as
// a catalog fragment.
type infra struct {
	queues        []*queue
	topics        []*topic
	subscriptions []*subscription
	functions     []*function
	mappings      []*mapping
	notifications []*notification
	stores        []*store
}

type queue struct {
	r          *resource
	name       string
	fifo       bool
	dlq        *resource
	maxReceive string
}

type topic struct {
	r    *resource
	name string
	fifo bool
}

type subscription struct {
	r        *resource
	topic    *resource
	protocol string
	endpoint *resource
}

type function struct {
	r       *resource
	name    string
	runtime string
	// env is what the function is configured with, by variable name: the
	// resources each value reaches. Sorted by name when read out.
	env map[string][]ref
}

type mapping struct {
	r      *resource
	source ref
	fn     *resource
}

type notification struct {
	r       *resource
	bucket  *resource
	targets []notificationTarget
}

type notificationTarget struct {
	target *resource
	events []string
}

type store struct {
	r      *resource
	kind   catalog.StoreKind
	name   string
	tables []catalog.Table
}

// read walks every resource once, in tree order, and warns at the ones it
// could not read whole. A resource whose name it cannot resolve is left out
// rather than named by its label: the label is what Terraform calls it, not
// what the queue is called on the wire.
func read(t *tree, b *plugin.Builder) *infra {
	in := &infra{}
	for _, r := range t.resources {
		s := r.scope
		switch r.Type {
		case typeQueue:
			name, ok := named(s, r, "name", b)
			if !ok {
				continue
			}
			q := &queue{r: r, name: name}
			q.fifo, _ = s.boolOf(attr(r.Body, "fifo_queue"))
			if policy := attr(r.Body, "redrive_policy"); policy != nil {
				for _, found := range s.refsOf(policy, nil) {
					if found.target.Type == typeQueue {
						q.dlq = found.target
						break
					}
				}
				if q.dlq == nil {
					b.Warn(line(r.Source, policy), "redrive_policy of "+r.Address()+" names no aws_sqs_queue declared here, so its dead-letter queue is not read")
				}
				if count := s.objectItem(policy, "maxReceiveCount"); count != nil {
					q.maxReceive, _ = s.stringOf(count, nil)
				} else {
					q.maxReceive = jsonNumber(literalText(policy), "maxReceiveCount")
				}
			}
			in.queues = append(in.queues, q)
		case typeTopic:
			name, ok := named(s, r, "name", b)
			if !ok {
				continue
			}
			tp := &topic{r: r, name: name}
			tp.fifo, _ = s.boolOf(attr(r.Body, "fifo_topic"))
			in.topics = append(in.topics, tp)
		case typeSubscription:
			sub := &subscription{r: r}
			sub.protocol, _ = s.stringOf(attr(r.Body, "protocol"), nil)
			sub.topic = firstRef(s, attr(r.Body, "topic_arn"), typeTopic)
			if sub.topic == nil {
				b.Warn(r.Source, "topic_arn of "+r.Address()+" could not be followed to an aws_sns_topic declared here")
				continue
			}
			switch sub.protocol {
			case "sqs":
				sub.endpoint = firstRef(s, attr(r.Body, "endpoint"), typeQueue)
			case "lambda":
				sub.endpoint = firstRef(s, attr(r.Body, "endpoint"), typeFunction)
			default:
				// Email, HTTP and the rest leave the estate; the topic is
				// still declared, the subscriber is not a component.
				continue
			}
			if sub.endpoint == nil {
				b.Warn(r.Source, "endpoint of "+r.Address()+" could not be followed to a resource declared here")
				continue
			}
			in.subscriptions = append(in.subscriptions, sub)
		case typeFunction:
			name, ok := named(s, r, "function_name", b)
			if !ok {
				continue
			}
			fn := &function{r: r, name: name, env: map[string][]ref{}}
			fn.runtime, _ = s.stringOf(attr(r.Body, "runtime"), nil)
			for _, env := range blocks(r.Body, "environment") {
				variables, ok := attr(env.Body, "variables").(*hclsyntax.ObjectConsExpr)
				if !ok {
					continue
				}
				for _, item := range variables.Items {
					key := keyOf(s, item.KeyExpr)
					if key == "" {
						continue
					}
					if found := s.refsOf(item.ValueExpr, nil); len(found) > 0 {
						fn.env[key] = append(fn.env[key], found...)
					}
				}
			}
			in.functions = append(in.functions, fn)
		case typeMapping:
			m := &mapping{r: r}
			sources := s.refsOf(attr(r.Body, "event_source_arn"), nil)
			if len(sources) == 0 {
				b.Warn(r.Source, "event_source_arn of "+r.Address()+" could not be followed to a queue, a table or a stream declared here")
				continue
			}
			m.source = sources[0]
			m.fn = firstRef(s, attr(r.Body, "function_name"), typeFunction)
			if m.fn == nil {
				m.fn = functionNamed(in, s, attr(r.Body, "function_name"))
			}
			if m.fn == nil {
				b.Warn(r.Source, "function_name of "+r.Address()+" could not be followed to an aws_lambda_function declared here")
				continue
			}
			in.mappings = append(in.mappings, m)
		case typeNotification:
			n := &notification{r: r, bucket: firstRef(s, attr(r.Body, "bucket"), typeBucket)}
			if n.bucket == nil {
				b.Warn(r.Source, "bucket of "+r.Address()+" could not be followed to an aws_s3_bucket declared here")
				continue
			}
			for _, kind := range []struct{ block, arn string }{{"lambda_function", "lambda_function_arn"}, {"queue", "queue_arn"}, {"topic", "topic_arn"}} {
				for _, block := range blocks(r.Body, kind.block) {
					target := firstRef(s, attr(block.Body, kind.arn), "")
					if target == nil {
						b.Warn(r.Source, kind.arn+" of "+r.Address()+" could not be followed to a resource declared here")
						continue
					}
					n.targets = append(n.targets, notificationTarget{target: target, events: stringsOf(s, attr(block.Body, "events"))})
				}
			}
			in.notifications = append(in.notifications, n)
		case typeBucket:
			name, ok := named(s, r, "bucket", b)
			if !ok {
				continue
			}
			st := &store{r: r, kind: catalog.StoreKindS3, name: name}
			in.stores = append(in.stores, st)
		case typeTable:
			name, ok := named(s, r, "name", b)
			if !ok {
				continue
			}
			st := &store{r: r, kind: catalog.StoreKindDynamoDB, name: name}
			st.tables = []catalog.Table{dynamoTable(s, r, name)}
			in.stores = append(in.stores, st)
		case typeDBInstance, typeDBCluster:
			idAttr, nameAttr := "identifier", "db_name"
			if r.Type == typeDBCluster {
				idAttr, nameAttr = "cluster_identifier", "database_name"
			}
			name, _ := s.stringOf(attr(r.Body, idAttr), nil)
			if name == "" {
				name, _ = s.stringOf(attr(r.Body, nameAttr), nil)
			}
			if name == "" {
				b.Warn(r.Source, idAttr+" of "+r.Address()+" could not be resolved to a literal, a variable default, a local or a module argument, so the database goes by its label")
				name = r.Label
			}
			engine, _ := s.stringOf(attr(r.Body, "engine"), nil)
			st := &store{r: r, kind: engineKind(engine), name: name}
			in.stores = append(in.stores, st)
		default:
			if product, known := notYet[r.Type]; known {
				b.Warn(r.Source, r.Address()+" is not read: "+product+" is not part of this reader yet")
			}
		}
	}
	return in
}

// named is the resolved string of the attribute that names a resource on the
// wire. A name_prefix is a name decided at apply time and is reported as
// such; a name nothing resolves is reported as unresolved.
func named(s *scope, r *resource, field string, b *plugin.Builder) (string, bool) {
	expr := attr(r.Body, field)
	if expr == nil {
		if prefix := attr(r.Body, field+"_prefix"); prefix != nil {
			b.Warn(r.Source, r.Address()+" is named with "+field+"_prefix, so its name is decided at apply time and is not read")
			return "", false
		}
		b.Warn(r.Source, r.Address()+" sets no "+field+", so its name is decided at apply time and is not read")
		return "", false
	}
	value, ok := s.stringOf(expr, nil)
	if ok && value != "" {
		return value, true
	}
	// Part of the name is decided at apply time - an account id, a random
	// suffix, a variable the tfvars will give. The shape is still a fact:
	// the literal parts are what a reader searches for, and the hole says
	// what fills the rest. A name that is all hole is no name.
	shape, holes := s.shapeOf(expr, nil)
	if len(holes) > 0 && hasLiteral(shape) {
		b.Warn(line(r.Source, expr), field+" of "+r.Address()+" is `"+shape+"`, with "+strings.Join(holes, ", ")+" decided at apply time")
		return shape, true
	}
	b.Warn(line(r.Source, expr), field+" of "+r.Address()+" could not be resolved to a literal, a variable default, a local or a module argument")
	return "", false
}

// hasLiteral is whether a shape has anything outside its braces worth
// searching for.
func hasLiteral(shape string) bool {
	depth := 0
	for _, r := range shape {
		switch r {
		case '{':
			depth++
		case '}':
			if depth > 0 {
				depth--
			}
		default:
			if depth == 0 && r != '-' && r != '_' && r != '.' && r != '/' && r != ' ' {
				return true
			}
		}
	}
	return false
}

// firstRef is the first resource an expression reaches, of the given type
// or of any when the type is empty.
func firstRef(s *scope, expr hclsyntax.Expression, kind string) *resource {
	for _, found := range s.refsOf(expr, nil) {
		if kind == "" || found.target.Type == kind {
			return found.target
		}
	}
	return nil
}

// functionNamed matches a function_name written as a string against the
// functions read so far - a mapping declared after its function, which is
// the usual order.
func functionNamed(in *infra, s *scope, expr hclsyntax.Expression) *resource {
	value, ok := s.stringOf(expr, nil)
	if !ok {
		return nil
	}
	for _, fn := range in.functions {
		if fn.name == value {
			return fn.r
		}
	}
	return nil
}

func keyOf(s *scope, expr hclsyntax.Expression) string {
	if wrapped, ok := expr.(*hclsyntax.ObjectConsKeyExpr); ok {
		if name, ok := s.stringOf(wrapped.Wrapped, nil); ok {
			return name
		}
		if traversal, ok := wrapped.Wrapped.(*hclsyntax.ScopeTraversalExpr); ok && len(traversal.Traversal) == 1 {
			return traversal.Traversal.RootName()
		}
	}
	return ""
}

func stringsOf(s *scope, expr hclsyntax.Expression) []string {
	tuple, ok := expr.(*hclsyntax.TupleConsExpr)
	if !ok {
		return nil
	}
	var out []string
	for _, item := range tuple.Exprs {
		if value, ok := s.stringOf(item, nil); ok {
			out = append(out, value)
		}
	}
	return out
}

// literalText is the literal parts of a template joined, with the
// interpolations left out: enough to read a number out of a JSON policy
// whose ARNs are interpolated.
func literalText(expr hclsyntax.Expression) string {
	switch value := expr.(type) {
	case *hclsyntax.LiteralValueExpr:
		text, _ := literalString(value.Val)
		return text
	case *hclsyntax.TemplateExpr:
		var out strings.Builder
		for _, part := range value.Parts {
			out.WriteString(literalText(part))
		}
		return out.String()
	case *hclsyntax.TemplateWrapExpr:
		return literalText(value.Wrapped)
	}
	return ""
}

func engineKind(engine string) catalog.StoreKind {
	switch {
	case strings.Contains(engine, "postgres"):
		return catalog.StoreKindPostgres
	case strings.Contains(engine, "mysql"), strings.Contains(engine, "mariadb"), engine == "aurora":
		return catalog.StoreKindMySQL
	}
	return catalog.StoreKindOther
}

// dynamoTable is the one table a DynamoDB resource is: the attributes it
// declares as columns, the hash and range keys as the primary key, and the
// secondary indexes as indexes. Attributes not in any key are not declared
// in DynamoDB at all, so the columns are the keys and nothing more.
func dynamoTable(s *scope, r *resource, name string) catalog.Table {
	hash, _ := s.stringOf(attr(r.Body, "hash_key"), nil)
	rng, _ := s.stringOf(attr(r.Body, "range_key"), nil)
	var columns []catalog.Column
	for _, block := range blocks(r.Body, "attribute") {
		colName, _ := s.stringOf(attr(block.Body, "name"), nil)
		colType, _ := s.stringOf(attr(block.Body, "type"), nil)
		if colName == "" {
			continue
		}
		columns = append(columns, catalog.Column{Name: colName, Type: colType, PK: colName == hash || colName == rng})
	}
	sort.SliceStable(columns, func(i, j int) bool {
		return keyRank(columns[i].Name, hash, rng) < keyRank(columns[j].Name, hash, rng)
	})
	var indexes []catalog.TableIndex
	for _, kind := range []string{"global_secondary_index", "local_secondary_index"} {
		for _, block := range blocks(r.Body, kind) {
			idxName, _ := s.stringOf(attr(block.Body, "name"), nil)
			var keys []string
			if h, ok := s.stringOf(attr(block.Body, "hash_key"), nil); ok {
				keys = append(keys, h)
			} else if kind == "local_secondary_index" {
				keys = append(keys, hash)
			}
			if rk, ok := s.stringOf(attr(block.Body, "range_key"), nil); ok {
				keys = append(keys, rk)
			}
			if idxName == "" {
				continue
			}
			indexes = append(indexes, catalog.TableIndex{Name: idxName, Columns: keys})
		}
	}
	if columns == nil {
		columns = []catalog.Column{}
	}
	return catalog.Table{
		Evidence: []catalog.RelationEvidence{{Kind: "contract", Rule: "terraform-aws-dynamodb-table", Source: r.Source, Symbol: r.Address()}},
		Name:     name,
		Columns:  columns,
		Indexes:  indexes,
	}
}

func keyRank(name, hash, rng string) int {
	switch name {
	case hash:
		return 0
	case rng:
		return 1
	}
	return 2
}
