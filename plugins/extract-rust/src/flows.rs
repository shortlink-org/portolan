//! Flows, read out of the same layout as everything else here, and the layout
//! is again the claim.
//!
//! Two things start one. An endpoint is somebody calling in, and the handler
//! says which use cases it runs and in what order. A policy is an event
//! arriving, and the type or the name it tests for says which. Everything
//! after that is the use case's own body: a field is a port, a call on that
//! port is a hop, and a value that a domain method handed back as an event is
//! what puts the event on the bus when a port is given it.
//!
//! Statements are read in source order. An `if` or a `match` becomes an alt
//! only when something happens inside it, and its branch is terminal when the
//! block ends in a return, an `Err`, or a `bail!`. A loop is a note on the
//! steps inside it. `?` and `.await` are transparent. Nothing is observed
//! running, so every step is declared; a call whose peer the manifest does not
//! name is unresolved.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use syn::{Expr, ItemStruct, Pat, Stmt};

use crate::catalog::{Alt, AltBranch, Flow, FlowNode, Participant, RpcCall, Step};
use crate::clients::{RpcHop, adapter_calls};
use crate::domain::AggregateRead;
use crate::ids::{camel, event_id, sentence, slug};
use crate::operations::{UseCase, doc_of_use_case, ports_of, use_case_key_of_module};
use crate::protocol::Builder;
use crate::source::{Crate, Source, bare_type, doc_of, first_paragraph, is_public, methods, positions, span_of};
use crate::transport::Endpoint;
use crate::wiring::Binding;

pub const LANE_CLIENT: &str = "client";
pub const LANE_BUS: &str = "bus";
const MAX_INLINE: usize = 2;

pub struct FlowOptions {
    pub context: String,
    pub svc_id: String,
    pub service: String,
    pub store: String,
    pub peers: BTreeMap<String, String>,
    /// Module path of another service's events → the aggregate id they belong to.
    pub events: BTreeMap<String, String>,
}

/// What a value holds, when it is an event or a domain object.
#[derive(Debug, Clone, Default)]
struct DomainRef {
    name: String,
    event: Option<String>,
    aggregate: Option<usize>,
    /// What a list the use case is collecting has been given.
    items: Option<Vec<DomainRef>>,
}

/// What one body is being read against.
struct Scope<'a> {
    src: &'a Source,
    key: String,
    /// The struct whose methods `self.<helper>()` reaches.
    strukt: String,
    /// Port name → trait as declared.
    ports: BTreeMap<String, String>,
    vars: BTreeMap<String, DomainRef>,
}

#[derive(Default)]
struct Draft {
    lanes: Vec<Participant>,
    steps: Vec<FlowNode>,
    sinks: Vec<Vec<FlowNode>>,
    n: usize,
    seen: BTreeSet<String>,
    loops: Vec<String>,
}

impl Draft {
    fn lane(&mut self, p: Participant) -> String {
        if !self.lanes.iter().any(|l| l.id == p.id) {
            self.lanes.push(p.clone());
        }
        p.id
    }
    fn sink(&mut self) -> &mut Vec<FlowNode> {
        self.sinks.last_mut().unwrap_or(&mut self.steps)
    }
    fn push(&mut self) {
        self.sinks.push(vec![]);
    }
    fn pop(&mut self) -> Vec<FlowNode> {
        self.sinks.pop().unwrap_or_default()
    }
    fn note(&self, own: &str) -> Option<String> {
        let mut seen = BTreeSet::new();
        let loops: Vec<&str> = self.loops.iter().map(String::as_str).filter(|l| !l.is_empty() && seen.insert(*l)).collect();
        let prefix = if loops.is_empty() { String::new() } else { format!("{}.", loops.join(", ")) };
        let text = format!("{prefix} {own}").trim().to_string();
        if text.is_empty() { None } else { Some(text) }
    }
    #[allow(clippy::too_many_arguments)]
    fn add(&mut self, from: &str, to: &str, kind: &str, label: &str, status: &str, reference: Option<String>, note: &str, line: Option<String>) {
        self.n += 1;
        let step = Step {
            id: format!("s{}", self.n),
            from: from.into(),
            to: to.into(),
            kind: kind.into(),
            label: label.into(),
            status: status.into(),
            reference,
            note: self.note(note),
            line,
        };
        self.sink().push(FlowNode::Step(step));
    }
    fn add_alt(&mut self, branches: Vec<AltBranch>) {
        self.n += 1;
        let alt = Alt {
            id: format!("alt{}", self.n),
            branches,
        };
        self.sink().push(FlowNode::Alt(alt));
    }
}

pub struct FlowReader<'a> {
    pub opts: FlowOptions,
    krate: &'a Crate,
    use_cases: &'a [UseCase<'a>],
    bindings: &'a BTreeMap<String, Vec<Binding>>,
    aggregates: &'a [AggregateRead],
    rel: &'a dyn Fn(&Path) -> String,
    b: &'a mut Builder,
    calls: BTreeMap<String, RpcCall>,
    pub referenced: BTreeSet<String>,
    warned_store: bool,
    warned_peer: BTreeSet<String>,
}

