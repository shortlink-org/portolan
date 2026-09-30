package extractgokafka

import (
	"go/ast"
	"go/token"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/internal/goscan"
)

// A site is found one of two ways. A struct of a client that carries a topic
// - sarama.ProducerMessage, kafka.Writer, kafka.ReaderConfig, kgo.Record,
// the TopicPartition of a confluent kafka.Message - is the declaration
// wherever it is built: nothing else is built from those types, and the call
// it is later handed to may be a long way off. A call is known by the type it
// is made on or the package it is from, never by its name: a service's own
// port has a Consume too, and it is not this one.

// literalSpec is one client struct the reader knows: which way messages go,
// and the fields that name the topic, a list of topics and the consumer group.
type literalSpec struct {
	direction catalog.ChannelDirection
	pkg       string
	role      string
	topic     string
	topics    string
	group     string
	// nested is confluent's shape: the topic is a *string inside the
	// TopicPartition field, kafka.TopicPartition{Topic: &topic}.
	nested bool
}

// callSpec is one client call the reader knows: which way, and where in the
// arguments the topics are - one, a list, or the variadic tail.
type callSpec struct {
	direction catalog.ChannelDirection
	pkg       string
	topic     int
	topics    int
	variadic  int
	partition bool
	// group is whether the consumer group is read off the constructor the
	// receiver came from.
	group bool
}

const (
	roleMessage = "message"
	roleWriter  = "writer"
	roleReader  = "reader"
	roleCall    = "call"
)

func one(direction catalog.ChannelDirection, pkg string, topic int) callSpec {
	return callSpec{direction: direction, pkg: pkg, topic: topic, topics: -1, variadic: -1}
}

func list(direction catalog.ChannelDirection, pkg string, topics int) callSpec {
	return callSpec{direction: direction, pkg: pkg, topic: -1, topics: topics, variadic: -1}
}

func tail(direction catalog.ChannelDirection, pkg string, from int) callSpec {
	return callSpec{direction: direction, pkg: pkg, topic: -1, topics: -1, variadic: from}
}

// literals is the client structs read, by type key.
var literals = func() map[string]literalSpec {
	out := map[string]literalSpec{
		kafkaGoPkg + ".Writer":       {direction: catalog.ChannelSend, pkg: kafkaGoPkg, role: roleWriter, topic: "Topic"},
		kafkaGoPkg + ".WriterConfig": {direction: catalog.ChannelSend, pkg: kafkaGoPkg, role: roleWriter, topic: "Topic"},
		kafkaGoPkg + ".Message":      {direction: catalog.ChannelSend, pkg: kafkaGoPkg, role: roleMessage, topic: "Topic"},
		kafkaGoPkg + ".ReaderConfig": {direction: catalog.ChannelReceive, pkg: kafkaGoPkg, role: roleReader, topic: "Topic", topics: "GroupTopics", group: "GroupID"},
		kgoPkg + ".Record":           {direction: catalog.ChannelSend, pkg: kgoPkg, role: roleMessage, topic: "Topic"},
	}
	for _, pkg := range saramaPkgs {
		out[pkg+".ProducerMessage"] = literalSpec{direction: catalog.ChannelSend, pkg: pkg, role: roleMessage, topic: "Topic"}
	}
	for _, pkg := range confluentPkgs {
		out[pkg+".Message"] = literalSpec{direction: catalog.ChannelSend, pkg: pkg, role: roleMessage, nested: true}
	}
	return out
}()

// calls is the client calls read, by "<type key>.<Method>" or
// "<import path>.<Func>".
var calls = func() map[string]callSpec {
	out := map[string]callSpec{
		kgoPkg + ".ConsumeTopics":           tail(catalog.ChannelReceive, kgoPkg, 0),
		kgoPkg + ".DefaultProduceTopic":     one(catalog.ChannelSend, kgoPkg, 0),
		kgoPkg + ".Client.AddConsumeTopics": tail(catalog.ChannelReceive, kgoPkg, 0),
	}
	for _, pkg := range saramaPkgs {
		consume := list(catalog.ChannelReceive, pkg, 1)
		consume.group = true
		out[pkg+".ConsumerGroup.Consume"] = consume
		partition := one(catalog.ChannelReceive, pkg, 0)
		partition.partition = true
		out[pkg+".Consumer.ConsumePartition"] = partition
	}
	for _, pkg := range confluentPkgs {
		subscribe := one(catalog.ChannelReceive, pkg, 0)
		subscribe.group = true
		out[pkg+".Consumer.Subscribe"] = subscribe
		many := list(catalog.ChannelReceive, pkg, 0)
		many.group = true
		out[pkg+".Consumer.SubscribeTopics"] = many
	}
	return out
}()

