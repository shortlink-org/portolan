//! The routes a file declares, read the way Laravel's router would read it:
//! `Route::get('path', action)`, wrapped in `prefix`, `name`, `controller`
//! and `group` calls that apply to everything inside their closure, and
//! `Route::resource(...)` expanded into the seven routes it stands for.
//! Nothing is executed; a route whose path or action is computed at runtime
//! is kept as unknown rather than guessed.

use std::path::PathBuf;

use crate::ids::short;
use crate::source::{Base, Chain, SourceFile, Val};

#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    /// A controller method, the class resolved.
    Controller(String, String),
    Closure,
    Redirect(String),
    View(String),
    Unknown,
}

#[derive(Debug, Clone)]
pub struct Endpoint {
    /// Upper case; `ANY` when the route answers every verb.
    pub verb: String,
    pub path: String,
    pub name: Option<String>,
    pub action: Action,
    pub file: PathBuf,
    pub line: u32,
    pub module: usize,
}

#[derive(Debug, Clone, Default)]
struct Scope {
    prefix: String,
    name: String,
    namespace: String,
    controller: Option<String>,
}

const VERBS: &[&str] = &["get", "post", "put", "patch", "delete", "options"];

/// (action, verb, path after the resource)
const RESOURCE: &[(&str, &str, &str)] = &[
    ("index", "GET", ""),
    ("create", "GET", "/create"),
    ("store", "POST", ""),
    ("show", "GET", "/{param}"),
    ("edit", "GET", "/{param}/edit"),
    ("update", "PUT", "/{param}"),
    ("destroy", "DELETE", "/{param}"),
];

pub fn read(file: &SourceFile) -> Vec<Endpoint> {
    let mut out = Vec::new();
    walk(&file.chains, &Scope::default(), file, &mut out);
    out
}

fn is_router(base: &Base) -> bool {
    match base {
        Base::Static(class) => short(class) == "Route",
        Base::Var(name) => name == "router",
        _ => false,
    }
}