impl<'a> FlowReader<'a> {
    pub fn new(
        opts: FlowOptions,
        krate: &'a Crate,
        use_cases: &'a [UseCase<'a>],
        bindings: &'a BTreeMap<String, Vec<Binding>>,
        aggregates: &'a [AggregateRead],
        rel: &'a dyn Fn(&Path) -> String,
        b: &'a mut Builder,
    ) -> Self {
        FlowReader {
            opts,
            krate,
            use_cases,
            bindings,
            aggregates,
            rel,
            b,
            calls: BTreeMap::new(),
            referenced: BTreeSet::new(),
            warned_store: false,
            warned_peer: BTreeSet::new(),
        }
    }

    fn service_lane(&self) -> Participant {
        Participant {
            id: self.opts.svc_id.clone(),
            kind: "service".into(),
            context: Some(self.opts.context.clone()),
            label: None,
        }
    }
    fn bus_lane(&self) -> Participant {
        Participant {
            id: LANE_BUS.into(),
            kind: "broker".into(),
            context: None,
            label: None,
        }
    }
    fn store_lane(&mut self, d: &mut Draft) -> String {
        if self.opts.store.is_empty() {
            if !self.warned_store {
                self.b.warn(
                    &self.opts.svc_id,
                    "no store named in the options, so repository calls stay on the service's own lane",
                );
                self.warned_store = true;
            }
            return self.opts.svc_id.clone();
        }
        d.lane(Participant {
            id: format!("{}-{}", self.opts.service, self.opts.store),
            kind: "store".into(),
            context: Some(self.opts.context.clone()),
            label: None,
        })
    }
    fn peer_lane(&mut self, d: &mut Draft, pkg: &str) -> (String, String, String) {
        if let Some(service) = self.opts.peers.get(pkg).cloned() {
            let context = service.split('.').next().unwrap_or_default().to_string();
            let lane = d.lane(Participant {
                id: service.clone(),
                kind: "service".into(),
                context: Some(context),
                label: None,
            });
            return (lane, service, "declared".into());
        }
        if self.warned_peer.insert(pkg.to_string()) {
            self.b.warn(&self.opts.svc_id, format!("calls {pkg} and the manifest names no peer for that package; add it under `peers` to say which service answers, until then the calls are unresolved"));
        }
        let lane = d.lane(Participant {
            id: pkg.replace('.', "-"),
            kind: "unknown".into(),
            context: None,
            label: Some(pkg.to_string()),
        });
        (lane, pkg.to_string(), "unresolved".into())
    }

    pub fn consumes(&self) -> Vec<RpcCall> {
        self.calls.values().cloned().collect()
    }

    // --- the two openings -----------------------------------------------------

    pub fn endpoint_flow(&mut self, endpoint: &Endpoint) -> Flow {
        let mut d = Draft::default();
        d.lane(Participant {
            id: LANE_CLIENT.into(),
            kind: "actor".into(),
            context: None,
            label: None,
        });
        let me = d.lane(self.service_lane());
        d.add(LANE_CLIENT, &me, "rpc", &endpoint.id, "declared", None, "", Some(endpoint.line.clone()));
        for key in &endpoint.use_cases {
            self.walk_use_case(&mut d, key, 0);
        }
        let summary = endpoint
            .use_cases
            .last()
            .and_then(|k| self.use_cases.iter().find(|u| u.key == *k))
            .map(doc_of_use_case)
            .unwrap_or_default();
        let name = slug(&endpoint.id);
        let id = format!("{}-{name}", self.opts.service);
        Flow {
            id: format!("flow.{id}"),
            slug: id,
            name: sentence(&name),
            summary,
            source: endpoint.source.clone(),
            owner: self.opts.context.clone(),
            participants: d.lanes,
            steps: d.steps,
        }
    }

    pub fn policy_flows(&mut self, policy_dir: &Path) -> Vec<Flow> {
        let mut out = Vec::new();
        let sources: Vec<&'a Source> = self.krate.in_dir(policy_dir);
        for src in sources {
            let structs: Vec<&'a ItemStruct> = src.structs().filter(|s| is_public(&s.vis)).collect();
            for st in structs {
                let name = st.ident.to_string();
                let Some(handle) = src.method(&name, "handle") else { continue };
                let Some(trigger) = self.asserted_event(src, handle) else {
                    self.b.warn(
                        &name,
                        format!(
                            "{}: {name}.handle tests for no event; the policy is not paired with what triggers it",
                            (self.rel)(&src.path)
                        ),
                    );
                    continue;
                };
                let mut d = Draft::default();
                let bus = d.lane(self.bus_lane());
                let me = d.lane(self.service_lane());
                let line = Some(src.at(span_of(&handle.sig), self.rel));
                let mut vars = BTreeMap::new();
                if let Some(param) = event_param(handle) {
                    vars.insert(
                        param,
                        DomainRef {
                            name: trigger.name.clone(),
                            event: trigger.id.clone(),
                            aggregate: None,
                            items: None,
                        },
                    );
                }
                match (&trigger.id, &trigger.foreign) {
                    (Some(id), _) => {
                        d.add(&bus, &me, "event", &trigger.name, "declared", Some(id.clone()), "", line);
                        self.referenced.insert(id.clone());
                    }
                    (None, Some(foreign)) if foreign.contains("::") => {
                        self.b.warn(&name, format!("{}: {name}.handle reacts to {} from {foreign}, an event this repository does not declare and the manifest's `events` does not place; the step is unresolved", (self.rel)(&src.path), trigger.name));
                        d.add(
                            &bus,
                            &me,
                            "event",
                            &trigger.name,
                            "unresolved",
                            None,
                            &format!("Reacts to `{}` from `{foreign}`, which is not an event this repository declares.", trigger.name),
                            line,
                        );
                    }
                    (None, Some(wire)) => {
                        self.b.warn(&name, format!("{}: {name}.handle reacts to the message named \"{wire}\", which no event this repository declares is called; the step is unresolved", (self.rel)(&src.path)));
                        d.add(
                            &bus,
                            &me,
                            "event",
                            &trigger.name,
                            "unresolved",
                            None,
                            &format!("Reacts to the message named `{wire}`, which is not an event this repository declares."),
                            line,
                        );
                    }
                    (None, None) => {}
                }
                let scope = Scope {
                    src,
                    key: format!("policy/{name}"),
                    strukt: name.clone(),
                    ports: ports_of(st),
                    vars,
                };
                let mut scope = scope;
                self.walk_block(&mut d, &mut scope, &handle.block, 0);
                let id = format!("{}-{}", self.opts.service, slug(&name));
                out.push(Flow {
                    id: format!("flow.{id}"),
                    slug: id,
                    name: sentence(&slug(&name)),
                    summary: first_paragraph(&doc_of(&st.attrs)),
                    source: (self.rel)(&src.path),
                    owner: self.opts.context.clone(),
                    participants: d.lanes,
                    steps: d.steps,
                });
            }
        }
        out
    }

    /// The event a policy reacts to: the type of `handle`'s event parameter
    /// when it is one, else the string it tests the message's name against -
    /// `== "…"`, `!= "…"`, or a `match` arm.
    fn asserted_event(&self, src: &Source, handle: &syn::ImplItemFn) -> Option<Trigger> {
        for input in &handle.sig.inputs {
            let syn::FnArg::Typed(pt) = input else { continue };
            let bare = bare_type(&pt.ty);
            if bare.is_empty() || matches!(bare.as_str(), "Message" | "String" | "str" | "Value" | "Vec" | "u8") {
                continue;
            }
            let written = crate::source::type_text(&pt.ty);
            let path = written
                .split(['<', '>', '&', ' '])
                .find(|p| p.ends_with(&bare))
                .unwrap_or(&bare)
                .trim_start_matches("dyn ")
                .to_string();
            let full = src.resolve_path(&path);
            for agg in self.aggregates {
                if let Some(id) = agg.events.get(&bare)
                    && self.krate.declaring(&bare, Some(&full)).is_some_and(|s| s.path.starts_with(&agg.dir))
                {
                    return Some(Trigger {
                        name: bare,
                        id: Some(id.clone()),
                        foreign: None,
                    });
                }
            }
            let module = full.strip_suffix(&format!("::{bare}")).unwrap_or(&full).to_string();
            if let Some(aggregate) = self.opts.events.get(&module) {
                return Some(Trigger {
                    name: bare.clone(),
                    id: Some(event_id(aggregate, &bare)),
                    foreign: None,
                });
            }
            if full.contains("::") {
                return Some(Trigger {
                    name: bare,
                    id: None,
                    foreign: Some(module),
                });
            }
        }
        let mut literals = Vec::new();
        collect_compared_literals(&handle.block, &mut literals);
        let wire = literals.into_iter().next()?;
        for agg in self.aggregates {
            if let Some(ev) = agg.aggregate.events.iter().find(|e| e.wire.name == wire) {
                return Some(Trigger {
                    name: ev.name.clone(),
                    id: Some(ev.id.clone()),
                    foreign: None,
                });
            }
        }
        let name = wire.rsplit('.').next().unwrap_or(&wire).to_string();
        Some(Trigger {
            name,
            id: None,
            foreign: Some(wire),
        })
    }

    // --- reading one use case ---------------------------------------------------

    fn walk_use_case(&mut self, d: &mut Draft, key: &str, depth: usize) {
        if depth > MAX_INLINE || !d.seen.insert(key.to_string()) {
            return;
        }
        let Some(uc) = self.use_cases.iter().find(|u| u.key == key) else { return };
        let src = uc.source;
        let Some(handle) = src.method("UseCase", "handle") else { return };
        let mut scope = Scope {
            src,
            key: key.to_string(),
            strukt: "UseCase".into(),
            ports: uc.ports.clone(),
            vars: BTreeMap::new(),
        };
        self.walk_block(d, &mut scope, &handle.block, depth);
    }

    fn walk_block(&mut self, d: &mut Draft, s: &mut Scope<'a>, block: &'a syn::Block, depth: usize) {
        for stmt in &block.stmts {
            self.walk_stmt(d, s, stmt, depth);
        }
    }

    fn walk_stmt(&mut self, d: &mut Draft, s: &mut Scope<'a>, stmt: &'a Stmt, depth: usize) {
        match stmt {
            Stmt::Local(local) => {
                if let Some(init) = &local.init {
                    self.walk_expr(d, s, &init.expr, Some(&local.pat), depth);
                    if let Some((_, diverge)) = &init.diverge {
                        self.walk_expr(d, s, diverge, None, depth);
                    }
                }
            }
            Stmt::Expr(e, _) => self.walk_expr(d, s, e, None, depth),
            Stmt::Macro(m) => self.walk_macro(d, s, &m.mac, None, depth),
            Stmt::Item(_) => {}
        }
    }

    fn walk_expr(&mut self, d: &mut Draft, s: &mut Scope<'a>, expr: &'a Expr, lhs: Option<&'a Pat>, depth: usize) {
        match expr {
            Expr::If(e) => self.walk_if(d, s, e, depth),
            Expr::Match(e) => self.walk_match(d, s, e, depth),
            Expr::ForLoop(e) => {
                self.walk_expr(d, s, &e.expr, None, depth);
                self.bind_element(s, &e.pat, &e.expr);
                d.loops.push(format!("inside a loop over `{}`", s.src.text_of(span_of(&*e.expr))));
                self.walk_block(d, s, &e.body, depth);
                d.loops.pop();
            }
            Expr::While(e) => {
                self.walk_expr(d, s, &e.cond, None, depth);
                d.loops.push(format!("inside a loop, while `{}`", s.src.text_of(span_of(&*e.cond))));
                self.walk_block(d, s, &e.body, depth);
                d.loops.pop();
            }
            Expr::Loop(e) => {
                d.loops.push("inside a loop".into());
                self.walk_block(d, s, &e.body, depth);
                d.loops.pop();
            }
            Expr::Block(e) => self.walk_block(d, s, &e.block, depth),
            Expr::Unsafe(e) => self.walk_block(d, s, &e.block, depth),
            Expr::Async(e) => self.walk_block(d, s, &e.block, depth),
            Expr::Await(e) => self.walk_expr(d, s, &e.base, lhs, depth),
            Expr::Try(e) => self.walk_expr(d, s, &e.expr, lhs, depth),
            Expr::Paren(e) => self.walk_expr(d, s, &e.expr, lhs, depth),
            Expr::Group(e) => self.walk_expr(d, s, &e.expr, lhs, depth),
            Expr::Reference(e) => self.walk_expr(d, s, &e.expr, lhs, depth),
            Expr::Unary(e) => self.walk_expr(d, s, &e.expr, lhs, depth),
            Expr::Cast(e) => self.walk_expr(d, s, &e.expr, lhs, depth),
            Expr::Return(e) => {
                if let Some(inner) = &e.expr {
                    self.walk_expr(d, s, inner, None, depth);
                }
            }
            Expr::Break(e) => {
                if let Some(inner) = &e.expr {
                    self.walk_expr(d, s, inner, None, depth);
                }
            }
            Expr::Let(e) => self.walk_expr(d, s, &e.expr, Some(&e.pat), depth),
            Expr::Assign(e) => {
                let results = self.results_of_expr(s, &e.right);
                if let (Expr::Path(p), Some(first)) = (&*e.left, results.first())
                    && let (Some(id), true) = (p.path.get_ident(), !first.name.is_empty())
                {
                    s.vars.insert(id.to_string(), first.clone());
                }
                self.walk_expr(d, s, &e.right, None, depth);
            }
            Expr::Closure(e) => self.walk_expr(d, s, &e.body, None, depth),
            Expr::Macro(e) => self.walk_macro(d, s, &e.mac, lhs, depth),
            Expr::MethodCall(call) => {
                self.method_call(d, s, call, lhs, depth);
                for arg in &call.args {
                    self.walk_expr(d, s, arg, None, depth);
                }
            }
            Expr::Call(call) => {
                self.path_call(s, call, lhs);
                self.walk_expr(d, s, &call.func, None, depth);
                for arg in &call.args {
                    self.walk_expr(d, s, arg, None, depth);
                }
            }
            Expr::Binary(e) => {
                self.walk_expr(d, s, &e.left, None, depth);
                self.walk_expr(d, s, &e.right, None, depth);
            }
            Expr::Tuple(e) => {
                for el in &e.elems {
                    self.walk_expr(d, s, el, None, depth);
                }
            }
            Expr::Array(e) => {
                for el in &e.elems {
                    self.walk_expr(d, s, el, None, depth);
                }
            }
            Expr::Struct(e) => {
                for f in &e.fields {
                    self.walk_expr(d, s, &f.expr, None, depth);
                }
            }
            Expr::Index(e) => {
                self.walk_expr(d, s, &e.expr, None, depth);
                self.walk_expr(d, s, &e.index, None, depth);
            }
            Expr::Field(e) => self.walk_expr(d, s, &e.base, None, depth),
            Expr::Range(e) => {
                if let Some(x) = &e.start {
                    self.walk_expr(d, s, x, None, depth);
                }
                if let Some(x) = &e.end {
                    self.walk_expr(d, s, x, None, depth);
                }
            }
            Expr::Path(p) => {
                // `let placed = event;` — a bare name hands on what it held.
                if let (Some(lhs), Some(id)) = (lhs, p.path.get_ident())
                    && let Some(held) = s.vars.get(&id.to_string()).cloned()
                {
                    bind(s, lhs, &[held]);
                }
            }
            _ => {}
        }
    }

    /// `vec![a, b]` is a list holding what its elements hold; `bail!` and the rest are nothing.
    fn walk_macro(&mut self, d: &mut Draft, s: &mut Scope<'a>, mac: &'a syn::Macro, lhs: Option<&'a Pat>, depth: usize) {
        let name = mac.path.segments.last().map(|x| x.ident.to_string()).unwrap_or_default();
        if name != "vec" {
            return;
        }
        // The elements are parsed once and kept for the lifetime of the run:
        // the walker hands references around, and a parse on the stack would
        // not outlive this call.
        let parsed: &'a syn::punctuated::Punctuated<Expr, syn::Token![,]> = Box::leak(Box::new(
            mac.parse_body_with(syn::punctuated::Punctuated::<Expr, syn::Token![,]>::parse_terminated)
                .unwrap_or_default(),
        ));
        let mut items = Vec::new();
        for el in parsed.iter() {
            for r in self.results_of_expr(s, el) {
                if r.event.is_some() {
                    items.push(r);
                }
            }
            self.walk_expr(d, s, el, None, depth);
        }
        if let Some(lhs) = lhs {
            let list = DomainRef {
                name: "vec".into(),
                event: None,
                aggregate: None,
                items: Some(items),
            };
            bind(s, lhs, &[list]);
        }
    }

    fn walk_if(&mut self, d: &mut Draft, s: &mut Scope<'a>, stmt: &'a syn::ExprIf, depth: usize) {
        let mut branches = Vec::new();
        let mut titles = BTreeSet::new();
        let mut drew = false;
        let mut current = stmt;
        loop {
            self.walk_expr(d, s, &current.cond, None, depth);
            d.push();
            self.walk_block(d, s, &current.then_branch, depth);
            let steps = d.pop();
            drew |= !steps.is_empty();
            branches.push(AltBranch {
                title: unique(&s.src.text_of(span_of(&*current.cond)), &mut titles),
                steps,
                terminal: Some(leaves_block(&current.then_branch)),
            });
            let Some((_, els)) = &current.else_branch else {
                branches.push(AltBranch {
                    title: unique("otherwise", &mut titles),
                    steps: vec![],
                    terminal: None,
                });
                break;
            };
            match &**els {
                Expr::If(next) => {
                    current = next;
                    continue;
                }
                other => {
                    d.push();
                    self.walk_expr(d, s, other, None, depth);
                    let else_steps = d.pop();
                    drew |= !else_steps.is_empty();
                    let terminal = match other {
                        Expr::Block(b) => leaves_block(&b.block),
                        e => leaves_expr(e),
                    };
                    branches.push(AltBranch {
                        title: unique("otherwise", &mut titles),
                        steps: else_steps,
                        terminal: Some(terminal),
                    });
                    break;
                }
            }
        }
        if !drew {
            return;
        }
        d.add_alt(unmark_if_all_leave(branches));
    }

    fn walk_match(&mut self, d: &mut Draft, s: &mut Scope<'a>, stmt: &'a syn::ExprMatch, depth: usize) {
        self.walk_expr(d, s, &stmt.expr, None, depth);
        let subject = s.src.text_of(span_of(&*stmt.expr));
        let mut branches = Vec::new();
        let mut titles = BTreeSet::new();
        let mut drew = false;
        let mut saw_default = false;
        for arm in &stmt.arms {
            if let Some((_, guard)) = &arm.guard {
                self.walk_expr(d, s, guard, None, depth);
            }
            d.push();
            self.walk_expr(d, s, &arm.body, None, depth);
            let steps = d.pop();
            drew |= !steps.is_empty();
            let wild = matches!(arm.pat, Pat::Wild(_));
            let title = if wild {
                "otherwise".to_string()
            } else {
                format!("{subject} is {}", s.src.text_of(span_of(&arm.pat)))
            };
            if wild {
                saw_default = true;
            }
            let terminal = match &*arm.body {
                Expr::Block(b) => leaves_block(&b.block),
                e => leaves_expr(e),
            };
            branches.push(AltBranch {
                title: unique(&title, &mut titles),
                steps,
                terminal: Some(terminal),
            });
        }
        if !drew {
            return;
        }
        if !saw_default {
            branches.push(AltBranch {
                title: unique("otherwise", &mut titles),
                steps: vec![],
                terminal: None,
            });
        }
        d.add_alt(unmark_if_all_leave(branches));
    }

    /// `self.<port>.<method>(…)` is a hop; `self.<helper>(…)` is followed into
    /// the method; `x.push(…)` collects; `order.confirm(…)` on something the
    /// domain handed over binds what it hands back.
    fn method_call(&mut self, d: &mut Draft, s: &mut Scope<'a>, call: &'a syn::ExprMethodCall, lhs: Option<&'a Pat>, depth: usize) {
        let method = call.method.to_string();
        let receiver = unwrap_expr(&call.receiver);
        // self.<port>.<method>(…)
        if let Some(port) = self_field(receiver) {
            if let Some(declared) = s.ports.get(&port).cloned() {
                self.port_call(d, s, &port, &declared, &method, call, lhs, depth);
            }
            return;
        }
        // self.<helper>(…)
        if is_self(receiver) {
            let strukt = s.strukt.clone();
            if let Some(helper) = s.src.method(&strukt, &method) {
                self.walk_block(d, s, &helper.block, depth);
            }
            return;
        }
        if let Expr::Path(p) = receiver
            && let Some(id) = p.path.get_ident()
        {
            let name = id.to_string();
            // events.push(order.confirm(…)?) — a list the use case collects.
            if method == "push" {
                let mut list = s.vars.get(&name).cloned().unwrap_or(DomainRef {
                    name: name.clone(),
                    ..Default::default()
                });
                let mut items = list.items.take().unwrap_or_default();
                for arg in &call.args {
                    for r in self.results_of_expr(s, arg) {
                        if r.event.is_some() {
                            items.push(r);
                        }
                    }
                }
                list.items = Some(items);
                s.vars.insert(name, list);
                return;
            }
            // order.confirm(…) — a method on something the domain handed over.
            if let Some(held) = s.vars.get(&name).cloned()
                && held.aggregate.is_some()
            {
                let results = self.results_of_method(&held, &method);
                if let Some(lhs) = lhs {
                    bind(s, lhs, &results);
                }
            }
        }
    }

    /// `Order::place(…)` — an associated function on a domain struct; `Ok(x)`, `Some(x)` — a wrapper round a value.
    fn path_call(&mut self, s: &mut Scope<'a>, call: &'a syn::ExprCall, lhs: Option<&'a Pat>) {
        let Some(lhs) = lhs else { return };
        let results = self.results_of_expr(s, &Expr::Call(call.clone()));
        if !results.is_empty() {
            bind(s, lhs, &results);
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn port_call(
        &mut self,
        d: &mut Draft,
        s: &mut Scope<'a>,
        port: &str,
        declared: &str,
        method: &str,
        call: &'a syn::ExprMethodCall,
        lhs: Option<&'a Pat>,
        depth: usize,
    ) {
        let src = s.src;
        let line = Some(src.at(span_of(call), self.rel));
        let full = src.resolve(declared);
        let declaring = self.krate.declaring(declared, Some(&full));

        // A port bound at assembly to an adapter over a client: `impl Port for Adapter`.
        let owner = declaring.and_then(|dsrc| use_case_key_of_module(&dsrc.module)).unwrap_or_else(|| s.key.clone());
        let bound: Vec<Binding> = self.bindings.get(&format!("{owner}.{declared}")).cloned().unwrap_or_default();
        if !bound.is_empty() {
            for adapter in &bound {
                let Some(adapter_src) = self.krate.get(&adapter.file) else { continue };
                let hops = adapter_calls(adapter_src, &adapter.strukt, method, self.rel, self.b);
                if hops.is_empty() {
                    continue;
                }
                for hop in hops {
                    self.rpc_hop(d, &hop, line.clone());
                }
                return;
            }
            let names: Vec<String> = bound.iter().map(|a| format!("{}.{method}", a.strukt)).collect();
            self.b.warn(
                &s.key,
                format!(
                    "port `{declared}` is adapted by {}, which calls no peer; the call is left out of the flow",
                    names.join(" and by ")
                ),
            );
            return;
        }

        // A port that is another use case outright.
        if let Some(key) = use_case_key_of_module(&full) {
            self.use_case_hop(d, &key, "", line, depth);
            return;
        }

        // A port of the domain: the store is at the other end of it.
        let Some(agg_index) = declaring.and_then(|dsrc| self.aggregates.iter().position(|a| dsrc.path.starts_with(&a.dir))) else {
            self.b.warn(
                &s.key,
                format!(
                    "{}: port `{port}: {declared}` is neither a domain port, a use case nor a client; its calls are left out of the flow",
                    (self.rel)(&src.path)
                ),
            );
            return;
        };
        let store = self.store_lane(d);
        let me = self.opts.svc_id.clone();
        d.add(&me, &store, "call", method, "declared", None, "", line.clone());

        // An event handed to the port - the value itself, not a field read off
        // one - is the event leaving for the bus. What carries it there, an
        // outbox, a relay, is the adapter's business and not a step the source
        // can show.
        let mut handed = BTreeSet::new();
        for arg in &call.args {
            for held in self.handed(s, arg) {
                let items = held.items.clone().unwrap_or_else(|| vec![held.clone()]);
                for item in items {
                    let Some(ev) = &item.event else { continue };
                    if !handed.insert(ev.clone()) {
                        continue;
                    }
                    let bus = d.lane(self.bus_lane());
                    d.add(&me, &bus, "event", &item.name, "declared", Some(ev.clone()), "", line.clone());
                    self.referenced.insert(ev.clone());
                }
            }
        }

        // What the port handed back: `let order = self.orders.by_id(…).await?` holds an Order.
        if let Some(lhs) = lhs {
            let results = self.results_of_port_method(declaring, agg_index, declared, method);
            bind(s, lhs, &results);
        }
    }

    /// The values an argument hands to a port: a name, `&name`, `&[a, b]`, `vec![a]`, `&events`.
    fn handed(&mut self, s: &Scope<'a>, arg: &'a Expr) -> Vec<DomainRef> {
        match unwrap_expr(arg) {
            Expr::Path(p) => p.path.get_ident().and_then(|id| s.vars.get(&id.to_string()).cloned()).into_iter().collect(),
            Expr::Array(a) => a.elems.iter().flat_map(|e| self.handed(s, e)).collect(),
            Expr::Macro(m) if m.mac.path.segments.last().is_some_and(|x| x.ident == "vec") => {
                let parsed = m
                    .mac
                    .parse_body_with(syn::punctuated::Punctuated::<Expr, syn::Token![,]>::parse_terminated)
                    .unwrap_or_default();
                parsed.iter().flat_map(|e| self.results_of_expr(s, e)).collect()
            }
            Expr::MethodCall(c) if matches!(c.method.to_string().as_str(), "clone" | "as_slice" | "iter" | "into_iter") => self.handed(s, &c.receiver),
            _ => vec![],
        }
    }

    fn use_case_hop(&mut self, d: &mut Draft, target: &str, note: &str, line: Option<String>, depth: usize) {
        let me = self.opts.svc_id.clone();
        let label = camel(target.split('/').nth(1).unwrap_or(target));
        d.add(&me, &me, "call", &label, "declared", None, note, line);
        self.walk_use_case(d, target, depth + 1);
    }

    fn rpc_hop(&mut self, d: &mut Draft, hop: &RpcHop, line: Option<String>) {
        let (lane, peer, status) = self.peer_lane(d, &hop.pkg);
        let me = self.opts.svc_id.clone();
        let label = hop.id.rsplit('/').next().unwrap_or(&hop.id).to_string();
        d.add(&me, &lane, "rpc", &label, &status, Some(hop.id.clone()), "", line);
        self.calls.entry(hop.id.clone()).or_insert(RpcCall {
            id: hop.id.clone(),
            peer,
            status,
            source: hop.source.clone(),
        });
    }

    // --- following a value back to its type ---------------------------------------

    fn results_of_expr(&self, s: &Scope<'a>, expr: &Expr) -> Vec<DomainRef> {
        let e = unwrap_expr(expr);
        match e {
            Expr::Path(p) => p.path.get_ident().and_then(|id| s.vars.get(&id.to_string()).cloned()).into_iter().collect(),
            Expr::Call(call) => {
                let Expr::Path(func) = &*call.func else { return vec![] };
                let segs: Vec<String> = func.path.segments.iter().map(|x| x.ident.to_string()).collect();
                if segs.len() == 1 {
                    // Ok(x), Some(x), Box::new(x) — a wrapper round a value; a free function returning something of the domain.
                    if matches!(segs[0].as_str(), "Ok" | "Some" | "Err") {
                        return call.args.first().map(|a| self.results_of_expr(s, a)).unwrap_or_default();
                    }
                    return self.results_of_function(s, &segs[0]);
                }
                if segs.len() >= 2 && matches!(segs[segs.len() - 1].as_str(), "new") && matches!(segs[segs.len() - 2].as_str(), "Box" | "Arc" | "Rc") {
                    return call.args.first().map(|a| self.results_of_expr(s, a)).unwrap_or_default();
                }
                let type_path = segs[..segs.len() - 1].join("::");
                self.results_of_static(s, &type_path, &segs[segs.len() - 1])
            }
            Expr::MethodCall(call) => {
                let receiver = unwrap_expr(&call.receiver);
                if let Some(port) = self_field(receiver) {
                    let Some(declared) = s.ports.get(&port) else { return vec![] };
                    let full = s.src.resolve(declared);
                    let declaring = self.krate.declaring(declared, Some(&full));
                    let Some(agg) = declaring.and_then(|d| self.aggregates.iter().position(|a| d.path.starts_with(&a.dir))) else {
                        return vec![];
                    };
                    return self.results_of_port_method(declaring, agg, declared, &call.method.to_string());
                }
                if let Expr::Path(p) = receiver
                    && let Some(held) = p.path.get_ident().and_then(|id| s.vars.get(&id.to_string()))
                {
                    if held.aggregate.is_some() {
                        return self.results_of_method(held, &call.method.to_string());
                    }
                    if matches!(call.method.to_string().as_str(), "clone" | "unwrap" | "expect") {
                        return vec![held.clone()];
                    }
                }
                vec![]
            }
            Expr::Macro(m) if m.mac.path.segments.last().is_some_and(|x| x.ident == "vec") => {
                let parsed = m
                    .mac
                    .parse_body_with(syn::punctuated::Punctuated::<Expr, syn::Token![,]>::parse_terminated)
                    .unwrap_or_default();
                let items: Vec<DomainRef> = parsed.iter().flat_map(|e| self.results_of_expr(s, e)).filter(|r| r.event.is_some()).collect();
                vec![DomainRef {
                    name: "vec".into(),
                    event: None,
                    aggregate: None,
                    items: Some(items),
                }]
            }
            Expr::Tuple(t) => t
                .elems
                .iter()
                .map(|e| self.results_of_expr(s, e).into_iter().next().unwrap_or_default())
                .collect(),
            _ => vec![],
        }
    }

    fn results_of_port_method(&self, declaring: Option<&Source>, agg: usize, port: &str, method: &str) -> Vec<DomainRef> {
        let Some(dsrc) = declaring else { return vec![] };
        let Some(t) = dsrc.traits().find(|t| t.ident == port) else { return vec![] };
        for item in &t.items {
            if let syn::TraitItem::Fn(f) = item
                && f.sig.ident == method
            {
                return self.refs_of_output(agg, &f.sig.output);
            }
        }
        vec![]
    }

    /// A free function: a domain constructor read against its own aggregate,
    /// a helper kept elsewhere against whichever aggregate its return type names.
    fn results_of_function(&self, s: &Scope<'a>, name: &str) -> Vec<DomainRef> {
        let full = s.src.resolve(name);
        let module = full.strip_suffix(&format!("::{name}")).unwrap_or("");
        for src in &self.krate.sources {
            if !(src.module == module || (module.is_empty() && src.path == s.src.path)) {
                continue;
            }
            for item in &src.file.items {
                let syn::Item::Fn(f) = item else { continue };
                if f.sig.ident != name {
                    continue;
                }
                let own = self.aggregates.iter().position(|a| src.path.starts_with(&a.dir));
                let candidates: Vec<usize> = own.map(|i| vec![i]).unwrap_or_else(|| (0..self.aggregates.len()).collect());
                for agg in candidates {
                    let refs = self.refs_of_output(agg, &f.sig.output);
                    if refs.iter().any(|r| !r.name.is_empty()) {
                        return refs;
                    }
                }
            }
        }
        vec![]
    }

    /// `Order::place(…)`: an associated function on a domain struct.
    fn results_of_static(&self, s: &Scope<'a>, type_path: &str, method: &str) -> Vec<DomainRef> {
        let name = type_path.rsplit("::").next().unwrap_or(type_path).to_string();
        let full = s.src.resolve_path(type_path);
        let Some(dsrc) = self.krate.declaring(&name, Some(&full)) else {
            return vec![];
        };
        let Some(agg) = self.aggregates.iter().position(|a| dsrc.path.starts_with(&a.dir)) else {
            return vec![];
        };
        let Some(m) = dsrc.method(&name, method) else { return vec![] };
        self.refs_of_output(agg, &m.sig.output)
    }

    fn results_of_method(&self, held: &DomainRef, method: &str) -> Vec<DomainRef> {
        let Some(agg) = held.aggregate else { return vec![] };
        let dir = &self.aggregates[agg].dir;
        for src in self.krate.in_dir(dir) {
            if let Some(m) = src.method(&held.name, method) {
                return self.refs_of_output(agg, &m.sig.output);
            }
        }
        vec![]
    }

    /// `Result<(Order, OrderPlaced), E>` → an Order and an event, by position.
    fn refs_of_output(&self, agg: usize, output: &syn::ReturnType) -> Vec<DomainRef> {
        let syn::ReturnType::Type(_, ty) = output else { return vec![] };
        let a = &self.aggregates[agg];
        positions(ty)
            .into_iter()
            .map(|name| {
                if let Some(ev) = a.events.get(&name) {
                    return DomainRef {
                        name,
                        event: Some(ev.clone()),
                        aggregate: None,
                        items: None,
                    };
                }
                if a.own.contains(&name) {
                    return DomainRef {
                        name,
                        event: None,
                        aggregate: Some(agg),
                        items: None,
                    };
                }
                DomainRef::default()
            })
            .collect()
    }

    /// `for order in idle`: the element holds what the list was read as holding.
    fn bind_element(&self, s: &mut Scope<'a>, pat: &'a Pat, iter: &'a Expr) {
        let held = match unwrap_expr(iter) {
            Expr::Path(p) => p.path.get_ident().and_then(|id| s.vars.get(&id.to_string()).cloned()),
            Expr::MethodCall(c) if matches!(c.method.to_string().as_str(), "iter" | "into_iter" | "iter_mut" | "drain") => match unwrap_expr(&c.receiver) {
                Expr::Path(p) => p.path.get_ident().and_then(|id| s.vars.get(&id.to_string()).cloned()),
                _ => None,
            },
            _ => None,
        };
        if let Some(held) = held
            && held.items.is_none()
        {
            bind(s, pat, &[held]);
        }
    }
}

struct Trigger {
    name: String,
    id: Option<String>,
    foreign: Option<String>,
}

/// The name of `handle`'s event parameter, the one after `&self`.
fn event_param(handle: &syn::ImplItemFn) -> Option<String> {
    handle.sig.inputs.iter().find_map(|i| match i {
        syn::FnArg::Typed(pt) => match &*pt.pat {
            Pat::Ident(id) => Some(id.ident.to_string()),
            _ => None,
        },
        _ => None,
    })
}

/// Every string a body compares something against: `x == "…"`, `x != "…"`, a `match` arm literal.
fn collect_compared_literals(block: &syn::Block, out: &mut Vec<String>) {
    use syn::visit::Visit;
    struct Lits<'a>(&'a mut Vec<String>);
    impl<'ast> Visit<'ast> for Lits<'_> {
        fn visit_expr_binary(&mut self, e: &'ast syn::ExprBinary) {
            if matches!(e.op, syn::BinOp::Eq(_) | syn::BinOp::Ne(_)) {
                for side in [&*e.left, &*e.right] {
                    if let Expr::Lit(syn::ExprLit { lit: syn::Lit::Str(s), .. }) = side {
                        self.0.push(s.value());
                    }
                }
            }
            syn::visit::visit_expr_binary(self, e);
        }
        fn visit_arm(&mut self, arm: &'ast syn::Arm) {
            if let Pat::Lit(syn::PatLit { lit: syn::Lit::Str(s), .. }) = &arm.pat {
                self.0.push(s.value());
            }
            syn::visit::visit_arm(self, arm);
        }
    }
    Lits(out).visit_block(block);
}

