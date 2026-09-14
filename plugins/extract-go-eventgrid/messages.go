package extractgoeventgrid

import (
	"go/ast"
	"sort"

	"github.com/shortlink-org/portolan/internal/goscan"
)

type domainEvent struct {
	topic     string
	eventType string
}

func (s *scanner) domainEvents(expr ast.Expr, fn *goscan.Function, method string) []domainEvent {
	if method != "PublishEvents" && method != "PublishCloudEvents" {
		return nil
	}
	var out []domainEvent
	s.collectDomainEvents(expr, fn, method, 0, map[string]bool{}, &out)
	return out
}

func (s *scanner) collectDomainEvents(expr ast.Expr, fn *goscan.Function, method string, depth int, visiting map[string]bool, out *[]domainEvent) {
	if expr == nil || fn == nil {
		return
	}
	switch value := goscan.Unwrap(expr).(type) {
	case *ast.Ident:
		guard := fn.Key + ":domain-event:" + value.Name
		if visiting[guard] {
			return
		}
		visiting[guard] = true
		defer delete(visiting, guard)
		if given, ok := s.AssignedTo(fn, value.Name); ok && given.Index == 0 {
			s.collectDomainEvents(given.Expr, fn, method, depth, visiting, out)
			return
		}
		if index := goscan.ParamIndex(fn, value.Name); index >= 0 && depth < hops {
			for _, arg := range s.ArgsFromCallers(fn, index) {
				s.collectDomainEvents(arg.Expr, arg.Fn, method, depth+1, visiting, out)
			}
		}
	case *ast.CompositeLit:
		topicField, typeField := "Topic", "EventType"
		if method == "PublishCloudEvents" {
			topicField, typeField = "Source", "Type"
		}
		topic := field(value, topicField)
		if topic != nil {
			appendDomainEvents(out, s.stringValues(topic, fn), s.stringValues(field(value, typeField), fn))
			return
		}
		for _, element := range value.Elts {
			if pair, ok := element.(*ast.KeyValueExpr); ok {
				s.collectDomainEvents(pair.Value, fn, method, depth, visiting, out)
			} else if nested, ok := element.(ast.Expr); ok {
				s.collectDomainEvents(nested, fn, method, depth, visiting, out)
			}
		}
	case *ast.CallExpr:
		if method == "PublishCloudEvents" && s.ExternalKey(value, fn) == messagingPkg+".NewCloudEvent" && len(value.Args) > 1 {
			appendDomainEvents(out, s.stringValues(value.Args[0], fn), s.stringValues(value.Args[1], fn))
			return
		}
		for _, target := range s.Callees(value, fn) {
			if returned := goscan.SingleReturn(target); returned != nil {
				s.collectDomainEvents(returned, target, method, depth, visiting, out)
			}
		}
	}
}

func appendDomainEvents(out *[]domainEvent, topics, eventTypes []goscan.Resolved) {
	for _, topic := range topics {
		if topic.Value == "" {
			continue
		}
		if len(eventTypes) == 0 {
			*out = append(*out, domainEvent{topic: topic.Value})
			continue
		}
		for _, eventType := range eventTypes {
			*out = append(*out, domainEvent{topic: topic.Value, eventType: eventType.Value})
		}
	}
}

func (s *scanner) eventTypes(expr ast.Expr, fn *goscan.Function) []string {
	found := map[string]bool{}
	s.collectEventTypes(expr, fn, 0, map[string]bool{}, found)
	out := make([]string, 0, len(found))
	for name := range found {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

func (s *scanner) collectEventTypes(expr ast.Expr, fn *goscan.Function, depth int, visiting, found map[string]bool) {
	if expr == nil || fn == nil {
		return
	}
	switch value := goscan.Unwrap(expr).(type) {
	case *ast.Ident:
		guard := fn.Key + ":event:" + value.Name
		if visiting[guard] {
			return
		}
		visiting[guard] = true
		defer delete(visiting, guard)
		if given, ok := s.AssignedTo(fn, value.Name); ok && given.Index == 0 {
			s.collectEventTypes(given.Expr, fn, depth, visiting, found)
			return
		}
		if index := goscan.ParamIndex(fn, value.Name); index >= 0 && depth < hops {
			for _, arg := range s.ArgsFromCallers(fn, index) {
				s.collectEventTypes(arg.Expr, arg.Fn, depth+1, visiting, found)
			}
		}
	case *ast.CompositeLit:
		eventType := field(value, "EventType")
		// Elements of []azeventgrid.Event may elide their type (`{{...}}`),
		// so the EventType field is also sufficient inside a known publisher
		// argument.
		if s.TypeKey(value.Type, fn.File) == eventGridPkg+".Event" || eventType != nil {
			for _, resolved := range s.stringValues(eventType, fn) {
				if resolved.Value != "" {
					found[resolved.Value] = true
				}
			}
		}
		for _, element := range value.Elts {
			if pair, ok := element.(*ast.KeyValueExpr); ok {
				s.collectEventTypes(pair.Value, fn, depth, visiting, found)
			} else if nested, ok := element.(ast.Expr); ok {
				s.collectEventTypes(nested, fn, depth, visiting, found)
			}
		}
	case *ast.CallExpr:
		if s.ExternalKey(value, fn) == messagingPkg+".NewCloudEvent" && len(value.Args) > 1 {
			for _, resolved := range s.stringValues(value.Args[1], fn) {
				if resolved.Value != "" {
					found[resolved.Value] = true
				}
			}
			return
		}
		for _, target := range s.Callees(value, fn) {
			if returned := goscan.SingleReturn(target); returned != nil {
				s.collectEventTypes(returned, target, depth, visiting, found)
			}
		}
	}
}
