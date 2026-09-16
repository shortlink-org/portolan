//! What a Laravel validation rule says a value must satisfy, in the
//! catalog's words.
//!
//! An application states its rules where it validates: `'sku' =>
//! 'required|string|max:255'`, `['required', 'integer', 'min:1']`,
//! `Rule::in(['pending', 'paid'])`. The catalog has one vocabulary for these
//! across every source (portolan.0015), so Laravel's `max` on a string is
//! `max_len` here as `maxLength` is in an OpenAPI document and `max_len` in a
//! proto, and the page says all three the same way.
//!
//! What `min`, `max`, `size` and `between` mean is decided by the value's
//! type, exactly as Laravel decides it: a bound on a string is its length, on
//! a number its value, on an array the number of items. The type is what the
//! rules themselves say - `string`, `integer`, `numeric`, `array` - and a rule
//! set that names no type is left with Laravel's own word, `max = 255`, rather
//! than given a meaning the source did not state.
//!
//! A key ending in `.*` is about what a list holds, and its rules land on the
//! list under the `items.` prefix the vocabulary has for exactly that. A
//! deeper key, `lines.*.sku`, is its own field, named as the rules array names
//! it, because that is the name a reader will search the source for.

use crate::catalog::{Field, Rule};
use crate::ids::short;
use crate::source::{Base, Chain, Val};

/// The value's type, as far as the rules say. What a size bound means depends
/// on it, and so does the type the field is shown with.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Kind {
    Text,
    Integer,
    Number,
    Boolean,
    List,
    File,
    Date,
    /// The rules name no type: Laravel decides at runtime, and so neither can
    /// this.
    Unsaid,
}

impl Kind {
    fn type_name(self) -> &'static str {
        match self {
            Kind::Text => "string",
            Kind::Integer => "integer",
            Kind::Number => "number",
            Kind::Boolean => "boolean",
            Kind::List => "array",
            Kind::File => "file",
            Kind::Date => "date",
            Kind::Unsaid => "mixed",
        }
    }
}

/// The rules whose name is the value's type.
fn kind_of(name: &str) -> Option<Kind> {
    match name {
        "string" | "json" | "alpha" | "alpha_num" | "alpha_dash" | "ascii" | "email" | "url" | "active_url" | "uuid" | "ulid" | "ip" | "ipv4" | "ipv6"
        | "mac_address" | "timezone" | "hex_color" | "regex" | "not_regex" | "starts_with" | "ends_with" => Some(Kind::Text),
        "integer" | "int" | "digits" | "digits_between" => Some(Kind::Integer),
        "numeric" | "decimal" => Some(Kind::Number),
        "boolean" | "bool" | "accepted" | "declined" => Some(Kind::Boolean),
        "array" | "list" => Some(Kind::List),
        "file" | "image" | "mimes" | "mimetypes" | "dimensions" => Some(Kind::File),
        "date" | "date_format" | "date_equals" | "after" | "before" | "after_or_equal" | "before_or_equal" => Some(Kind::Date),
        _ => None,
    }
}

/// Laravel's names for a shape, in the spelling JSON Schema and the catalog
/// use. What is not here keeps Laravel's own word.
fn format_of(name: &str) -> Option<&'static str> {
    match name {
        "email" => Some("email"),
        "url" | "active_url" => Some("uri"),
        "uuid" => Some("uuid"),
        "ulid" => Some("ulid"),
        "ip" => Some("ip"),
        "ipv4" => Some("ipv4"),
        "ipv6" => Some("ipv6"),
        "json" => Some("json"),
        "date" => Some("date"),
        _ => None,
    }
}

/// Rules that say the value is of a type and nothing more: the type is the
/// field's, and repeating it as a rule would say the same thing twice.
const TYPE_ONLY: &[&str] = &[
    "string", "integer", "int", "numeric", "boolean", "bool", "array", "list", "file", "image", "date", "json",
];

/// One rule as written: its name, and the arguments after the colon.
#[derive(Debug, Clone)]
struct Token {
    name: String,
    args: Vec<String>,
}

impl Token {
    fn value(&self) -> Option<String> {
        if self.args.is_empty() { None } else { Some(self.args.join(", ")) }
    }
}

