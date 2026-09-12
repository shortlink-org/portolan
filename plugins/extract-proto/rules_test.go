package extractproto

import (
	"reflect"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
)

// One Protovalidate option in, one rule out, named in the catalog's words.
func TestRuleOf(t *testing.T) {
	cases := []struct {
		option Option
		name   string
		value  string
		ok     bool
	}{
		{Option{Name: "(buf.validate.field).string.min_len", Value: "1"}, "min_len", "1", true},
		{Option{Name: "(buf.validate.field).int64.gt", Value: "9007199254740993"}, "gt", "9007199254740993", true},
		{Option{Name: "(buf.validate.field).string.pattern", Value: "^[A-Z]{3}$"}, "pattern", "^[A-Z]{3}$", true},
		{Option{Name: "(buf.validate.field).string.in", Value: "USD, EUR"}, "in", "USD, EUR", true},
		{Option{Name: "(buf.validate.field).string.email", Value: "true"}, "format", "email", true},
		{Option{Name: "(buf.validate.field).string.well_known_regex", Value: "KNOWN_REGEX_HTTP_HEADER_NAME"}, "format", "KNOWN_REGEX_HTTP_HEADER_NAME", true},
		{Option{Name: "(buf.validate.field).repeated.min_items", Value: "1"}, "min_items", "1", true},
		{Option{Name: "(buf.validate.field).repeated.unique", Value: "true"}, "unique", "", true},
		{Option{Name: "(buf.validate.field).repeated.items.string.max_len", Value: "64"}, "items.max_len", "64", true},
		{Option{Name: "(buf.validate.field).map.keys.string.min_len", Value: "1"}, "keys.min_len", "1", true},
		{Option{Name: "(buf.validate.field).map.values.int32.gte", Value: "0"}, "values.gte", "0", true},
		{Option{Name: "(buf.validate.field).enum.defined_only", Value: "true"}, "defined_only", "", true},
		{Option{Name: "(buf.validate.field).timestamp.lt_now", Value: "true"}, "lt_now", "", true},
		{Option{Name: "(buf.validate.field).cel.expression", Value: "this > 0"}, "cel", "this > 0", true},
		{Option{Name: "(buf.validate.field).repeated.items.cel.expression", Value: "this != ''"}, "items.cel", "this != ''", true},
		{Option{Name: "(buf.validate.field).required", Value: "true"}, "required", "true", true},
		{Option{Name: "(acme.pii)", Value: "true"}, "(acme.pii)", "true", true},
		{Option{Name: "(acme.mask).style", Value: "LAST_FOUR"}, "(acme.mask).style", "LAST_FOUR", true},

		// Not rules: how a rule is checked, its example, its message, a flag
		// switched off, and the wire's own options.
		{Option{Name: "(buf.validate.field).ignore", Value: "IGNORE_IF_UNPOPULATED"}, "", "", false},
		{Option{Name: "(buf.validate.field).string.example", Value: "USD"}, "", "", false},
		{Option{Name: "(buf.validate.field).cel.id", Value: "positive"}, "", "", false},
		{Option{Name: "(buf.validate.field).cel.message", Value: "must be positive"}, "", "", false},
		{Option{Name: "(buf.validate.field).string.email", Value: "false"}, "", "", false},
		{Option{Name: "(buf.validate.field).repeated.unique", Value: "false"}, "", "", false},
		{Option{Name: "deprecated", Value: "true"}, "", "", false},
		{Option{Name: "json_name", Value: "basketId"}, "", "", false},
	}

	for _, c := range cases {
		name, value, ok := ruleOf(c.option)
		if name != c.name || value != c.value || ok != c.ok {
			t.Errorf("%s = %s: got (%q, %q, %v), want (%q, %q, %v)",
				c.option.Name, c.option.Value, name, value, ok, c.name, c.value, c.ok)
		}
	}
}

// The options of one field, together: required lifted off the list, a rule
// given twice merged into one, order otherwise as written.
func TestFieldRules(t *testing.T) {
	required, rules := fieldRules([]Option{
		{Name: "json_name", Value: "basketId"},
		{Name: "(buf.validate.field).required", Value: "true"},
		{Name: "(buf.validate.field).string.min_len", Value: "1"},
		{Name: "(buf.validate.field).string.in", Value: "USD"},
		{Name: "(buf.validate.field).string.in", Value: "EUR"},
		{Name: "(buf.validate.field).string.max_len", Value: "64"},
	})

	if !required {
		t.Error("a field with required = true is not marked required")
	}
	want := []catalog.FieldRule{
		{Name: "min_len", Value: "1"},
		{Name: "in", Value: "USD, EUR"},
		{Name: "max_len", Value: "64"},
	}
	if !reflect.DeepEqual(rules, want) {
		t.Errorf("rules:\n got %+v\nwant %+v", rules, want)
	}
}

// A field with nothing but the wire's own options carries no rules at all,
// so the fragment has no empty list to print.
func TestNoRulesIsAbsent(t *testing.T) {
	required, rules := fieldRules([]Option{{Name: "deprecated", Value: "true"}})
	if required || rules != nil {
		t.Errorf("got required=%v rules=%v, want neither", required, rules)
	}
}
