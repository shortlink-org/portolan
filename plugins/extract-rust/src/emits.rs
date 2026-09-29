//! What a use case can publish, read off the domain calls it makes.
//!
//!   pub fn place(…) -> Result<(Order, OrderPlaced), Error> { … }
//!
//!   pub async fn handle(&self, input: Input) -> Result<String, Error> {
//!       let (order, placed) = Order::place(…)?;
//!       self.orders.save(&order, &[&placed]).await
//!   }
//!
//! The domain says which of its functions produce which events: a root
//! method or a function of the aggregate's module produces the events its
//! return type names - by position, so `(Order, OrderPlaced)` under a
//! `Result` is one - and the events it builds in its body, `OrderPlaced { … }`,
//! `OrderPlaced::new(…)`, and whatever the functions and `self.` methods it
//! calls produce. The use case says which of those it calls. The event is the
//! domain's to name, and the use case only decides whether to run the method
//! that names it - so the operation emits what it reaches, whether or not a
//! branch keeps the result.
//!
//! An enum of events in a return type, `Vec<OrderEvent>`, names every event
//! the enum can hold and says nothing about which one a method makes, so it is
//! not read; the variants the body builds, `OrderEvent::Placed(OrderPlaced { … })`,
//! are.
//!
//! Calls are matched by name: a root method by its name on any receiver, or as
//! `Order::place`; a domain function through the `use` path that places it
//! in the aggregate's module. A port method that happens to share a name with
//! an emitting root method is read as that method; the names in a domain are
//! chosen to say what the aggregate does, and the collision is rare enough to
//! take.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use syn::visit::Visit;
use syn::{Expr, ImplItem, Item};

use crate::catalog::Event;
use crate::source::{Crate, Source, module_path, positions};

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Callee {
    Method(String),
    Func(String),
}

/// The emitting functions of one aggregate's module.
pub struct Emitters {
    root: String,
    /// `crate::domain::order`: what a use case's `use` must name for a
    /// function to be the domain's.
    module: String,
    /// Event struct name → event id.
    events: BTreeMap<String, String>,
    /// Event id → position in the aggregate.
    order: BTreeMap<String, usize>,
    /// A root method or a module function a use case can call → event ids.
    produce: BTreeMap<Callee, BTreeSet<String>>,
}

impl Emitters {
    /// Reads the root's impl blocks and the free functions in the aggregate
    /// directory's own files.
    pub fn read(krate: &Crate, dir: &Path, root: &str, events: &[Event]) -> Emitters {
        let mut e = Emitters {
            root: root.to_string(),
            module: module_path(&krate.root, &dir.join("mod.rs")),
            events: events.iter().map(|ev| (ev.name.clone(), ev.id.clone())).collect(),
            order: events.iter().enumerate().map(|(i, ev)| (ev.id.clone(), i)).collect(),
            produce: BTreeMap::new(),
        };
        if events.is_empty() {
            return e;
        }

        // Each function's own events and the domain functions it calls, then
        // the calls folded in until nothing changes: a method that records
        // through a private helper emits what the helper builds.
        let mut nodes: BTreeMap<Callee, Node> = BTreeMap::new();
        for src in krate.in_dir(dir) {
            for item in &src.file.items {
                let (key, vis, sig, block) = match item {
                    Item::Fn(f) => (Callee::Func(f.sig.ident.to_string()), &f.vis, &f.sig, &*f.block),
                    _ => continue,
                };
                nodes.insert(key, e.node(vis, sig, block));
            }
            for im in src.impls_of(root) {
                // A trait's methods are the trait's, not what the root does.
                if im.trait_.is_some() {
                    continue;
                }
                for item in &im.items {
                    if let ImplItem::Fn(m) = item {
                        nodes.insert(Callee::Method(m.sig.ident.to_string()), e.node(&m.vis, &m.sig, &m.block));
                    }
                }
            }
        }
        let mut changed = true;
        while changed {
            changed = false;
            let keys: Vec<Callee> = nodes.keys().cloned().collect();
            for key in keys {
                let mut reached = BTreeSet::new();
                for callee in &nodes[&key].calls {
                    if let Some(c) = nodes.get(callee) {
                        reached.extend(c.own.iter().cloned());
                    }
                }
                let own = &mut nodes.get_mut(&key).expect("the key was just listed").own;
                let before = own.len();
                own.extend(reached);
                changed |= own.len() != before;
            }
        }
        e.produce = nodes
            .into_iter()
            .filter(|(_, n)| n.callable && !n.own.is_empty())
            .map(|(k, n)| (k, n.own))
            .collect();
        e
    }