/// The fields a rules array declares, in the order it declares them.
pub fn fields_of(rules: &Val) -> Vec<Field> {
    let Some(items) = rules.as_arr() else { return Vec::new() };
    let mut out: Vec<Field> = Vec::new();
    for (key, value) in items {
        let Some(key) = key.as_ref().and_then(Val::as_str) else { continue };
        let tokens = tokens_of(value);
        if tokens.is_empty() {
            continue;
        }
        match key.strip_suffix(".*") {
            // `lines.*` is about what `lines` holds, which the vocabulary
            // says with a prefix rather than with a field of its own.
            Some(parent) if !parent.is_empty() => {
                let read = read(&tokens);
                let at = match out.iter().position(|f| f.name == parent) {
                    Some(at) => at,
                    None => {
                        out.push(Field {
                            name: parent.to_string(),
                            type_: Kind::List.type_name().into(),
                            ..Field::default()
                        });
                        out.len() - 1
                    }
                };
                let field = &mut out[at];
                // What the list holds, when the items say: `options.* =>
                // string` makes `options` a `string[]`, the way every other
                // extractor spells a list of a known type.
                if !field.type_.ends_with("[]") {
                    field.type_ = match read.kind {
                        Kind::Unsaid => Kind::List.type_name().into(),
                        kind => format!("{}[]", kind.type_name()),
                    };
                }
                if read.required {
                    field.rules.push(Rule {
                        name: "items.required".into(),
                        value: None,
                    });
                }
                for rule in read.rules {
                    field.rules.push(Rule {
                        name: format!("items.{}", rule.name),
                        value: rule.value,
                    });
                }
            }
            _ => {
                let read = read(&tokens);
                match out.iter_mut().find(|f| f.name == key) {
                    // A key stated twice - `lines` after `lines.*` - keeps
                    // where it first appeared and gains what the second word
                    // says.
                    Some(field) => {
                        // `array` says less than `string[]`, which the items
                        // may already have said.
                        if !(read.kind == Kind::List && field.type_.ends_with("[]")) {
                            field.type_ = read.kind.type_name().into();
                        }
                        field.required = field.required || read.required;
                        let mut rules = read.rules;
                        rules.append(&mut field.rules);
                        field.rules = rules;
                    }
                    None => out.push(Field {
                        name: key.to_string(),
                        type_: read.kind.type_name().into(),
                        doc: String::new(),
                        required: read.required,
                        rules: read.rules,
                    }),
                }
            }
        }
    }
    out
}

struct Read {
    kind: Kind,
    required: bool,
    rules: Vec<Rule>,
}

/// What one field's rules say: its type, whether it must be sent, and every
/// bound on it, in the order they were written.
fn read(tokens: &[Token]) -> Read {
    let kind = tokens.iter().find_map(|t| kind_of(&t.name)).unwrap_or(Kind::Unsaid);
    let mut out = Read {
        kind,
        required: false,
        rules: Vec::new(),
    };
    let mut push = |name: &str, value: Option<String>| out.rules.push(Rule { name: name.into(), value });

    for token in tokens {
        let name = token.name.as_str();
        let value = token.value();
        match name {
            // `present` is Laravel's "the key must be there"; `required` adds
            // that it may not be empty, and both are the one thing a reader
            // wants first.
            "required" | "present" => out.required = true,
            "nullable" | "sometimes" => {}
            _ if TYPE_ONLY.contains(&name) => {}
            "min" | "max" | "size" | "between" => {
                for (rule, value) in sized(name, kind, &token.args) {
                    push(&rule, value);
                }
            }
            "regex" | "not_regex" => {
                let rule = if name == "regex" { "pattern" } else { "not_regex" };
                push(rule, value.as_deref().map(pattern_of));
            }
            "in" => push("in", value),
            "not_in" => push("not_in", value),
            "starts_with" => push("prefix", value),
            "ends_with" => push("suffix", value),
            "gt" | "gte" | "lt" | "lte" => push(name, value),
            "multiple_of" => push("multiple_of", value),
            "unique" => push("unique", value),
            "distinct" => push("unique", None),
            _ => match format_of(name) {
                Some(format) => push("format", Some(format.into())),
                // A rule the vocabulary has no word for is still a fact about
                // the field: `confirmed`, `required_if = status, paid`,
                // `exists = users, id`. It keeps the name Laravel gave it
                // rather than being dropped for a reader to find in the code.
                None => push(name, value),
            },
        }
    }
    out
}

/// `min`, `max`, `size` and `between`, which mean what the value's type says
/// they mean. A type the rules do not state leaves Laravel's own word, since
/// a length and a value are not the same claim.
fn sized(name: &str, kind: Kind, args: &[String]) -> Vec<(String, Option<String>)> {
    let one = args.first().cloned();
    let (low, high) = match name {
        "between" => (args.first().cloned(), args.get(1).cloned()),
        _ => (one.clone(), one.clone()),
    };
    let bounds: [&str; 3] = match kind {
        Kind::Text => ["min_len", "max_len", "len"],
        Kind::Integer | Kind::Number => ["gte", "lte", "const"],
        Kind::List => ["min_items", "max_items", ""],
        _ => return vec![(name.to_string(), args.join(", ").into())],
    };
    match name {
        "min" => vec![(bounds[0].into(), low)],
        "max" => vec![(bounds[1].into(), high)],
        "between" => vec![(bounds[0].into(), low), (bounds[1].into(), high)],
        // `size` is "exactly this": one bound for a string or a number, and
        // the two it is for a list, which the vocabulary has no single word for.
        _ if bounds[2].is_empty() => vec![(bounds[0].into(), low.clone()), (bounds[1].into(), high)],
        _ => vec![(bounds[2].into(), one)],
    }
}

