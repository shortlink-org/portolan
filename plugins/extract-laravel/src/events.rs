//! Events, in the two ways a Laravel application says them, and who listens.
//!
//! A class under `Events/` - or using `Dispatchable` - is an event with a
//! payload: its promoted constructor parameters and public properties. A
//! string handed to `Event::dispatch('checkout.order.save.after', ...)` or
//! `event('...')` is an event too, one with a name and no declared shape;
//! leaving it out would hide most of what a package-built monolith
//! publishes. A named event belongs to the module that dispatches it.
//!
//! Listeners are read from every place Laravel accepts one: the `$listen`
//! and `$subscribe` tables of an event service provider, a subscriber's
//! `subscribe()` method, `Event::listen(...)` in a provider, and the
//! `handle(SomeEvent $e)` of a class under `Listeners/`, which Laravel
//! discovers on its own.

use std::collections::BTreeSet;
use std::path::PathBuf;

use crate::catalog::Field;
use crate::ids::{camel, short, slug};
use crate::source::{Base, Chain, ClassInfo, ClassKind, MethodInfo, SourceFile, Tree, Val, summary};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// A class: the key is its full name.
    Class,
    /// A string: the key is the string.
    Named,
}

#[derive(Debug, Clone)]
pub struct EventDecl {
    pub kind: Kind,
    pub key: String,
    /// `OrderPlaced`; `CheckoutOrderSaveAfter` for a named event.
    pub name: String,
    pub slug: String,
    pub module: usize,
    pub doc: String,
    pub source: PathBuf,
    pub fields: Vec<Field>,
}

#[derive(Debug, Clone)]
pub struct Listener {
    pub key: String,
    pub class: String,
    pub method: String,
    pub file: PathBuf,
    pub line: u32,
    pub module: usize,
}

#[derive(Debug, Default)]
pub struct Events {
    pub decls: Vec<EventDecl>,
    pub listeners: Vec<Listener>,
}

impl Events {
    pub fn decl(&self, key: &str) -> Option<&EventDecl> {
        self.decls.iter().find(|d| d.key == key)
    }
    pub fn listeners_of(&self, key: &str) -> Vec<&Listener> {
        self.listeners.iter().filter(|l| l.key == key).collect()
    }
    /// What an event is called on a page: its class name, or its string made a name.
    pub fn display(&self, key: &str) -> String {
        match self.decl(key) {
            Some(d) => d.name.clone(),
            None if key.contains('\\') => short(key).to_string(),
            None => camel(key),
        }
    }
}

pub fn is_event_class(file: &SourceFile, class: &ClassInfo) -> bool {
    class.kind == ClassKind::Class
        && !class.is_abstract
        // A job is dispatchable too, and is not an event.
        && !class.implements.iter().any(|i| short(i) == "ShouldQueue")
        && !file.has_segment("Jobs")
        && (file.has_segment("Events") || class.traits.iter().any(|t| short(t) == "Dispatchable"))
}

/// Everything the tree declares, dispatches and listens to. `modules` are
/// the module slugs by index, which is how a named event finds its owner.
pub fn read(tree: &Tree, modules: &[String]) -> Events {
    let mut events = Events::default();
    for (file, class) in tree.classes() {
        if !is_event_class(file, class) {
            continue;
        }
        events.decls.push(EventDecl {
            kind: Kind::Class,
            key: class.fqn.clone(),
            name: class.name.clone(),
            slug: slug(&class.name),
            module: file.module,
            doc: class.doc.clone(),
            source: file.path.clone(),
            fields: payload_of(class),
        });
    }
    // Named events, with every place each is dispatched from, in file order.
    let mut named: Vec<(String, Vec<(usize, PathBuf)>)> = Vec::new();
    for (file, chain, _) in every_chain(tree) {
        let Some(key) = dispatched(tree, chain) else { continue };
        if key.contains('\\') {
            continue;
        }
        match named.iter_mut().find(|(k, _)| *k == key) {
            Some((_, sites)) => sites.push((file.module, file.path.clone())),
            None => named.push((key, vec![(file.module, file.path.clone())])),
        }
    }
    for (key, sites) in named {
        let module = owner_of(&key, &sites, modules);
        let source = sites
            .iter()
            .find(|(m, _)| *m == module)
            .or(sites.first())
            .map(|(_, p)| p.clone())
            .unwrap_or_default();
        events.decls.push(EventDecl {
            kind: Kind::Named,
            key: key.clone(),
            name: camel(&key),
            slug: slug(&key),
            module,
            doc: String::new(),
            source,
            fields: vec![],
        });
    }
    events.listeners = read_listeners(tree, &events);
    events
}