fn walk(chains: &[Chain], scope: &Scope, file: &SourceFile, out: &mut Vec<Endpoint>) {
    for chain in chains {
        if !is_router(&chain.base) {
            continue;
        }
        let mut scope = scope.clone();
        let mut pending: Option<(Vec<String>, String, Action, u32)> = None;
        let mut resource: Option<(String, Action, bool, u32)> = None;
        let mut only: Option<Vec<String>> = None;
        let mut except: Vec<String> = Vec::new();
        for part in &chain.parts {
            let Some(args) = part.args.as_ref() else { continue };
            let arg = |i: usize| args.get(i);
            match part.name.as_str() {
                "prefix" => {
                    if let Some(p) = arg(0).and_then(Val::as_str) {
                        scope.prefix = join(&scope.prefix, p);
                    }
                }
                "name" | "as" => {
                    if let Some(n) = arg(0).and_then(Val::as_str) {
                        scope.name.push_str(n);
                    }
                }
                "controller" => scope.controller = arg(0).and_then(class_of),
                "namespace" => {
                    if let Some(n) = arg(0).and_then(Val::as_str) {
                        scope.namespace = n.trim_matches('\\').to_string();
                    }
                }
                "group" => {
                    let (attrs, body) = match (arg(0), arg(1)) {
                        (Some(a @ Val::Arr(_)), Some(Val::Closure(c))) => (Some(a), Some(c)),
                        (Some(Val::Closure(c)), _) => (None, Some(c)),
                        _ => (None, None),
                    };
                    if let Some(attrs) = attrs {
                        if let Some(p) = attrs.get("prefix").and_then(Val::as_str) {
                            scope.prefix = join(&scope.prefix, p);
                        }
                        if let Some(n) = attrs.get("as").and_then(Val::as_str) {
                            scope.name.push_str(n);
                        }
                        if let Some(n) = attrs.get("namespace").and_then(Val::as_str) {
                            scope.namespace = n.trim_matches('\\').to_string();
                        }
                        if let Some(c) = attrs.get("controller").and_then(class_of) {
                            scope.controller = Some(c);
                        }
                    }
                    if let Some(body) = body {
                        walk(body, &scope, file, out);
                    }
                }
                verb if VERBS.contains(&verb) => {
                    let path = arg(0).and_then(Val::as_str).unwrap_or("").to_string();
                    let action = arg(1).map(|a| action_of(a, &scope)).unwrap_or(Action::Unknown);
                    pending = Some((vec![verb.to_ascii_uppercase()], path, action, part.line));
                }
                "any" => {
                    let path = arg(0).and_then(Val::as_str).unwrap_or("").to_string();
                    let action = arg(1).map(|a| action_of(a, &scope)).unwrap_or(Action::Unknown);
                    pending = Some((vec!["ANY".into()], path, action, part.line));
                }
                "match" => {
                    let verbs: Vec<String> = arg(0)
                        .and_then(Val::as_arr)
                        .map(|a| a.iter().filter_map(|(_, v)| v.as_str()).map(|v| v.to_ascii_uppercase()).collect())
                        .unwrap_or_default();
                    let path = arg(1).and_then(Val::as_str).unwrap_or("").to_string();
                    let action = arg(2).map(|a| action_of(a, &scope)).unwrap_or(Action::Unknown);
                    pending = Some((if verbs.is_empty() { vec!["ANY".into()] } else { verbs }, path, action, part.line));
                }
                "redirect" | "permanentRedirect" => {
                    let path = arg(0).and_then(Val::as_str).unwrap_or("").to_string();
                    let to = arg(1).and_then(Val::as_str).unwrap_or("").to_string();
                    pending = Some((vec!["ANY".into()], path, Action::Redirect(to), part.line));
                }
                "view" => {
                    let path = arg(0).and_then(Val::as_str).unwrap_or("").to_string();
                    let view = arg(1).and_then(Val::as_str).unwrap_or("").to_string();
                    pending = Some((vec!["GET".into()], path, Action::View(view), part.line));
                }
                "resource" | "apiResource" => {
                    let name = arg(0).and_then(Val::as_str).unwrap_or("").to_string();
                    let controller = arg(1).map(|a| action_of(a, &scope)).unwrap_or(Action::Unknown);
                    resource = Some((name, controller, part.name == "apiResource", part.line));
                }
                "only" => only = Some(names_in(arg(0))),
                "except" => except = names_in(arg(0)),
                _ => {}
            }
        }
        if let Some((verbs, path, action, line)) = pending {
            // A route that never called `name()` carries only its group's
            // prefix, `shop.customer.`; Laravel keeps that, a reader should not.
            let name = if scope.name.is_empty() || scope.name.ends_with('.') {
                None
            } else {
                Some(scope.name.clone())
            };
            for verb in verbs {
                out.push(Endpoint {
                    verb,
                    path: full_path(&scope.prefix, &path),
                    name: name.clone(),
                    action: action.clone(),
                    file: file.path.clone(),
                    line,
                    module: file.module,
                });
            }
        }
        if let Some((name, controller, api, line)) = resource {
            let controller = match controller {
                Action::Controller(class, _) => Some(class),
                _ => None,
            };
            let segments: Vec<&str> = name.split('.').collect();
            let (last, parents) = segments.split_last().unwrap_or((&"", &[]));
            let base: String = parents.iter().map(|p| format!("/{p}/{{{}}}", singular(p))).collect::<String>() + "/" + last;
            let param = singular(last);
            for (action, verb, suffix) in RESOURCE {
                if api && matches!(*action, "create" | "edit") {
                    continue;
                }
                if only.as_ref().is_some_and(|o| !o.iter().any(|x| x == action)) || except.iter().any(|x| x == action) {
                    continue;
                }
                let path = format!("{base}{}", suffix.replace("{param}", &format!("{{{param}}}")));
                out.push(Endpoint {
                    verb: verb.to_string(),
                    path: full_path(&scope.prefix, &path),
                    name: Some(format!("{}{name}.{action}", scope.name)),
                    action: controller
                        .as_ref()
                        .map(|c| Action::Controller(c.clone(), action.to_string()))
                        .unwrap_or(Action::Unknown),
                    file: file.path.clone(),
                    line,
                    module: file.module,
                });
            }
        }
    }
}

fn names_in(val: Option<&Val>) -> Vec<String> {
    val.and_then(Val::as_arr)
        .map(|a| a.iter().filter_map(|(_, v)| v.as_str()).map(String::from).collect())
        .unwrap_or_default()
}

fn class_of(val: &Val) -> Option<String> {
    match val {
        Val::Class(c) => Some(c.clone()),
        Val::Str(s) => Some(s.trim_start_matches('\\').to_string()),
        _ => None,
    }
}