// topicRef is one expression that names a topic, with the function it is
// written in and how many callers up that is from the site.
type topicRef struct {
	expr  ast.Expr
	fn    *goscan.Function
	depth int
}

// site is one declaration of a topic as found: where, which way, through
// which client, and the expressions that name the topics and the group -
// still expressions, since what they are worth may be decided by a caller.
type site struct {
	fn        *goscan.Function
	what      string
	pkg       string
	role      string
	direction catalog.ChannelDirection
	topics    []topicRef
	// unlisted is a list of topics this reader could not follow to its
	// elements.
	unlisted bool
	// hidden is a confluent message whose TopicPartition is built where
	// this reader does not look.
	hidden    bool
	group     ast.Expr
	groupFn   *goscan.Function
	partition bool
	at        goscan.Source
}

// sites is every declaration of a topic in the tree, in source order.
func (s *scanner) sites() []site {
	var out []site
	for _, fn := range s.SortedFunctions() {
		// implied is the type of an element whose literal leaves it out,
		// []*sarama.ProducerMessage{{Topic: ...}}; groups is the consumer group
		// a kgo.ConsumeTopics option was passed beside.
		implied := map[*ast.CompositeLit]string{}
		groups := map[*ast.CallExpr]ast.Expr{}
		ast.Inspect(fn.Decl.Body, func(node ast.Node) bool {
			switch value := node.(type) {
			case *ast.CompositeLit:
				key := s.TypeKey(value.Type, fn.File)
				if key == "" {
					key = implied[value]
				}
				imply(value, key, implied)
				s.siblingGroups(value.Elts, fn, groups)
				if spec, known := literals[key]; known {
					if found, ok := s.literalSite(fn, value, key, spec); ok {
						out = append(out, found)
					}
				}
			case *ast.CallExpr:
				s.siblingGroups(value.Args, fn, groups)
				if found, ok := s.callSite(fn, value, groups); ok {
					out = append(out, found)
				}
			}
			return true
		})
	}
	return out
}

// qualified is a key as the code spells it: the package's name in front of
// the type or function, sarama.ProducerMessage, kgo.ConsumeTopics.
func qualified(key, pkg string) string {
	return goscan.PackageName(pkg) + "." + strings.TrimPrefix(key, pkg+".")
}

// imply hands the element type of a slice literal to the elements that
// leave it out.
func imply(lit *ast.CompositeLit, key string, implied map[*ast.CompositeLit]string) {
	elem, isSlice := strings.CutPrefix(key, "[]")
	if !isSlice {
		return
	}
	for _, raw := range lit.Elts {
		if inner, ok := goscan.Unwrap(raw).(*ast.CompositeLit); ok && inner.Type == nil {
			implied[inner] = elem
		}
	}
}

func (s *scanner) literalSite(fn *goscan.Function, lit *ast.CompositeLit, key string, spec literalSpec) (site, bool) {
	found := site{fn: fn, what: qualified(key, spec.pkg), pkg: spec.pkg, role: spec.role, direction: spec.direction, at: s.At(lit.Pos())}
	holder := lit
	topicField := spec.topic
	if spec.nested {
		partition := field(lit, "TopicPartition")
		if partition == nil {
			return site{}, false
		}
		holder = s.compositeOf(partition, fn)
		topicField = "Topic"
		if holder == nil {
			// The partition is built somewhere this reader does not look;
			// say so at the message rather than drop it.
			found.hidden = true
			return found, true
		}
	}
	topic := field(holder, topicField)
	many := field(holder, spec.topics)
	if topic == nil && many == nil {
		// A writer with no topic of its own sends each message where the
		// message says; a record with none goes to the client's default.
		return site{}, false
	}
	if topic != nil {
		found.topics = append(found.topics, topicRef{expr: topic, fn: fn})
	}
	if many != nil {
		refs, ok := s.elements(many, fn, 0, map[string]bool{})
		found.topics = append(found.topics, refs...)
		found.unlisted = !ok
	}
	if group := field(holder, spec.group); group != nil {
		found.group, found.groupFn = group, fn
	}
	return found, true
}