    fn node(&self, vis: &syn::Visibility, sig: &syn::Signature, block: &syn::Block) -> Node {
        let mut own: BTreeSet<String> = match &sig.output {
            syn::ReturnType::Type(_, ty) => positions(ty).iter().filter_map(|name| self.events.get(name).cloned()).collect(),
            syn::ReturnType::Default => BTreeSet::new(),
        };
        let mut reach = Reach {
            e: self,
            outside: None,
            built: BTreeSet::new(),
            calls: vec![],
        };
        reach.visit_block(block);
        own.extend(reach.built);
        Node {
            own,
            calls: reach.calls,
            // A private function is only reached through the ones that call
            // it; a use case cannot name it.
            callable: !matches!(vis, syn::Visibility::Inherited),
        }
    }

    /// What one use case's files reach: root methods by name, domain
    /// functions through a `use` of the aggregate's module, and events built
    /// in the use case itself. Empty when it reaches nothing.
    pub fn use_case_emits(&self, sources: &[&Source]) -> Vec<String> {
        if self.events.is_empty() {
            return vec![];
        }
        let mut found = BTreeSet::new();
        for src in sources {
            let mut reach = Reach {
                e: self,
                outside: Some(src),
                built: BTreeSet::new(),
                calls: vec![],
            };
            reach.visit_file(&src.file);
            found.extend(reach.built);
            for callee in &reach.calls {
                if let Some(ids) = self.produce.get(callee) {
                    found.extend(ids.iter().cloned());
                }
            }
        }
        let mut out: Vec<String> = found.into_iter().collect();
        out.sort_by_key(|id| self.order.get(id).copied().unwrap_or(usize::MAX));
        out
    }
}

/// One domain function: the events it produces and the domain functions it calls.
struct Node {
    own: BTreeSet<String>,
    calls: Vec<Callee>,
    callable: bool,
}

/// The events a body builds and the calls it makes. Inside the domain
/// (`outside` is None) a bare call is a sibling function and a method is one
/// on `self`; in a use case a function counts only when its `use` path puts it
/// in the aggregate's module, and a method on any receiver may be the root's.
struct Reach<'a> {
    e: &'a Emitters,
    outside: Option<&'a Source>,
    built: BTreeSet<String>,
    calls: Vec<Callee>,
}

impl Reach<'_> {
    fn event(&mut self, name: &str) -> bool {
        match self.e.events.get(name) {
            Some(id) => {
                self.built.insert(id.clone());
                true
            }
            None => false,
        }
    }
}