fn bind(s: &mut Scope<'_>, pat: &Pat, results: &[DomainRef]) {
    match pat {
        Pat::Ident(id) => {
            if let Some(r) = results.first()
                && !r.name.is_empty()
            {
                s.vars.insert(id.ident.to_string(), r.clone());
            }
        }
        Pat::Type(t) => bind(s, &t.pat, results),
        Pat::Reference(r) => bind(s, &r.pat, results),
        Pat::Paren(p) => bind(s, &p.pat, results),
        Pat::Tuple(t) => {
            for (i, el) in t.elems.iter().enumerate() {
                if let Some(r) = results.get(i) {
                    bind(s, el, std::slice::from_ref(r));
                }
            }
        }
        Pat::TupleStruct(ts) => {
            // Some(order), Ok((order, placed)): the wrapper's one field is the value.
            if let Some(inner) = ts.elems.first() {
                bind(s, inner, results);
            }
        }
        _ => {}
    }
}

fn unwrap_expr(e: &Expr) -> &Expr {
    match e {
        Expr::Await(a) => unwrap_expr(&a.base),
        Expr::Try(t) => unwrap_expr(&t.expr),
        Expr::Paren(p) => unwrap_expr(&p.expr),
        Expr::Group(g) => unwrap_expr(&g.expr),
        Expr::Reference(r) => unwrap_expr(&r.expr),
        Expr::Unary(u) => unwrap_expr(&u.expr),
        _ => e,
    }
}