/// Which module a named event belongs to. `sales.order.cancel.after` is
/// Sales's whoever dispatches it: the name says whose it is, in its first
/// segment or its second. When no segment names a module, it belongs to the
/// module that dispatches it most, the first of them when tied.
fn owner_of(key: &str, sites: &[(usize, PathBuf)], modules: &[String]) -> usize {
    for segment in key.split(['.', ':', '/']).take(2) {
        let segment = slug(segment);
        if let Some(i) = modules.iter().position(|m| *m == segment) {
            return i;
        }
    }
    let mut counts: Vec<(usize, usize)> = Vec::new();
    for (module, _) in sites {
        match counts.iter_mut().find(|(m, _)| m == module) {
            Some((_, n)) => *n += 1,
            None => counts.push((*module, 1)),
        }
    }
    counts.iter().max_by(|a, b| a.1.cmp(&b.1).then(b.0.cmp(&a.0))).map(|(m, _)| *m).unwrap_or(0)
}

/// The event's shape: promoted constructor parameters, then public properties.
fn payload_of(class: &ClassInfo) -> Vec<Field> {
    let mut out: Vec<Field> = Vec::new();
    if let Some(ctor) = class.constructor() {
        for p in ctor.params.iter().filter(|p| p.promoted) {
            out.push(Field {
                name: p.name.clone(),
                type_: if p.hint.is_empty() { "mixed".into() } else { p.hint.clone() },
                doc: String::new(),
            });
        }
    }
    for p in class.props.iter().filter(|p| p.public && !p.is_static) {
        if !out.iter().any(|f| f.name == p.name) {
            out.push(Field {
                name: p.name.clone(),
                type_: if p.hint.is_empty() { "mixed".into() } else { p.hint.clone() },
                doc: summary(&p.doc),
            });
        }
    }
    out
}

/// A chain, the file it is in, and the method when it is inside one.
pub type Site<'a> = (&'a SourceFile, &'a Chain, Option<(&'a ClassInfo, &'a MethodInfo)>);

/// Every chain in the tree, flattened, with the file and the method it sits in.
pub fn every_chain(tree: &Tree) -> Vec<Site<'_>> {
    let mut out = Vec::new();
    for file in &tree.files {
        let mut flat = Vec::new();
        for chain in &file.chains {
            chain.flatten(&mut flat);
        }
        out.extend(flat.into_iter().map(|c| (file, c, None)));
        for class in &file.classes {
            for method in &class.methods {
                let mut flat = Vec::new();
                for chain in &method.chains {
                    chain.flatten(&mut flat);
                }
                out.extend(flat.into_iter().map(|c| (file, c, Some((class, method)))));
            }
        }
    }
    out
}

/// The event a chain dispatches, when it is one of the ways Laravel says so:
/// `Event::dispatch(...)`, `event(...)`, `SomeEvent::dispatch(...)`.
pub fn dispatched(tree: &Tree, chain: &Chain) -> Option<String> {
    match &chain.base {
        Base::Static(class) if short(class) == "Event" => {
            let part = chain.parts.first()?;
            if !matches!(part.name.as_str(), "dispatch" | "fire" | "dispatchIf" | "dispatchUnless" | "dispatchSync") {
                return None;
            }
            event_key(part.args.as_ref()?.first()?)
        }
        Base::Func(name, args) if short(name) == "event" => event_key(args.first()?),
        Base::Static(class) => {
            let part = chain.parts.first()?;
            if !matches!(part.name.as_str(), "dispatch" | "dispatchIf" | "dispatchUnless" | "dispatchSync") || part.args.is_none() {
                return None;
            }
            let class_info = tree.class(class)?;
            let file = tree.file_of(class)?;
            if is_event_class(file, class_info) {
                Some(class_info.fqn.clone())
            } else {
                None
            }
        }
        _ => None,
    }
}