impl<'ast> Visit<'ast> for Reach<'_> {
    fn visit_expr_struct(&mut self, lit: &'ast syn::ExprStruct) {
        if let Some(last) = lit.path.segments.last() {
            self.event(&last.ident.to_string());
        }
        syn::visit::visit_expr_struct(self, lit);
    }

    fn visit_expr_call(&mut self, call: &'ast syn::ExprCall) {
        if let Expr::Path(p) = &*call.func {
            let segs: Vec<String> = p.path.segments.iter().map(|s| s.ident.to_string()).collect();
            let last = segs.last().cloned().unwrap_or_default();
            let owner = segs.len().checked_sub(2).map(|i| segs[i].as_str());
            // `OrderPlaced(…)` builds a tuple struct; `OrderPlaced::new(…)` a
            // constructor's.
            if !self.event(&last) && !owner.is_some_and(|o| self.event(o)) {
                match (owner, self.outside) {
                    (Some(o), _) if o == self.e.root => self.calls.push(Callee::Method(last)),
                    (Some("Self"), None) => self.calls.push(Callee::Method(last)),
                    (_, None) => {
                        // A path through modules - `rules::check`, `super::price` -
                        // or none; a type's associated function is the type's.
                        if segs[..segs.len() - 1].iter().all(|s| s.starts_with(|c: char| c.is_lowercase())) {
                            self.calls.push(Callee::Func(last));
                        }
                    }
                    (_, Some(src)) => {
                        let resolved = src.resolve_path(&segs.join("::"));
                        if resolved.strip_prefix(&self.e.module).is_some_and(|rest| rest == format!("::{last}")) {
                            self.calls.push(Callee::Func(last));
                        }
                    }
                }
            }
        }
        syn::visit::visit_expr_call(self, call);
    }

    fn visit_expr_method_call(&mut self, call: &'ast syn::ExprMethodCall) {
        let on_self = matches!(&*call.receiver, Expr::Path(p) if p.path.is_ident("self"));
        if self.outside.is_some() || on_self {
            self.calls.push(Callee::Method(call.method.to_string()));
        }
        syn::visit::visit_expr_method_call(self, call);
    }

    // `vec![OrderPlaced { … }]`: a macro's body is tokens to syn, read as
    // expressions when it is a list of them.
    fn visit_macro(&mut self, mac: &'ast syn::Macro) {
        if let Ok(args) = mac.parse_body_with(syn::punctuated::Punctuated::<Expr, syn::Token![,]>::parse_terminated) {
            for arg in &args {
                self.visit_expr(arg);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::Wire;

    fn event(name: &str) -> Event {
        Event {
            id: format!("shop.oms.order.{name}"),
            slug: String::new(),
            name: name.into(),
            versions: vec![],
            consumers: vec![],
            wire: Wire {
                name: String::new(),
                channel: None,
            },
        }
    }

    #[test]
    fn follows_the_domain_calls_a_use_case_makes() {
        let src = std::env::temp_dir().join(format!("extract-rust-emits-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&src);
        let domain = src.join("domain/order");
        let uc = src.join("application/order/usecases");
        for dir in [&domain, &uc.join("ship"), &uc.join("bump"), &uc.join("audit"), &uc.join("cancel")] {
            std::fs::create_dir_all(dir).unwrap();
        }
        std::fs::write(
            domain.join("order.rs"),
            r#"
            pub struct Order { pub id: String }
            impl Order {
                // By return type, the second place of a tuple under a Result.
                pub fn place(id: String) -> Result<(Order, OrderPlaced), Error> { todo!() }
                // Through a private helper that builds it inside a vec!.
                pub fn ship(&mut self) -> Vec<OrderEvent> { self.record() }
                fn record(&self) -> Vec<OrderEvent> { vec![OrderEvent::Shipped(OrderShipped { id: self.id.clone() })] }
                // Through a module function, transitively.
                pub fn bump(&mut self) { price(self) }
                pub fn lines(&self) -> usize { 0 }
            }
            pub fn price(o: &Order) { let _ = OrderRepriced::new(o.id.clone()); }
            fn private_cancel() -> OrderCancelled { todo!() }
            "#,
        )
        .unwrap();
        std::fs::write(
            uc.join("ship/mod.rs"),
            r#"
            use crate::domain::order::Order;
            pub struct UseCase;
            impl UseCase {
                pub fn handle(&self, mut o: Order) { let (_, _) = Order::place(String::new()).unwrap(); o.ship(); o.lines(); }
            }
            "#,
        )
        .unwrap();
        std::fs::write(
            uc.join("bump/mod.rs"),
            "use crate::domain::order;\npub struct UseCase;\nimpl UseCase { pub fn handle(&self, o: &order::Order) { order::price(o); } }\n",
        )
        .unwrap();
        // A function of the same name from elsewhere is not the domain's.
        std::fs::write(
            uc.join("audit/mod.rs"),
            "use crate::infrastructure::audit::price;\npub struct UseCase;\nimpl UseCase { pub fn handle(&self) { price(); } }\n",
        )
        .unwrap();
        // Built in the use case itself; a private domain function is out of reach.
        std::fs::write(
            uc.join("cancel/mod.rs"),
            "pub struct UseCase;\nimpl UseCase { pub fn handle(&self) { let _ = OrderCancelled { id: String::new() }; private_cancel(); } }\n",
        )
        .unwrap();

        let krate = Crate::load(&src);
        let events: Vec<Event> = ["OrderCancelled", "OrderPlaced", "OrderRepriced", "OrderShipped"]
            .into_iter()
            .map(event)
            .collect();
        let e = Emitters::read(&krate, &domain, "Order", &events);
        let emits = |name: &str| e.use_case_emits(&krate.under(&uc.join(name)));

        assert_eq!(emits("ship"), ["shop.oms.order.OrderPlaced", "shop.oms.order.OrderShipped"]);
        assert_eq!(emits("bump"), ["shop.oms.order.OrderRepriced"]);
        assert!(emits("audit").is_empty());
        assert_eq!(emits("cancel"), ["shop.oms.order.OrderCancelled"]);
        let _ = std::fs::remove_dir_all(&src);
    }
}
