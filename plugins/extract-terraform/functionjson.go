package extractterraform

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"

	"github.com/shortlink-org/portolan/plugin"
)

// An Azure Function says what runs it in its function.json, which Terraform
// carries as config_json: a list of bindings, each a type, a direction and the
// names it binds to. A Service Bus trigger names the queue, or the topic and
// subscription, it is run by; a Service Bus output names where it sends. Any
// other field of a binding - the connection setting above all - is not read.

// bindingValue is one field of a binding: an HCL expression under
// jsonencode(), or text from a JSON string.
type bindingValue struct {
	expr hclsyntax.Expression
	text string
}

// appSetting is a binding value that is only an app setting's name.
var appSetting = regexp.MustCompile(`^%([^%]+)%$`)

// settingHole spells an app setting inside a longer value as a hole.
var settingHole = regexp.MustCompile(`%([^%]+)%`)

func readBusBindings(in *infra, bus *busFound, b *plugin.Builder) {
	declared := map[string]bool{}
	for _, e := range bus.entities {
		declared[e.name] = true
	}
	for _, fn := range in.functions {
		if fn.r.Type != typeAzureFunction {
			continue
		}
		for _, values := range functionBindings(fn.r, b) {
			kind := strings.ToLower(bindingText(fn.r.scope, values["type"]))
			if kind != "servicebustrigger" && kind != "servicebus" {
				continue
			}
			binding := &busBinding{fn: fn.r, trigger: kind == "servicebustrigger"}
			field := "queueName"
			if _, ok := values["topicName"]; ok {
				field = "topicName"
				binding.topic = true
			}
			value, ok := values[field]
			if !ok {
				b.Warn(fn.r.Source, "a Service Bus binding of "+fn.r.Address()+" names no queue or topic, so it is not read")
				continue
			}
			target, ok := bindingTarget(fn.r, value, field, declared, b)
			if !ok {
				continue
			}
			binding.target = target
			if binding.topic && binding.trigger {
				// A subscription named through an app setting is left unsaid;
				// the topic is what the function reads either way.
				if name := bindingText(fn.r.scope, values["subscriptionName"]); !strings.Contains(name, "%") {
					binding.subscription = name
				}
			}
			bus.bindings = append(bus.bindings, binding)
		}
	}
}

// functionBindings is the bindings of config_json, written with jsonencode()
// or as a JSON string.
func functionBindings(r *resource, b *plugin.Builder) []map[string]bindingValue {
	expr := r.attr("config_json")
	if expr == nil {
		return nil
	}
	s := r.scope
	var out []map[string]bindingValue
	if list, ok := s.objectItem(expr, "bindings").(*hclsyntax.TupleConsExpr); ok {
		for _, item := range list.Exprs {
			obj, ok := item.(*hclsyntax.ObjectConsExpr)
			if !ok {
				continue
			}
			values := map[string]bindingValue{}
			for _, entry := range obj.Items {
				key := hcl.ExprAsKeyword(entry.KeyExpr)
				if key == "" {
					key = keyOf(s, entry.KeyExpr)
				}
				if key != "" {
					values[key] = bindingValue{expr: entry.ValueExpr}
				}
			}
			out = append(out, values)
		}
		return out
	}
	text, ok := s.stringOf(expr, nil)
	if !ok {
		if strings.Contains(strings.ToLower(literalText(expr)), "servicebus") {
			b.Warn(line(r.Source, expr), "config_json of "+r.Address()+" could not be resolved to text, so its Service Bus bindings are not read")
		}
		return nil
	}
	var doc struct {
		Bindings []map[string]any `json:"bindings"`
	}
	if err := json.Unmarshal([]byte(text), &doc); err != nil {
		b.Warn(line(r.Source, expr), "config_json of "+r.Address()+" is not JSON, so its bindings are not read")
		return nil
	}
	for _, binding := range doc.Bindings {
		values := map[string]bindingValue{}
		for key, value := range binding {
			if text, ok := value.(string); ok {
				values[key] = bindingValue{text: text}
			}
		}
		out = append(out, values)
	}
	return out
}

func bindingText(s *scope, value bindingValue) string {
	if value.expr == nil {
		return value.text
	}
	text, _ := s.stringOf(value.expr, nil)
	return text
}

// bindingTarget is the entity a binding field names. A field that is only an
// app setting is followed to the function app's app_settings, and taken when
// the setting reaches a queue or topic declared here - a setting's value is
// never written otherwise.
func bindingTarget(fn *resource, value bindingValue, field string, declared map[string]bool, b *plugin.Builder) (busTarget, bool) {
	s := fn.scope
	text := value.text
	if value.expr != nil {
		for _, found := range s.refsOf(value.expr, nil) {
			if isBusEntity(found.target) {
				return busTarget{r: found.target}, true
			}
		}
		resolved, ok := s.stringOf(value.expr, nil)
		if !ok {
			shape, holes := s.shapeOf(value.expr, nil)
			if len(holes) > 0 && hasLiteral(shape) {
				b.Warn(line(fn.Source, value.expr), field+" of "+fn.Address()+" is `"+shape+"`, with "+strings.Join(holes, ", ")+" decided at apply time")
				return busTarget{name: shape}, true
			}
			b.Warn(line(fn.Source, value.expr), field+" of "+fn.Address()+" could not be resolved to a literal, a variable default, a local or a module argument")
			return busTarget{}, false
		}
		text = resolved
	}
	if match := appSetting.FindStringSubmatch(text); match != nil {
		if app := firstRef(s, fn.attr("function_app_id"), ""); app != nil {
			if setting := app.scope.objectItem(app.attr("app_settings"), match[1]); setting != nil {
				for _, found := range app.scope.refsOf(setting, nil) {
					if isBusEntity(found.target) {
						return busTarget{r: found.target}, true
					}
				}
				if name, ok := app.scope.stringOf(setting, nil); ok && declared[name] {
					return busTarget{name: name}, true
				}
			}
		}
		b.Warn(fn.Source, field+" of "+fn.Address()+" is app setting `"+match[1]+"`, which does not name a Service Bus queue or topic declared here, so the binding is not read")
		return busTarget{}, false
	}
	if strings.Contains(text, "%") {
		shape := settingHole.ReplaceAllString(text, "{$1}")
		if !hasLiteral(shape) {
			b.Warn(fn.Source, field+" of "+fn.Address()+" is made of app settings only, so the binding is not read")
			return busTarget{}, false
		}
		var holes []string
		for _, m := range settingHole.FindAllStringSubmatch(text, -1) {
			holes = append(holes, m[1])
		}
		b.Warn(fn.Source, field+" of "+fn.Address()+" is `"+shape+"`, with app settings "+strings.Join(holes, ", ")+" decided at deployment")
		return busTarget{name: shape}, true
	}
	if text == "" {
		return busTarget{}, false
	}
	return busTarget{name: text}, true
}