func (s *scanner) callSite(fn *goscan.Function, call *ast.CallExpr, groups map[*ast.CallExpr]ast.Expr) (site, bool) {
	key := s.ExternalKey(call, fn)
	spec, known := calls[key]
	if !known {
		return site{}, false
	}
	found := site{fn: fn, what: qualified(key, spec.pkg), pkg: spec.pkg, role: roleCall, direction: spec.direction, partition: spec.partition, at: s.At(call.Pos())}
	args := call.Args
	switch {
	case spec.topic >= 0 && spec.topic < len(args):
		found.topics = []topicRef{{expr: args[spec.topic], fn: fn}}
	case spec.topics >= 0 && spec.topics < len(args):
		refs, ok := s.elements(args[spec.topics], fn, 0, map[string]bool{})
		found.topics, found.unlisted = refs, !ok
	case spec.variadic >= 0 && spec.variadic < len(args):
		if call.Ellipsis.IsValid() && len(args) == spec.variadic+1 {
			refs, ok := s.elements(args[spec.variadic], fn, 0, map[string]bool{})
			found.topics, found.unlisted = refs, !ok
		} else {
			for _, arg := range args[spec.variadic:] {
				found.topics = append(found.topics, topicRef{expr: arg, fn: fn})
			}
		}
	}
	if group := groups[call]; group != nil {
		found.group, found.groupFn = group, fn
	}
	if spec.group {
		if sel, ok := call.Fun.(*ast.SelectorExpr); ok {
			if group := s.receiverGroup(sel.X, fn); group != nil {
				found.group, found.groupFn = group, fn
			}
		}
	}
	return found, true
}

// siblingGroups finds a kgo.ConsumerGroup option among the arguments of one
// call or the elements of one literal, and gives it to every
// kgo.ConsumeTopics beside it: kgo.NewClient(kgo.ConsumeTopics(t),
// kgo.ConsumerGroup(g)).
func (s *scanner) siblingGroups(exprs []ast.Expr, fn *goscan.Function, groups map[*ast.CallExpr]ast.Expr) {
	var group ast.Expr
	for _, expr := range exprs {
		if call, ok := expr.(*ast.CallExpr); ok && len(call.Args) == 1 && s.ExternalKey(call, fn) == kgoPkg+".ConsumerGroup" {
			group = call.Args[0]
		}
	}
	if group == nil {
		return
	}
	for _, expr := range exprs {
		if call, ok := expr.(*ast.CallExpr); ok && s.ExternalKey(call, fn) == kgoPkg+".ConsumeTopics" {
			groups[call] = group
		}
	}
}

// receiverGroup is the consumer group a consumer was built with, when it
// was built in this function: sarama.NewConsumerGroup(addrs, group, cfg),
// sarama.NewConsumerGroupFromClient(group, client), or confluent's
// kafka.NewConsumer(&kafka.ConfigMap{"group.id": group}).
func (s *scanner) receiverGroup(expr ast.Expr, fn *goscan.Function) ast.Expr {
	ident, ok := goscan.Unwrap(expr).(*ast.Ident)
	if !ok {
		return nil
	}
	given, ok := s.AssignedTo(fn, ident.Name)
	if !ok || given.Index != 0 {
		return nil
	}
	call, ok := goscan.Unwrap(given.Expr).(*ast.CallExpr)
	if !ok {
		return nil
	}
	arg := func(index int) ast.Expr {
		if index < len(call.Args) {
			return call.Args[index]
		}
		return nil
	}
	key := s.ExternalKey(call, fn)
	for _, pkg := range saramaPkgs {
		switch key {
		case pkg + ".NewConsumerGroup":
			return arg(1)
		case pkg + ".NewConsumerGroupFromClient":
			return arg(0)
		}
	}
	for _, pkg := range confluentPkgs {
		if key == pkg+".NewConsumer" {
			return configValue(s.compositeOf(arg(0), fn), "group.id")
		}
	}
	return nil
}

// elements is every expression a list of topics holds: a slice literal, a
// local given one, or a parameter - each caller's list, or the variadic tail
// each caller passes. False when the list goes somewhere this reader does not
// follow.
func (s *scanner) elements(expr ast.Expr, fn *goscan.Function, depth int, visiting map[string]bool) ([]topicRef, bool) {
	switch value := goscan.Unwrap(expr).(type) {
	case *ast.CompositeLit:
		refs := make([]topicRef, 0, len(value.Elts))
		for _, elt := range value.Elts {
			refs = append(refs, topicRef{expr: elt, fn: fn, depth: depth})
		}
		return refs, true
	case *ast.Ident:
		key := fn.Key + ":list:" + value.Name
		if visiting[key] {
			return nil, false
		}
		visiting[key] = true
		defer delete(visiting, key)
		if index := goscan.ParamIndex(fn, value.Name); index >= 0 {
			return s.listFromCallers(fn, index, depth, visiting)
		}
		if given, ok := s.AssignedTo(fn, value.Name); ok && given.Index == 0 {
			return s.elements(given.Expr, fn, depth, visiting)
		}
	}
	return nil, false
}

