package extractproto

// What a field's options say about its value, in the catalog's words.
//
// Protovalidate writes a rule as `(buf.validate.field).string.min_len = 1`:
// the extension, the type the rule is for, the rule. The catalog's field
// model has one vocabulary for every source, and in it the type is already
// the field's type, so the rule is `min_len`. A rule on what a list holds
// keeps `items.` in front, on a map's keys or values `keys.` or `values.`,
// because there the rule is about something other than the field itself.
//
// An option that is not Protovalidate and not protobuf's own - `(acme.pii)
// = true` - is a custom extension the catalog has no word for. It is kept
// under the name the source gave it, so a reader sees that the field is
// annotated rather than finding out in the raw file.

import (
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

const validateField = "(buf.validate.field)"

// typeWords are the segments of a Protovalidate path that name the type the
// rule applies to. They carry nothing the field's own type does not.
var typeWords = map[string]bool{
	"float": true, "double": true,
	"int32": true, "int64": true, "uint32": true, "uint64": true,
	"sint32": true, "sint64": true, "fixed32": true, "fixed64": true,
	"sfixed32": true, "sfixed64": true,
	"bool": true, "string": true, "bytes": true, "enum": true,
	"repeated": true, "map": true, "any": true, "duration": true, "timestamp": true,
}

// formatWords are the well-known string shapes Protovalidate spells as a
// bool each: `string.email = true`. The catalog says `format: email`.
var formatWords = map[string]bool{
	"email": true, "hostname": true, "ip": true, "ipv4": true, "ipv6": true,
	"uri": true, "uri_ref": true, "address": true, "uuid": true, "tuuid": true,
	"ip_with_prefixlen": true, "ipv4_with_prefixlen": true, "ipv6_with_prefixlen": true,
	"ip_prefix": true, "ipv4_prefix": true, "ipv6_prefix": true, "host_and_port": true,
}

// flagWords are rules that are true or absent; `true` is not a bound worth
// printing beside them, and `false` is no rule at all.
var flagWords = map[string]bool{
	"unique": true, "defined_only": true, "lt_now": true, "gt_now": true,
}

// aboutChecking are the Protovalidate keys that say when or how a rule is
// checked, or illustrate it, and constrain nothing.
var aboutChecking = map[string]bool{
	"ignore": true, "example": true, "strict": true,
}

// fieldOf is the catalog's view of a field: the type as resolved by the
// caller, and what the options say about the value.
func fieldOf(f *Field, typ string) catalog.Field {
	required, rules := fieldRules(f.Options)

	return catalog.Field{
		Name: f.Name, Type: typ, Doc: f.Doc, Number: f.Number,
		Required: required, Rules: rules,
	}
}

// fieldRules reads the options into a required flag and rules, in the order
// the source wrote them. A rule named twice - `in` given one value at a time -
// is one rule with the values comma-joined.
func fieldRules(options []Option) (bool, []catalog.FieldRule) {
	required := false
	var rules []catalog.FieldRule
	at := map[string]int{}

	for _, o := range options {
		name, value, ok := ruleOf(o)
		if !ok {
			continue
		}
		if name == "required" {
			required = value == "true"

			continue
		}
		if i, seen := at[name]; seen {
			if value != "" {
				rules[i].Value = joinValues(rules[i].Value, value)
			}

			continue
		}
		at[name] = len(rules)
		rules = append(rules, catalog.FieldRule{Name: name, Value: value})
	}

	return required, rules
}

func joinValues(have, more string) string {
	if have == "" {
		return more
	}

	return have + ", " + more
}

// ruleOf is one option as a rule: the name in the catalog's vocabulary and
// the value to print, or not ok when the option is protobuf's own, is about
// checking rather than the value, or is `false` for a flag.
func ruleOf(o Option) (string, string, bool) {
	if !strings.HasPrefix(o.Name, "(") {
		return "", "", false // deprecated, json_name, packed: the wire's, not a rule
	}
	if !strings.HasPrefix(o.Name, validateField+".") {
		return o.Name, o.Value, true // a custom extension, as written
	}

	var path []string
	for _, seg := range strings.Split(strings.TrimPrefix(o.Name, validateField+"."), ".") {
		if !typeWords[seg] {
			path = append(path, seg)
		}
	}
	if len(path) == 0 {
		return "", "", false
	}
	last := path[len(path)-1]
	prefix := strings.Join(path[:len(path)-1], ".")
	if prefix != "" {
		prefix += "."
	}

	switch {
	case aboutChecking[last]:
		return "", "", false
	case last == "expression" && strings.HasSuffix(prefix, "cel."):
		// A CEL rule is `{ id, message, expression }`; the expression is the
		// rule, the other two are how a violation is reported.
		return strings.TrimSuffix(prefix, "cel.") + "cel", o.Value, true
	case strings.HasSuffix(prefix, "cel."):
		return "", "", false
	case formatWords[last]:
		if o.Value != "true" {
			return "", "", false
		}

		return prefix + "format", last, true
	case last == "well_known_regex":
		return prefix + "format", o.Value, true
	case flagWords[last]:
		if o.Value != "true" {
			return "", "", false
		}

		return prefix + last, "", true
	default:
		return prefix + last, o.Value, true
	}
}