/// What the second argument of a route call names.
fn action_of(val: &Val, scope: &Scope) -> Action {
    match val {
        Val::Closure(_) => Action::Closure,
        Val::Class(c) => Action::Controller(c.clone(), "__invoke".into()),
        Val::Str(s) => match s.split_once('@') {
            Some((class, method)) => Action::Controller(qualify(class, scope), method.to_string()),
            None => match &scope.controller {
                Some(controller) => Action::Controller(controller.clone(), s.clone()),
                None if s.contains('\\') => Action::Controller(qualify(s, scope), "__invoke".into()),
                None => Action::Unknown,
            },
        },
        Val::Arr(items) => {
            if let Some(uses) = val.get("uses") {
                return action_of(uses, scope);
            }
            let values: Vec<&Val> = items.iter().filter(|(k, _)| k.is_none()).map(|(_, v)| v).collect();
            match (values.first(), values.get(1)) {
                (Some(Val::Class(c)), Some(Val::Str(m))) => Action::Controller(c.clone(), m.clone()),
                (Some(Val::Str(c)), Some(Val::Str(m))) => Action::Controller(qualify(c, scope), m.clone()),
                (Some(Val::Class(c)), None) => Action::Controller(c.clone(), "__invoke".into()),
                _ => Action::Unknown,
            }
        }
        _ => Action::Unknown,
    }
}

/// A controller named as a string, put under the group's namespace when it
/// is not already absolute.
fn qualify(class: &str, scope: &Scope) -> String {
    let class = class.trim_start_matches('\\');
    if scope.namespace.is_empty() || class.contains('\\') {
        class.to_string()
    } else {
        format!("{}\\{class}", scope.namespace)
    }
}

fn join(prefix: &str, path: &str) -> String {
    let path = path.trim_matches('/');
    if path.is_empty() {
        return prefix.to_string();
    }
    if prefix.is_empty() { path.to_string() } else { format!("{prefix}/{path}") }
}

/// `/` + prefix + path, one slash between, optional parameters made plain.
pub fn full_path(prefix: &str, path: &str) -> String {
    let joined = join(prefix, path);
    let joined = joined.replace("?}", "}");
    let mut out = String::from("/");
    out.push_str(joined.trim_matches('/'));
    while out.contains("//") {
        out = out.replace("//", "/");
    }
    out
}

/// `photos` → `photo`, `categories` → `category`, `order-items` → `order_item`:
/// what Laravel names a resource's parameter.
pub fn singular(name: &str) -> String {
    let name = name.replace('-', "_");
    if let Some(stem) = name.strip_suffix("ies") {
        return format!("{stem}y");
    }
    for suffix in ["ses", "xes", "shes", "ches"] {
        if let Some(stem) = name.strip_suffix(suffix) {
            return format!("{stem}{}", &suffix[..suffix.len() - 2]);
        }
    }
    if name.ends_with('s') && !name.ends_with("ss") {
        return name[..name.len() - 1].to_string();
    }
    name
}