// listFromCallers is what each caller passes for a list parameter: its list,
// or, when the parameter is variadic, the arguments from there on.
func (s *scanner) listFromCallers(fn *goscan.Function, index, depth int, visiting map[string]bool) ([]topicRef, bool) {
	if depth >= s.Hops {
		return nil, false
	}
	var refs []topicRef
	variadic := index == len(fn.Params)-1 && isVariadic(fn)
	sites := s.CallSites(fn)
	if len(sites) == 0 {
		return nil, false
	}
	for _, callSite := range sites {
		args := callSite.Call.Args
		if variadic && !callSite.Call.Ellipsis.IsValid() {
			for _, arg := range args[min(index, len(args)):] {
				refs = append(refs, topicRef{expr: arg, fn: callSite.Fn, depth: depth + 1})
			}
			continue
		}
		if index >= len(args) {
			continue
		}
		found, ok := s.elements(args[index], callSite.Fn, depth+1, visiting)
		if !ok {
			return nil, false
		}
		refs = append(refs, found...)
	}
	return refs, true
}

func isVariadic(fn *goscan.Function) bool {
	params := fn.Decl.Type.Params
	if params == nil || len(params.List) == 0 {
		return false
	}
	_, ok := params.List[len(params.List)-1].Type.(*ast.Ellipsis)
	return ok
}

// values is every string a topic can be worth, from where it was written.
// A field of the receiver is read at the constructor that filled it.
func (s *scanner) values(ref topicRef) []goscan.Resolved {
	visiting := map[string]bool{}
	if found := s.Resolve(ref.expr, ref.fn, ref.depth, visiting); len(found) > 0 {
		return found
	}
	if sel, ok := goscan.Unwrap(ref.expr).(*ast.SelectorExpr); ok {
		return s.fromConstructors(sel, ref.fn, visiting)
	}
	return nil
}

// fromConstructors is what a field of a tree struct was given where the
// struct was built: a composite literal or a field assignment in a function
// that returns the type. That is the producer's shape - the topic comes in
// at New and is read at Publish - and the constructor's parameter is
// followed to its callers like any other.
func (s *scanner) fromConstructors(sel *ast.SelectorExpr, fn *goscan.Function, visiting map[string]bool) []goscan.Resolved {
	key := s.TypeOf(sel.X, fn)
	if s.Structs[key] == nil {
		return nil
	}
	guard := "field:" + key + "." + sel.Sel.Name
	if visiting[guard] {
		return nil
	}
	visiting[guard] = true
	defer delete(visiting, guard)

	var out []goscan.Resolved
	for _, ctor := range s.SortedFunctions() {
		if !returns(ctor, key) {
			continue
		}
		ast.Inspect(ctor.Decl.Body, func(node ast.Node) bool {
			var given ast.Expr
			switch value := node.(type) {
			case *ast.CompositeLit:
				if s.TypeKey(value.Type, ctor.File) == key {
					given = field(value, sel.Sel.Name)
				}
			case *ast.AssignStmt:
				for i, lhs := range value.Lhs {
					target, ok := lhs.(*ast.SelectorExpr)
					if ok && target.Sel.Name == sel.Sel.Name && s.TypeOf(target.X, ctor) == key && i < len(value.Rhs) && len(value.Lhs) == len(value.Rhs) {
						given = value.Rhs[i]
					}
				}
			}
			if given != nil {
				out = append(out, s.Resolve(given, ctor, 0, visiting)...)
			}
			return true
		})
	}
	return out
}

// returns is whether a function hands the type back, bare or by pointer.
func returns(fn *goscan.Function, key string) bool {
	for _, result := range fn.Results {
		if result == key {
			return true
		}
	}
	return false
}

// compositeOf is the literal an expression is, written inline or built into
// a local first.
func (s *scanner) compositeOf(expr ast.Expr, fn *goscan.Function) *ast.CompositeLit {
	if expr == nil {
		return nil
	}
	switch value := goscan.Unwrap(expr).(type) {
	case *ast.CompositeLit:
		return value
	case *ast.Ident:
		if given, ok := s.AssignedTo(fn, value.Name); ok && given.Index == 0 {
			if lit, isLit := goscan.Unwrap(given.Expr).(*ast.CompositeLit); isLit {
				return lit
			}
		}
	}
	return nil
}

// configValue is what a confluent ConfigMap literal gives one key.
func configValue(lit *ast.CompositeLit, key string) ast.Expr {
	if lit == nil {
		return nil
	}
	for _, raw := range lit.Elts {
		pair, ok := raw.(*ast.KeyValueExpr)
		if !ok {
			continue
		}
		if name, ok := pair.Key.(*ast.BasicLit); ok && name.Kind == token.STRING {
			if text, err := strconv.Unquote(name.Value); err == nil && text == key {
				return pair.Value
			}
		}
	}
	return nil
}

// field is the value a composite literal gives a named field, or nil.
func field(lit *ast.CompositeLit, name string) ast.Expr {
	if lit == nil || name == "" {
		return nil
	}
	for _, raw := range lit.Elts {
		pair, ok := raw.(*ast.KeyValueExpr)
		if !ok {
			continue
		}
		if key, ok := pair.Key.(*ast.Ident); ok && key.Name == name {
			return pair.Value
		}
	}
	return nil
}