/// `/^[A-Z]{3}$/i` → `^[A-Z]{3}$`: the pattern as a document or a proto would
/// carry it, without the delimiters a flag hangs off.
fn pattern_of(raw: &str) -> String {
    let mut chars = raw.chars();
    let Some(open) = chars.next() else { return raw.to_string() };
    if open.is_alphanumeric() {
        return raw.to_string();
    }
    let close = match open {
        '(' => ')',
        '[' => ']',
        '{' => '}',
        '<' => '>',
        other => other,
    };
    match raw[1..].rfind(close) {
        Some(at) => raw[1..=at].to_string(),
        None => raw.to_string(),
    }
}

/// The rules of one field, however they were written: a pipe-separated
/// string, a list of rules, or a `Rule::` builder among them.
fn tokens_of(value: &Val) -> Vec<Token> {
    match value {
        Val::Str(s) => s.split('|').filter_map(token_of).collect(),
        Val::Arr(items) => items.iter().flat_map(|(_, v)| tokens_of(v)).collect(),
        Val::Chain(chain) => builder(chain).into_iter().collect(),
        _ => Vec::new(),
    }
}

/// `max:255` → `max` with `255`; an empty segment is nothing.
fn token_of(written: &str) -> Option<Token> {
    let written = written.trim();
    if written.is_empty() {
        return None;
    }
    let (name, rest) = match written.split_once(':') {
        Some((name, rest)) => (name, rest),
        None => (written, ""),
    };
    let name = name.trim().to_ascii_lowercase();
    if name.is_empty() {
        return None;
    }
    let args = if rest.is_empty() {
        Vec::new()
    } else if name == "regex" || name == "not_regex" {
        // A pattern is one argument whatever commas it holds.
        vec![rest.to_string()]
    } else {
        rest.split(',').map(|a| a.trim().to_string()).collect()
    };
    Some(Token { name, args })
}