fn is_self(e: &Expr) -> bool {
    matches!(e, Expr::Path(p) if p.path.is_ident("self"))
}

/// `self.<field>` → field.
fn self_field(e: &Expr) -> Option<String> {
    let Expr::Field(f) = e else { return None };
    if !is_self(unwrap_expr(&f.base)) {
        return None;
    }
    match &f.member {
        syn::Member::Named(n) => Some(n.to_string()),
        syn::Member::Unnamed(_) => None,
    }
}

/// A block ends the path when its last statement returns, fails, or bails.
fn leaves_block(block: &syn::Block) -> bool {
    match block.stmts.last() {
        Some(Stmt::Expr(e, _)) => leaves_expr(e),
        Some(Stmt::Macro(m)) => leaves_macro(&m.mac),
        _ => false,
    }
}

fn leaves_expr(e: &Expr) -> bool {
    match e {
        Expr::Return(_) => true,
        Expr::Macro(m) => leaves_macro(&m.mac),
        Expr::Call(c) => matches!(&*c.func, Expr::Path(p) if p.path.is_ident("Err")),
        Expr::Try(t) => leaves_expr(&t.expr),
        Expr::Block(b) => leaves_block(&b.block),
        _ => false,
    }
}

fn leaves_macro(mac: &syn::Macro) -> bool {
    mac.path
        .segments
        .last()
        .is_some_and(|s| matches!(s.ident.to_string().as_str(), "bail" | "panic" | "todo" | "unreachable" | "unimplemented"))
}

fn unmark_if_all_leave(branches: Vec<AltBranch>) -> Vec<AltBranch> {
    if branches.iter().all(|b| b.terminal == Some(true)) {
        return branches.into_iter().map(|b| AltBranch { terminal: Some(false), ..b }).collect();
    }
    branches
}

fn unique(title: &str, seen: &mut BTreeSet<String>) -> String {
    let mut out = title.to_string();
    let mut n = 2;
    while seen.contains(&out) {
        out = format!("{title} ({n})");
        n += 1;
    }
    seen.insert(out.clone());
    out
}

pub fn method_names(im: &syn::ItemImpl) -> Vec<String> {
    methods(im).map(|m| m.sig.ident.to_string()).collect()
}
