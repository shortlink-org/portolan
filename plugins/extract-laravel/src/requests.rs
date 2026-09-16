//! Where a Laravel application says what a request must satisfy, and what it
//! says there.
//!
//! Laravel has one answer and three spellings of it. A route's action either
//! takes a form request - `public function store(StoreOrderRequest $request)`,
//! whose `rules()` is the shape - or validates in the body:
//! `$request->validate([...])`, `Validator::make($data, [...])`,
//! `$this->validate($request, [...])`. All of them are the same claim, read
//! into the same fields (see `rules.rs` for what a rule becomes).
//!
//! The shape belongs to the interface, not to a use case: a Laravel module's
//! routes are one contract, and what a route must be sent is the contract's
//! request message, the way `extract-openapi` carries one.

use crate::catalog::Field;
use crate::ids::short;
use crate::rules::fields_of;
use crate::source::{Base, ClassInfo, MethodInfo, Tree, Val};

/// A named request shape: what the interface calls it, and what it holds.
#[derive(Debug, Clone)]
pub struct Request {
    pub name: String,
    pub fields: Vec<Field>,
}

/// The form request a method takes, by class name, when it takes one. Named
/// apart from reading it so that one whose `rules()` cannot be read is
/// reported rather than silently missing.
pub fn form_request_of<'a>(tree: &Tree, method: &'a MethodInfo) -> Option<&'a str> {
    method
        .params
        .iter()
        .filter_map(|p| p.class.as_deref())
        .find(|class| is_form_request(tree, class))
}

/// The shape the action checks its request against: its form request's rules,
/// or the rules it validates with in the body. A method that does neither
/// says nothing about what it takes, which is not the same as taking nothing.
pub fn of_action(tree: &Tree, controller: &str, method_name: &str, method: &MethodInfo) -> Option<Request> {
    if let Some(class) = form_request_of(tree, method)
        && let Some(fields) = rules_of_class(tree, class)
    {
        return Some(Request {
            name: short(class).to_string(),
            fields,
        });
    }
    let mut fields: Vec<Field> = Vec::new();
    let mut chains = Vec::new();
    for chain in &method.chains {
        chain.flatten(&mut chains);
    }
    for chain in chains {
        let Some(rules) = validated(chain) else { continue };
        for field in fields_of(rules) {
            // The first word about a name is the one kept, as it is when a
            // handler validates the route's parameters and then its body.
            if !fields.iter().any(|f| f.name == field.name) {
                fields.push(field);
            }
        }
    }
    if fields.is_empty() {
        return None;
    }
    Some(Request {
        name: message_name(controller, method_name),
        fields,
    })
}

/// Whether a class is a form request: it extends Laravel's `FormRequest`,
/// directly or through a base of the application's own.
fn is_form_request(tree: &Tree, class: &str) -> bool {
    tree.extends(class, &|parent, in_tree| {
        parent == "Illuminate\\Foundation\\Http\\FormRequest" || (!in_tree && short(parent) == "FormRequest")
    })
}

/// The fields a form request's `rules()` declares, following the base classes
/// it may be declared in.
fn rules_of_class(tree: &Tree, class: &str) -> Option<Vec<Field>> {
    let mut current = tree.class(class);
    let mut depth = 0;
    while let Some(c) = current {
        if let Some(rules) = c.method("rules").and_then(rules_returned) {
            let fields = fields_of(&rules);
            return if fields.is_empty() { None } else { Some(fields) };
        }
        depth += 1;
        if depth > 16 {
            break;
        }
        current = parent_of(tree, c);
    }
    None
}

fn parent_of<'a>(tree: &'a Tree, class: &ClassInfo) -> Option<&'a ClassInfo> {
    class.extends.first().and_then(|p| tree.class(p))
}

/// The array a `rules()` hands back, when it hands back one the syntax says.
fn rules_returned(method: &MethodInfo) -> Option<Val> {
    method.returns.iter().find(|v| matches!(v, Val::Arr(_))).cloned()
}

/// The rules array of a validate call, in each of the spellings Laravel takes.
fn validated(chain: &crate::source::Chain) -> Option<&Val> {
    let part = chain.parts.iter().find(|p| p.args.is_some());
    match &chain.base {
        // `validator($data, [...])`, the helper.
        Base::Func(name, args) if name == "validator" => args.get(1),
        // `request()->validate([...])`: the request without a parameter for it.
        Base::Func(name, _) if name == "request" => {
            let part = part?;
            let args = part.args.as_ref()?;
            match part.name.as_str() {
                "validate" => args.first(),
                "validateWithBag" => args.get(1),
                _ => None,
            }
        }
        Base::Static(class) if short(class) == "Validator" => {
            let part = part?;
            let args = part.args.as_ref()?;
            if part.name == "make" || part.name == "validate" { args.get(1) } else { None }
        }
        Base::Var(name) => {
            let part = part?;
            let args = part.args.as_ref()?;
            match (name.as_str(), part.name.as_str()) {
                // `$this->validate($request, [...])`: the controller trait.
                ("this", "validate") => args.get(1),
                // `$request->validate([...])`, `->validateWithBag('bag', [...])`.
                (_, "validate") => args.first(),
                (_, "validateWithBag") => args.get(1),
                _ => None,
            }
        }
        _ => None,
    }
    .filter(|v| matches!(v, Val::Arr(_)))
}