/// The `{param}` names a path carries, in order.
pub fn params_of(path: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = path;
    while let Some(start) = rest.find('{') {
        let Some(end) = rest[start..].find('}') else { break };
        out.push(rest[start + 1..start + end].to_string());
        rest = &rest[start + end + 1..];
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::Tree;

    fn routes(src: &str) -> Vec<Endpoint> {
        let tree = Tree::from_sources(&[("Routes/web.php", src)]);
        read(&tree.files[0])
    }

    fn brief(e: &Endpoint) -> String {
        let action = match &e.action {
            Action::Controller(c, m) => format!("{}::{m}", short(c)),
            Action::Closure => "closure".into(),
            Action::Redirect(to) => format!("redirect {to}"),
            Action::View(v) => format!("view {v}"),
            Action::Unknown => "?".into(),
        };
        format!("{} {} {} {}", e.verb, e.path, e.name.clone().unwrap_or_else(|| "-".into()), action)
    }

    #[test]
    fn applies_groups_to_what_they_wrap() {
        let found = routes(
            "<?php\nuse Illuminate\\Support\\Facades\\Route;\nuse Acme\\Shop\\Http\\Controllers\\CartController;\nuse Acme\\Shop\\Http\\Controllers\\OnepageController;\n\nRoute::group(['prefix' => 'shop', 'as' => 'shop.'], function () {\n  Route::controller(CartController::class)->prefix('checkout/cart')->group(function () {\n    Route::get('', 'index')->name('checkout.cart.index');\n    Route::post('add/{id}', 'store')->middleware('throttle')->name('checkout.cart.store');\n    Route::delete('remove/{id?}', 'destroy')->name('checkout.cart.remove');\n  });\n  Route::name('checkout.onepage.')->prefix('checkout/onepage')->group(function () {\n    Route::get('/', [OnepageController::class, 'index'])->name('index');\n    Route::post('orders', 'Acme\\Shop\\Http\\Controllers\\OnepageController@storeOrder')->name('orders.store');\n  });\n});\nRoute::get('/health', function () { return 'ok'; });\nRoute::match(['get', 'post'], 'hook', [OnepageController::class, 'hook']);\nRoute::any('legacy', OnepageController::class);\nRoute::redirect('/old', '/new');\nRoute::view('/about', 'pages.about');\n",
        );
        let got: Vec<String> = found.iter().map(brief).collect();
        assert_eq!(
            got,
            [
                "GET /shop/checkout/cart shop.checkout.cart.index CartController::index",
                "POST /shop/checkout/cart/add/{id} shop.checkout.cart.store CartController::store",
                "DELETE /shop/checkout/cart/remove/{id} shop.checkout.cart.remove CartController::destroy",
                "GET /shop/checkout/onepage shop.checkout.onepage.index OnepageController::index",
                "POST /shop/checkout/onepage/orders shop.checkout.onepage.orders.store OnepageController::storeOrder",
                "GET /health - closure",
                "GET /hook - OnepageController::hook",
                "POST /hook - OnepageController::hook",
                "ANY /legacy - OnepageController::__invoke",
                "ANY /old - redirect /new",
                "GET /about - view pages.about",
            ]
        );
        assert_eq!(found[0].line, 8);
    }

    #[test]
    fn leaves_a_route_unnamed_when_only_its_group_has_a_name() {
        let found = routes("<?php\nRoute::name('admin.')->group(function () { Route::get('a', 'A@a'); Route::get('b', 'B@b')->name('b'); });\n");
        assert_eq!(found[0].name, None);
        assert_eq!(found[1].name.as_deref(), Some("admin.b"));
    }

    #[test]
    fn expands_a_resource_into_its_routes() {
        let found = routes(
            "<?php\nRoute::prefix('admin')->name('admin.')->group(function () {\n  Route::resource('photos.comments', 'Acme\\Admin\\CommentController')->only(['index', 'store', 'destroy']);\n  Route::apiResource('categories', CategoryController::class)->except(['destroy']);\n});\n",
        );
        let got: Vec<String> = found.iter().map(brief).collect();
        assert_eq!(
            got,
            [
                "GET /admin/photos/{photo}/comments admin.photos.comments.index CommentController::index",
                "POST /admin/photos/{photo}/comments admin.photos.comments.store CommentController::store",
                "DELETE /admin/photos/{photo}/comments/{comment} admin.photos.comments.destroy CommentController::destroy",
                "GET /admin/categories admin.categories.index CategoryController::index",
                "POST /admin/categories admin.categories.store CategoryController::store",
                "GET /admin/categories/{category} admin.categories.show CategoryController::show",
                "PUT /admin/categories/{category} admin.categories.update CategoryController::update",
            ]
        );
    }

    #[test]
    fn puts_string_controllers_under_the_group_namespace() {
        let found = routes(
            "<?php\nRoute::namespace('App\\Http\\Controllers')->group(function () { Route::get('a', 'AController@show'); Route::get('b', '\\Other\\BController@show'); });\n",
        );
        assert_eq!(found[0].action, Action::Controller("App\\Http\\Controllers\\AController".into(), "show".into()));
        assert_eq!(found[1].action, Action::Controller("Other\\BController".into(), "show".into()));
    }

    #[test]
    fn names_parameters_the_way_laravel_does() {
        assert_eq!(singular("photos"), "photo");
        assert_eq!(singular("categories"), "category");
        assert_eq!(singular("addresses"), "address");
        assert_eq!(singular("order-items"), "order_item");
        assert_eq!(params_of("/a/{b}/c/{d}"), ["b", "d"]);
    }
}