fn event_key(val: &Val) -> Option<String> {
    match val {
        Val::Str(s) => Some(s.clone()),
        Val::Chain(inner) => match &inner.base {
            Base::New(class, _) if !class.is_empty() => Some(class.clone()),
            _ => None,
        },
        _ => None,
    }
}

/// An event key as a listener table names it: a class or a string.
fn key_of(val: &Val) -> Option<String> {
    match val {
        Val::Str(s) => Some(s.clone()),
        Val::Class(c) => Some(c.clone()),
        _ => None,
    }
}

/// One key or a list of them: `Event::listen(['a', 'b'], ...)`.
fn keys_of(val: &Val) -> Vec<String> {
    match val {
        Val::Arr(items) => items.iter().filter_map(|(_, v)| key_of(v)).collect(),
        other => key_of(other).into_iter().collect(),
    }
}

/// The handlers a table names for one event: `Listener::class`,
/// `'Listener@method'`, `[Listener::class, 'method']`, or a list of those.
fn handlers_of(val: &Val) -> Vec<(String, String)> {
    match val {
        Val::Class(c) => vec![(c.clone(), "handle".into())],
        Val::Str(s) => match s.split_once('@') {
            Some((class, method)) => vec![(class.to_string(), method.to_string())],
            None => vec![(s.clone(), "handle".into())],
        },
        Val::Arr(items) => {
            let values: Vec<&Val> = items.iter().map(|(_, v)| v).collect();
            match (values.first(), values.get(1)) {
                (Some(Val::Class(c)), Some(Val::Str(m))) if items.iter().all(|(k, _)| k.is_none()) && values.len() == 2 => vec![(c.clone(), m.clone())],
                _ => values.iter().flat_map(|v| handlers_of(v)).collect(),
            }
        }
        _ => vec![],
    }
}