/// What a shape read out of a controller body is called: the controller and
/// the method that validates it, the way a form request would have been named
/// had the application written one.
fn message_name(controller: &str, method: &str) -> String {
    let base = short(controller).trim_end_matches("Controller").to_string();
    format!("{base}{}Request", upper_first(method))
}

fn upper_first(name: &str) -> String {
    let mut chars = name.chars();
    match chars.next() {
        Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::Tree;

    fn read(sources: &[(&str, &str)], class: &str, method: &str) -> Option<Request> {
        let tree = Tree::from_sources(sources);
        let c = tree.class(class)?;
        let m = c.method(method)?;
        of_action(&tree, class, method, m)
    }

    const FORM_REQUEST: &str = r#"<?php
namespace App\Http\Requests;
use Illuminate\Foundation\Http\FormRequest;
class StoreOrderRequest extends FormRequest {
    public function rules(): array {
        return ['sku' => 'required|string|max:64', 'qty' => 'required|integer|min:1'];
    }
}
"#;

    #[test]
    fn a_form_request_in_the_signature_is_the_shape() {
        let controller = r#"<?php
namespace App\Http\Controllers;
use App\Http\Requests\StoreOrderRequest;
class OrderController {
    public function store(StoreOrderRequest $request) { return 1; }
}
"#;
        let out = read(
            &[("StoreOrderRequest.php", FORM_REQUEST), ("OrderController.php", controller)],
            "App\\Http\\Controllers\\OrderController",
            "store",
        )
        .expect("the form request is read");
        assert_eq!(out.name, "StoreOrderRequest");
        assert_eq!(out.fields.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), ["sku", "qty"]);
        assert!(out.fields[0].required);
    }

    #[test]
    fn a_form_request_through_a_base_of_the_applications_own_is_still_one() {
        let base = r#"<?php
namespace App\Http\Requests;
use Illuminate\Foundation\Http\FormRequest;
abstract class BaseRequest extends FormRequest {}
"#;
        let request = r#"<?php
namespace App\Http\Requests;
class UpdateOrderRequest extends BaseRequest {
    public function rules(): array { return ['status' => 'required|in:draft,paid']; }
}
"#;
        let controller = r#"<?php
namespace App\Http\Controllers;
use App\Http\Requests\UpdateOrderRequest;
class OrderController {
    public function update(UpdateOrderRequest $request) { return 1; }
}
"#;
        let out = read(
            &[
                ("BaseRequest.php", base),
                ("UpdateOrderRequest.php", request),
                ("OrderController.php", controller),
            ],
            "App\\Http\\Controllers\\OrderController",
            "update",
        )
        .expect("the form request is read");
        assert_eq!(out.name, "UpdateOrderRequest");
        assert_eq!(out.fields[0].rules[0].name, "in");
    }

    #[test]
    fn a_body_that_validates_says_the_same_thing_under_its_own_name() {
        let controller = r#"<?php
namespace App\Http\Controllers;
use Illuminate\Http\Request;
class CartController {
    public function store(Request $request, int $id) {
        $data = $request->validate(['quantity' => 'required|integer|min:1|max:99']);
        return $data;
    }
}
"#;
        let out = read(&[("CartController.php", controller)], "App\\Http\\Controllers\\CartController", "store").expect("the rules are read");
        assert_eq!(out.name, "CartStoreRequest");
        assert_eq!(out.fields[0].name, "quantity");
        assert_eq!(out.fields[0].type_, "integer");
    }

    #[test]
    fn every_spelling_of_validating_in_the_body_is_read() {
        let controller = r#"<?php
namespace App\Http\Controllers;
use Illuminate\Support\Facades\Validator;
class MixedController {
    public function one(\Illuminate\Http\Request $request) {
        return Validator::make($request->all(), ['email' => 'required|email'])->validate();
    }
    public function two($request) {
        return $this->validate($request, ['code' => 'required|string|size:3']);
    }
    public function three($request) {
        return validator($request->all(), ['page' => 'integer|min:1'])->validate();
    }
    public function four() {
        return request()->validate(['token' => 'required|string|size:32']);
    }
}
"#;
        let sources = &[("MixedController.php", controller)];
        let class = "App\\Http\\Controllers\\MixedController";
        assert_eq!(read(sources, class, "one").unwrap().fields[0].name, "email");
        assert_eq!(read(sources, class, "two").unwrap().fields[0].rules[0].name, "len");
        assert_eq!(read(sources, class, "three").unwrap().fields[0].rules[0].name, "gte");
        assert_eq!(read(sources, class, "four").unwrap().fields[0].name, "token");
    }

    #[test]
    fn a_method_that_validates_twice_states_one_request() {
        let controller = r#"<?php
namespace App\Http\Controllers;
class TwoController {
    public function store($request) {
        $request->validate(['id' => 'required|uuid']);
        $request->validate(['id' => 'required|string', 'note' => 'nullable|string|max:8']);
        return 1;
    }
}
"#;
        let out = read(&[("TwoController.php", controller)], "App\\Http\\Controllers\\TwoController", "store").unwrap();
        assert_eq!(out.fields.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), ["id", "note"]);
        assert_eq!(out.fields[0].rules[0].value.as_deref(), Some("uuid"));
        assert!(!out.fields[1].required);
    }

    #[test]
    fn a_method_that_validates_nothing_says_nothing() {
        let controller = r#"<?php
namespace App\Http\Controllers;
class QuietController {
    public function index() { return view('home'); }
}
"#;
        assert!(read(&[("QuietController.php", controller)], "App\\Http\\Controllers\\QuietController", "index").is_none());
    }
}