/// `Rule::in([...])`, `Rule::unique('users', 'email')`, `Rule::enum(Status::class)`:
/// the fluent spelling of the same rules, which is what a rules array holds
/// when a value has a comma in it.
fn builder(chain: &Chain) -> Option<Token> {
    let Base::Static(class) = &chain.base else { return None };
    if short(class) != "Rule" {
        return None;
    }
    let part = chain.parts.first()?;
    let args = part.args.as_ref()?;
    let name = snake(&part.name);
    let mut out: Vec<String> = Vec::new();
    for arg in args {
        match arg {
            Val::Str(s) => out.push(s.clone()),
            Val::Int(n) => out.push(n.to_string()),
            Val::Class(c) => out.push(short(c).to_string()),
            Val::ClassConst(c, konst) => out.push(format!("{}::{konst}", short(c))),
            Val::Arr(items) => {
                for (_, v) in items {
                    match v {
                        Val::Str(s) => out.push(s.clone()),
                        Val::Int(n) => out.push(n.to_string()),
                        Val::ClassConst(c, konst) => out.push(format!("{}::{konst}", short(c))),
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    Some(Token { name, args: out })
}

/// `notIn` → `not_in`: a builder is spelled in camel case and a rule is not.
fn snake(name: &str) -> String {
    let mut out = String::new();
    for (i, c) in name.chars().enumerate() {
        if c.is_ascii_uppercase() {
            if i > 0 {
                out.push('_');
            }
            out.push(c.to_ascii_lowercase());
        } else {
            out.push(c);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::Tree;

    /// The rules array of `rules()` in a file, read the way the extractor
    /// reads one.
    fn fields(body: &str) -> Vec<Field> {
        let src = format!("<?php\nclass R {{ public function rules(): array {{ return {body}; }} }}\n");
        let tree = Tree::from_sources(&[("R.php", &src)]);
        let class = tree.class("R").expect("the class parses");
        let rules = class.method("rules").and_then(|m| m.returns.first().cloned()).expect("the rules are returned");
        fields_of(&rules)
    }

    fn rules(field: &Field) -> Vec<(String, Option<String>)> {
        field.rules.iter().map(|r| (r.name.clone(), r.value.clone())).collect()
    }

    #[test]
    fn a_bound_means_what_the_type_says_it_means() {
        let out = fields("['sku' => 'required|string|max:64', 'qty' => 'required|integer|min:1|max:99', 'lines' => 'array|min:1']");
        assert_eq!(out.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), ["sku", "qty", "lines"]);
        assert_eq!(out[0].type_, "string");
        assert_eq!(rules(&out[0]), [("max_len".to_string(), Some("64".into()))]);
        assert_eq!(out[1].type_, "integer");
        assert_eq!(rules(&out[1]), [("gte".to_string(), Some("1".into())), ("lte".into(), Some("99".into()))]);
        assert_eq!(rules(&out[2]), [("min_items".to_string(), Some("1".into()))]);
    }

    #[test]
    fn a_bound_with_no_type_keeps_laravels_word() {
        let out = fields("['name' => 'required|max:255']");
        assert_eq!(out[0].type_, "mixed");
        assert_eq!(rules(&out[0]), [("max".to_string(), Some("255".into()))]);
    }

    #[test]
    fn size_and_between_are_the_bounds_they_are() {
        let out = fields("['code' => 'string|size:3', 'qty' => 'integer|between:1,9', 'lines' => 'array|size:2']");
        assert_eq!(rules(&out[0]), [("len".to_string(), Some("3".into()))]);
        assert_eq!(rules(&out[1]), [("gte".to_string(), Some("1".into())), ("lte".into(), Some("9".into()))]);
        assert_eq!(
            rules(&out[2]),
            [("min_items".to_string(), Some("2".into())), ("max_items".into(), Some("2".into()))]
        );
    }

    #[test]
    fn a_shape_is_a_format_and_a_pattern_loses_its_delimiters() {
        let out = fields("['email' => 'required|email', 'site' => 'url', 'id' => 'uuid', 'code' => 'regex:/^[A-Z]{3}$/i']");
        assert_eq!(rules(&out[0]), [("format".to_string(), Some("email".into()))]);
        assert_eq!(rules(&out[1]), [("format".to_string(), Some("uri".into()))]);
        assert_eq!(rules(&out[2]), [("format".to_string(), Some("uuid".into()))]);
        assert_eq!(rules(&out[3]), [("pattern".to_string(), Some("^[A-Z]{3}$".into()))]);
        assert_eq!(out[3].type_, "string");
    }

    #[test]
    fn a_closed_set_is_one_rule_however_it_is_written() {
        let out = fields("['status' => 'in:draft,paid', 'kind' => ['required', Rule::in(['a', 'b'])], 'other' => [Rule::notIn(['x'])]]");
        assert_eq!(rules(&out[0]), [("in".to_string(), Some("draft, paid".into()))]);
        assert!(out[1].required);
        assert_eq!(rules(&out[1]), [("in".to_string(), Some("a, b".into()))]);
        assert_eq!(rules(&out[2]), [("not_in".to_string(), Some("x".into()))]);
    }

    #[test]
    fn what_must_be_sent_is_a_flag_and_not_a_rule() {
        let out = fields("['a' => 'required|string', 'b' => 'nullable|string', 'c' => 'sometimes|string', 'd' => 'present']");
        assert!(out[0].required);
        assert!(!out[1].required);
        assert!(!out[2].required);
        assert!(out[3].required);
        assert!(out[0].rules.is_empty());
    }

    #[test]
    fn a_rule_with_no_word_for_it_keeps_laravels() {
        let out = fields("['password' => 'required|confirmed', 'email' => 'unique:users,email', 'paid_at' => 'required_if:status,paid']");
        assert_eq!(rules(&out[0]), [("confirmed".to_string(), None)]);
        assert_eq!(rules(&out[1]), [("unique".to_string(), Some("users, email".into()))]);
        assert_eq!(rules(&out[2]), [("required_if".to_string(), Some("status, paid".into()))]);
    }

    #[test]
    fn a_rule_on_what_a_list_holds_lands_on_the_list() {
        let out = fields("['lines' => 'required|array|min:1', 'lines.*' => 'required|string|max:8', 'lines.*.sku' => 'required|string']");
        assert_eq!(out.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), ["lines", "lines.*.sku"]);
        assert!(out[0].required);
        assert_eq!(out[0].type_, "string[]");
        assert_eq!(
            rules(&out[0]),
            [
                ("min_items".to_string(), Some("1".into())),
                ("items.required".into(), None),
                ("items.max_len".into(), Some("8".into())),
            ]
        );
        assert!(out[1].required);
    }

    #[test]
    fn a_list_named_only_by_its_items_is_still_a_list() {
        let out = fields("['tags.*' => 'string|max:4']");
        assert_eq!(out[0].name, "tags");
        assert_eq!(out[0].type_, "string[]");
        assert_eq!(
            fields("['tags' => 'array', 'tags.*' => 'in:a,b']")[0].type_,
            "array",
            "items that say no type leave the list one"
        );
        assert_eq!(rules(&out[0]), [("items.max_len".to_string(), Some("4".into()))]);
    }
}