fn read_listeners(tree: &Tree, events: &Events) -> Vec<Listener> {
    let mut out: Vec<Listener> = Vec::new();
    let mut seen: BTreeSet<(String, String, String)> = BTreeSet::new();
    let mut add = |out: &mut Vec<Listener>, key: String, class: &str, method: &str, file: &SourceFile, line: u32| {
        let class = class.trim_start_matches('\\').to_string();
        if seen.insert((key.clone(), class.clone(), method.to_string())) {
            out.push(Listener {
                key,
                class,
                method: method.to_string(),
                file: file.path.clone(),
                line,
                module: file.module,
            });
        }
    };

    for (file, class) in tree.classes() {
        // `protected $listen = [Event::class => [Listener::class], 'name' => ['Class@method']]`
        if let Some(items) = class.prop("listen").and_then(|p| p.value.as_ref()).and_then(Val::as_arr) {
            for (key, handlers) in items {
                let Some(key) = key.as_ref().and_then(key_of) else { continue };
                for (handler, method) in handlers_of(handlers) {
                    add(&mut out, key.clone(), &handler, &method, file, class.line);
                }
            }
        }
        // `protected $subscribe = [Subscriber::class]`: the subscriber says what it listens to.
        if let Some(items) = class.prop("subscribe").and_then(|p| p.value.as_ref()).and_then(Val::as_arr) {
            for (_, subscriber) in items {
                let Some(name) = key_of(subscriber) else { continue };
                let Some(sub) = tree.class(&name) else { continue };
                let Some(sub_file) = tree.file_of(&name) else { continue };
                let Some(subscribe) = sub.method("subscribe") else { continue };
                let mut flat = Vec::new();
                for chain in &subscribe.chains {
                    chain.flatten(&mut flat);
                }
                for chain in flat {
                    let Some(part) = chain.parts.iter().find(|p| p.name == "listen" && p.args.as_ref().is_some_and(|a| a.len() >= 2)) else {
                        continue;
                    };
                    let args = part.args.as_ref().unwrap();
                    for key in keys_of(&args[0]) {
                        for (handler, method) in handlers_of(&args[1]) {
                            add(&mut out, key.clone(), &handler, &method, sub_file, part.line);
                        }
                        if matches!(args[1], Val::Closure(_)) {
                            add(&mut out, key.clone(), &sub.fqn, "closure", sub_file, part.line);
                        }
                    }
                }
                // Laravel 8+: `return ['event' => 'method']`.
                for returned in &subscribe.returns {
                    let Some(items) = returned.as_arr() else { continue };
                    for (key, method) in items {
                        let (Some(key), Some(method)) = (key.as_ref().and_then(key_of), method.as_str()) else {
                            continue;
                        };
                        add(&mut out, key, &sub.fqn, method, sub_file, subscribe.line);
                    }
                }
            }
        }
        // Laravel's own discovery: a listener's `handle(SomeEvent $event)`.
        if file.has_segment("Listeners") && class.kind == ClassKind::Class && !class.is_abstract {
            for method in class.methods.iter().filter(|m| m.public && matches!(m.name.as_str(), "handle" | "__invoke")) {
                let Some(event) = method.params.first().and_then(|p| p.class.as_deref()) else {
                    continue;
                };
                if events.decl(event).is_some() {
                    add(&mut out, event.to_string(), &class.fqn, &method.name, file, method.line);
                }
            }
        }
    }

    // `Event::listen('name', Listener::class)` wherever a provider puts it.
    for (file, chain, _) in every_chain(tree) {
        let Base::Static(class) = &chain.base else { continue };
        if short(class) != "Event" {
            continue;
        }
        let Some(part) = chain.parts.first() else { continue };
        if part.name != "listen" {
            continue;
        }
        let Some(args) = part.args.as_ref() else { continue };
        if args.len() < 2 {
            continue;
        }
        for key in keys_of(&args[0]) {
            for (handler, method) in handlers_of(&args[1]) {
                add(&mut out, key.clone(), &handler, &method, file, part.line);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree() -> Tree {
        Tree::from_sources(&[
            (
                "packages/Acme/Sales/src/Events/OrderPlaced.php",
                "<?php\nnamespace Acme\\Sales\\Events;\nuse Illuminate\\Foundation\\Events\\Dispatchable;\n/** The customer paid and the order is theirs. */\nclass OrderPlaced { use Dispatchable; public function __construct(public readonly Order $order, public int $total = 0) {} }\n",
            ),
            (
                "packages/Acme/Sales/src/Repositories/OrderRepository.php",
                "<?php\nnamespace Acme\\Sales\\Repositories;\nuse Illuminate\\Support\\Facades\\Event;\nuse Acme\\Sales\\Events\\OrderPlaced;\nclass OrderRepository {\n  public function create(array $data) {\n    Event::dispatch('checkout.order.save.before', [$data]);\n    $order = $this->model->create($data);\n    OrderPlaced::dispatch($order);\n    event(new OrderPlaced($order));\n    Event::dispatch('checkout.order.save.after', $order);\n    return $order;\n  }\n}\n",
            ),
            (
                "packages/Acme/Checkout/src/Providers/EventServiceProvider.php",
                "<?php\nnamespace Acme\\Checkout\\Providers;\nuse Acme\\Sales\\Events\\OrderPlaced;\nuse Acme\\Checkout\\Listeners\\ReserveStock;\nclass EventServiceProvider extends ServiceProvider {\n  protected $listen = [ OrderPlaced::class => [ReserveStock::class], 'checkout.order.save.after' => ['Acme\\Checkout\\Listeners\\Cleanup@onOrderSaved'] ];\n  protected $subscribe = [ 'Acme\\Checkout\\Listeners\\CustomerEventsHandler' ];\n}\n",
            ),
            (
                "packages/Acme/Checkout/src/Listeners/CustomerEventsHandler.php",
                "<?php\nnamespace Acme\\Checkout\\Listeners;\nclass CustomerEventsHandler {\n  public function onCustomerLogin($customer) {}\n  public function subscribe($events) {\n    $events->listen('customer.after.login', 'Acme\\Checkout\\Listeners\\CustomerEventsHandler@onCustomerLogin');\n  }\n}\n",
            ),
            (
                "packages/Acme/Checkout/src/Listeners/ReserveStock.php",
                "<?php\nnamespace Acme\\Checkout\\Listeners;\nuse Acme\\Sales\\Events\\OrderPlaced;\nclass ReserveStock { public function handle(OrderPlaced $event) {} }\n",
            ),
        ])
    }

    #[test]
    fn declares_class_and_named_events_where_they_are_dispatched() {
        let events = read(&tree(), &["checkout".into(), "sales".into()]);
        let keys: Vec<&str> = events.decls.iter().map(|d| d.key.as_str()).collect();
        assert_eq!(
            keys,
            ["Acme\\Sales\\Events\\OrderPlaced", "checkout.order.save.before", "checkout.order.save.after"]
        );
        // Dispatched from Sales, named for Checkout: the name wins.
        assert_eq!(events.decl("checkout.order.save.after").unwrap().module, 0);
        let placed = events.decl("Acme\\Sales\\Events\\OrderPlaced").unwrap();
        assert_eq!(placed.kind, Kind::Class);
        assert_eq!(summary(&placed.doc), "The customer paid and the order is theirs.");
        assert_eq!(
            placed.fields.iter().map(|f| (f.name.as_str(), f.type_.as_str())).collect::<Vec<_>>(),
            [("order", "Order"), ("total", "int")]
        );
        let after = events.decl("checkout.order.save.after").unwrap();
        assert_eq!(after.kind, Kind::Named);
        assert_eq!(after.name, "CheckoutOrderSaveAfter");
        assert_eq!(after.slug, "checkout-order-save-after");
    }

    #[test]
    fn gives_a_named_event_to_the_module_its_name_says_or_to_its_busiest_dispatcher() {
        let modules = vec!["admin".to_string(), "product".into(), "shop".into()];
        let sites = |ms: &[usize]| ms.iter().map(|m| (*m, PathBuf::new())).collect::<Vec<_>>();
        assert_eq!(owner_of("catalog.product.update.after", &sites(&[0]), &modules), 1);
        assert_eq!(owner_of("bagisto.shop.products.price.after", &sites(&[0]), &modules), 2);
        assert_eq!(owner_of("core.channel.update.after", &sites(&[2, 0, 2]), &modules), 2);
        assert_eq!(owner_of("core.channel.update.after", &sites(&[2, 0]), &modules), 0);
    }

    #[test]
    fn finds_listeners_in_every_place_laravel_accepts_one() {
        let events = read(&tree(), &["checkout".into(), "sales".into()]);
        let mut found: Vec<String> = events
            .listeners
            .iter()
            .map(|l| format!("{} -> {}::{}", l.key, short(&l.class), l.method))
            .collect();
        found.sort();
        assert_eq!(
            found,
            [
                "Acme\\Sales\\Events\\OrderPlaced -> ReserveStock::handle",
                "checkout.order.save.after -> Cleanup::onOrderSaved",
                "customer.after.login -> CustomerEventsHandler::onCustomerLogin",
            ]
        );
    }

    #[test]
    fn reads_every_dispatch_shape() {
        let t = tree();
        let repo = t.class("Acme\\Sales\\Repositories\\OrderRepository").unwrap();
        let mut flat = Vec::new();
        for chain in &repo.method("create").unwrap().chains {
            chain.flatten(&mut flat);
        }
        let keys: Vec<String> = flat.iter().filter_map(|c| dispatched(&t, c)).collect();
        assert_eq!(
            keys,
            [
                "checkout.order.save.before",
                "Acme\\Sales\\Events\\OrderPlaced",
                "Acme\\Sales\\Events\\OrderPlaced",
                "checkout.order.save.after"
            ]
        );
    }
}
