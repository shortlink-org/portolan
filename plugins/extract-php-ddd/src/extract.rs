//! One tree in, one fragment out - three, when the route files prove an HTTP
//! contract and the mappings a store. A fragment, not a catalog: it carries
//! every context the tree lays out, and is merged with everything else
//! before anything validates it.
//!
//! Each context is a context; each application under it is a service, and
//! the context's model is filed under its `backend` application, or the
//! first one, or a service named after the context when it has none. A
//! module with a root is an aggregate; one with only use cases is a model
//! group; one with nothing is a warning.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::application::{self, Operation as UseCase, Subscriber};
use crate::bus::queue_name;
use crate::catalog::{
    Aggregate, Block, Catalog, Channel, ChannelMessage, Column, Context, Enum, EnumValue, Event, EventConsumer, EventVersion, Flow, FlowNode, ForeignKey, Handoff,
    HttpRoute, Operation, Participant, Persists, RpcMethod, RpcService, Service, Step, Store, StoreAccess, Table, TableAccess, Wire,
};
use crate::domain::{self, Model, shape_of};
use crate::ids::{aggregate_id, block_id, event_id, sentence, service_id, short, slug, title};
use crate::layout::{self, Layout, RootKind};
use crate::openapi::{self, Op};
use crate::protocol::{Builder, File, Input, Options, Response};
use crate::source::{Base, ClassInfo, MethodInfo, Tree, Val, clean_doc, summary};
use crate::stores::{self, Backend};
use crate::transport;
use crate::yaml::to_yaml;

/// A service: one application, or the stand-in for a context without any.
struct Svc {
    id: String,
    /// `mooc-backend`: what the id looks like in a participant or a file name.
    slug: String,
    name: String,
    ctx: usize,
    app: Option<usize>,
    path: PathBuf,
}

/// An event the tree declares, by the class that declares it.
struct EventRef {
    id: String,
    name: String,
    wire: String,
    doc: String,
}

/// Where a port's data lives, when it lives anywhere.
#[derive(Clone)]
struct StoreRef {
    id: String,
    lane: String,
    ctx: usize,
    table: Option<String>,
}

pub fn extract(input: &Input, opts: &Options, cwd: &Path) -> Response {
    let mut b = Builder::default();
    let root = cwd.join(&input.root);
    let cwd_owned = cwd.to_path_buf();
    let rel = move |abs: &Path| -> String { abs.strip_prefix(&cwd_owned).unwrap_or(abs).to_string_lossy().replace('\\', "/") };
    let exchange = if opts.exchange.is_empty() { "domain_events".to_string() } else { opts.exchange.clone() };
    let store_kind = if opts.store_kind.is_empty() { "mysql".to_string() } else { opts.store_kind.clone() };
    let repo = if opts.repo.is_empty() { composer_repo(&root) } else { opts.repo.clone() };

    let layout = layout::read(&root, &opts.source, &opts.apps);
    if layout.contexts.is_empty() {
        b.warn(
            &rel(&root),
            format!("no bounded contexts: nothing under {}/ but `Shared`; the fragment is empty", if opts.source.is_empty() { "src" } else { &opts.source }),
        );
    }
    let roots: Vec<(PathBuf, usize)> = layout
        .roots
        .iter()
        .enumerate()
        .map(|(i, (dir, kind))| (if matches!(kind, RootKind::App(..)) { dir.join("src") } else { dir.clone() }, i))
        .collect();
    let tree = Tree::load(&roots);
    for file in &tree.files {
        if file.parse_errors > 0 {
            b.warn(&rel(&file.path), format!("{} syntax error(s); the file is read as far as it parsed", file.parse_errors));
        }
    }

    // Services and which one each context's model is filed under.
    let mut svcs: Vec<Svc> = Vec::new();
    let mut primary: Vec<usize> = Vec::new();
    for (ci, ctx) in layout.contexts.iter().enumerate() {
        if ctx.apps.is_empty() {
            let id = service_id(&ctx.slug, &ctx.slug);
            b.warn(
                &id,
                format!("no application under {}/{} loads the context; its model is filed under a service named after it", if opts.apps.is_empty() { "apps" } else { &opts.apps }, ctx.slug),
            );
            primary.push(svcs.len());
            svcs.push(Svc {
                id,
                slug: format!("{}-{}", ctx.slug, ctx.slug),
                name: ctx.name.clone(),
                ctx: ci,
                app: None,
                path: ctx.dir.clone(),
            });
            continue;
        }
        let first = svcs.len();
        let mut backend = None;
        for (ai, app) in ctx.apps.iter().enumerate() {
            if app.slug == "backend" {
                backend = Some(svcs.len());
            }
            svcs.push(Svc {
                id: service_id(&ctx.slug, &app.slug),
                slug: format!("{}-{}", ctx.slug, app.slug),
                name: format!("{} {}", ctx.name, app.name),
                ctx: ci,
                app: Some(ai),
                path: app.dir.clone(),
            });
        }
        primary.push(backend.unwrap_or(first));
    }

    // The model, module by module.
    let mut models: Vec<Vec<Option<Model>>> = Vec::new();
    let mut agg_ids: Vec<Vec<String>> = Vec::new();
    let mut events: BTreeMap<String, EventRef> = BTreeMap::new();
    let mut ports: BTreeMap<String, (usize, usize)> = BTreeMap::new();
    for (ci, ctx) in layout.contexts.iter().enumerate() {
        let svc = &svcs[primary[ci]];
        let mut per_module = Vec::new();
        let mut ids = Vec::new();
        for (mi, module) in ctx.modules.iter().enumerate() {
            let agg_id = aggregate_id(&svc.id, &module.slug);
            let model = domain::read(&tree, &module.dir);
            if let Some(model) = &model {
                for decl in &model.events {
                    let name = decl.class.name.trim_end_matches("DomainEvent").to_string();
                    events.insert(
                        decl.class.fqn.clone(),
                        EventRef {
                            id: event_id(&agg_id, &name),
                            wire: decl.wire.clone().unwrap_or_else(|| decl.class.fqn.clone()),
                            doc: summary(&decl.class.doc),
                            name,
                        },
                    );
                }
                for port in &model.ports {
                    ports.insert(port.fqn.clone(), (ci, mi));
                }
            }
            // A port declared in a module without a root still names a store.
            for (file, class) in tree.classes() {
                if class.kind == crate::source::ClassKind::Interface && class.name.ends_with("Repository") && file.path.starts_with(&module.dir) {
                    ports.entry(class.fqn.clone()).or_insert((ci, mi));
                }
            }
            per_module.push(model);
            ids.push(agg_id);
        }
        models.push(per_module);
        agg_ids.push(ids);
    }

    let use_cases: Vec<UseCase> = application::operations(&tree);
    let mut handlers: BTreeMap<String, usize> = BTreeMap::new(); // message fqn → use case
    for (i, uc) in use_cases.iter().enumerate() {
        handlers.insert(uc.message.clone(), i);
    }
    let placed: Vec<Option<(usize, Option<usize>)>> = use_cases.iter().map(|uc| layout.place(uc.file.module, &uc.file.path)).collect();
    for (_, class) in tree.classes() {
        let named_like_one = class.name.ends_with("CommandHandler") || class.name.ends_with("QueryHandler");
        if named_like_one && class.kind == crate::source::ClassKind::Class && !class.is_abstract && application::is_handler(class).is_none() {
            b.warn(
                &class.fqn,
                format!("{} is named like a handler but implements neither CommandHandler nor QueryHandler; the bus never reaches it and it is not an operation", class.name),
            );
        }
    }
    let subscribers: Vec<Subscriber> = application::subscribers(&tree);
    let sub_placed: Vec<Option<(usize, Option<usize>)>> = subscribers.iter().map(|s| layout.place(s.file.module, &s.file.path)).collect();
    for (si, s) in subscribers.iter().enumerate() {
        for ev in &s.events {
            if ev != "*" && !events.contains_key(ev) {
                b.warn(
                    &s.class.fqn,
                    format!("{} subscribes to `{}`, which no context in the tree declares; the step is unresolved", s.class.name, short(ev)),
                );
            }
        }
        if let Some((ci, _)) = sub_placed[si] {
            let ctx = &layout.contexts[ci];
            let wired = layout.contexts.iter().flat_map(|c| c.apps.iter()).any(|a| a.wires.contains(&ctx.name));
            if !wired && !ctx.apps.is_empty() {
                // Has apps, but none loads its own code: odd, and worth a line.
                b.warn(&svcs[primary[ci]].id, format!("no application's services configuration loads src/{}; {} runs nowhere", ctx.name, s.class.name));
            }
        }
    }
    for (ci, ctx) in layout.contexts.iter().enumerate() {
        if ctx.apps.is_empty() {
            let wired = layout.contexts.iter().flat_map(|c| c.apps.iter()).any(|a| a.wires.contains(&ctx.name));
            let subs = sub_placed.iter().filter(|p| p.map(|(c, _)| c) == Some(ci)).count();
            if !wired && subs > 0 {
                b.warn(
                    &svcs[primary[ci]].id,
                    format!("no application loads src/{}: its {subs} subscriber(s) are declared but run nowhere", ctx.name),
                );
            }
        }
    }

    // Stores: the tables the mappings declare per context, and what each
    // port is answered by.
    let mut port_store: BTreeMap<String, StoreRef> = BTreeMap::new();
    let mut ctx_stores: Vec<Vec<Store>> = (0..layout.contexts.len()).map(|_| Vec::new()).collect();
    let adapters = stores::adapters(&tree);
    let mut memory_only: BTreeSet<String> = BTreeSet::new();
    for (ci, ctx) in layout.contexts.iter().enumerate() {
        let svc = &svcs[primary[ci]];
        let mappings = stores::read_mappings(&stores::mapping_files(&ctx.dir));
        let known: Vec<(String, String)> = mappings.iter().map(|m| (m.table.clone(), m.columns.iter().map(|c| c.name.clone()).collect::<Vec<_>>().join(","))).collect();
        let db_id = format!("{}.db", svc.id);
        let db_lane = format!("{}-db", svc.slug);
        let mut tables: Vec<Table> = Vec::new();
        let mut missing_fk: BTreeSet<String> = BTreeSet::new();
        for m in &mappings {
            let persists = persists_of(&layout, &models, &agg_ids, ci, &m.entity);
            let entity = short(&m.entity).to_string();
            tables.push(Table {
                id: format!("{db_id}.{}", m.table),
                name: m.table.clone(),
                doc: tree.class(&m.entity).map(|c| summary(&c.doc)).unwrap_or_default(),
                columns: m
                    .columns
                    .iter()
                    .map(|c| Column {
                        name: c.name.clone(),
                        type_: c.type_.clone(),
                        nullable: c.nullable,
                        pk: c.pk,
                        fk: c.fk.clone().and_then(|f| {
                            if known.iter().any(|(t, cols)| *t == f.table && cols.split(',').any(|col| col == f.column)) {
                                Some(ForeignKey {
                                    table: format!("{db_id}.{}", f.table),
                                    ..f
                                })
                            } else {
                                missing_fk.insert(format!("{}.{}", f.table, f.column));
                                None
                            }
                        }),
                        maps: if c.field.is_empty() { None } else { Some(format!("{entity}.{}", c.field.split('.').next().unwrap_or_default())) },
                        doc: None,
                    })
                    .collect(),
                indexes: vec![],
                persists,
                accesses: vec![],
            });
        }
        for target in &missing_fk {
            b.warn(&db_id, format!("a key points at `{target}`, which no mapping in the context declares; the key is left off"));
        }
        if !tables.is_empty() {
            ctx_stores[ci].push(Store {
                id: db_id.clone(),
                slug: "db".into(),
                name: format!("{} database", ctx.name),
                kind: store_kind.clone(),
                owner: svc.id.clone(),
                tables,
                source: rel(&ctx.dir),
            });
        }
        // Elasticsearch: one index per adapter, shaped like the root it keeps.
        let es_id = format!("{}.search", svc.id);
        let es_lane = format!("{}-search", svc.slug);
        let mut indexes: Vec<Table> = Vec::new();
        for (port, (pci, pmi)) in ports.iter().filter(|(_, (c, _))| *c == ci) {
            let answered: Vec<&stores::Adapter> = adapters.iter().filter(|a| a.port == *port).collect();
            if answered.is_empty() {
                continue;
            }
            let root_of_port = models[*pci][*pmi].as_ref().map(|m| m.root);
            // Which adapter answers the port: the one the Symfony wiring
            // aliases it to, else the database over the index over memory.
            let backend = layout
                .aliases
                .get(port)
                .and_then(|class| answered.iter().find(|a| a.class.fqn == *class))
                .map(|a| a.backend)
                .unwrap_or_else(|| {
                    if answered.iter().any(|a| a.backend == Backend::Relational) {
                        Backend::Relational
                    } else if answered.iter().any(|a| a.backend == Backend::Elasticsearch) {
                        Backend::Elasticsearch
                    } else {
                        Backend::Memory
                    }
                });
            let es = answered.iter().find(|a| a.backend == Backend::Elasticsearch);
            if let Some(es) = es {
                let index = es.index.clone().unwrap_or_else(|| slug(short(port).trim_end_matches("Repository")));
                if !indexes.iter().any(|t| t.name == index) {
                    indexes.push(Table {
                        id: format!("{es_id}.{index}"),
                        name: index.clone(),
                        doc: root_of_port.map(|r| summary(&r.doc)).unwrap_or_default(),
                        columns: root_of_port
                            .map(|r| {
                                shape_of(&tree, r)
                                    .into_iter()
                                    .map(|f| Column {
                                        pk: f.name == "id",
                                        maps: Some(format!("{}.{}", r.name, f.name)),
                                        name: f.name,
                                        type_: f.type_,
                                        nullable: false,
                                        fk: None,
                                        doc: None,
                                    })
                                    .collect()
                            })
                            .unwrap_or_default(),
                        indexes: vec![],
                        persists: root_of_port.and_then(|r| persists_of(&layout, &models, &agg_ids, ci, &r.fqn)),
                        accesses: vec![],
                    });
                }
            }
            match backend {
                Backend::Relational => {
                    let table = root_of_port.and_then(|r| mappings.iter().find(|m| m.entity == r.fqn)).map(|m| m.table.clone());
                    port_store.insert(
                        port.clone(),
                        StoreRef {
                            id: db_id.clone(),
                            lane: db_lane.clone(),
                            ctx: ci,
                            table,
                        },
                    );
                }
                Backend::Elasticsearch => {
                    let index = es.and_then(|e| e.index.clone()).unwrap_or_else(|| slug(short(port).trim_end_matches("Repository")));
                    port_store.insert(
                        port.clone(),
                        StoreRef {
                            id: es_id.clone(),
                            lane: es_lane.clone(),
                            ctx: ci,
                            table: Some(index),
                        },
                    );
                }
                Backend::Memory => {
                    memory_only.insert(port.clone());
                }
            }
        }
        if !indexes.is_empty() {
            ctx_stores[ci].push(Store {
                id: es_id,
                slug: "search".into(),
                name: format!("{} Elasticsearch", ctx.name),
                kind: "other".into(),
                owner: svc.id.clone(),
                tables: indexes,
                source: rel(&ctx.dir),
            });
        }
    }
    for port in &memory_only {
        b.warn(port, format!("{} is answered only in memory or by a file; it reaches no store the catalog keeps", short(port)));
    }
    for port in ports.keys() {
        if !adapters.iter().any(|a| a.port == *port) {
            b.warn(port, format!("nothing in the tree implements {}; the port reaches no store", short(port)));
        }
    }

    // What every method in the tree does to a port: the accesses the store
    // fragment lists per table, whether or not a flow reaches them.
    let mut table_accesses: BTreeMap<String, Vec<TableAccess>> = BTreeMap::new();
    for file in &tree.files {
        for class in &file.classes {
            for m in &class.methods {
                let mut flat = Vec::new();
                for chain in &m.chains {
                    chain.flatten(&mut flat);
                }
                for chain in flat {
                    let Some((port, method)) = port_call(&ports, class, chain) else { continue };
                    let Some(store) = port_store.get(&port) else { continue };
                    let Some(table) = &store.table else { continue };
                    let entry = table_accesses.entry(format!("{}.{table}", store.id)).or_default();
                    let source = format!("{}:{}", rel(&file.path), chain.line);
                    let label = format!("{}.{method}", short(&port));
                    if !entry.iter().any(|a| a.method == label && a.source == source) {
                        entry.push(TableAccess {
                            operation: stores::operation_of(&method).unwrap_or("read").into(),
                            method: label,
                            source,
                        });
                    }
                }
            }
        }
    }
    for stores_ in ctx_stores.iter_mut() {
        for store in stores_.iter_mut() {
            for table in store.tables.iter_mut() {
                table.accesses = table_accesses.remove(&table.id).unwrap_or_default();
            }
        }
    }

    let module_roots: Vec<(PathBuf, String)> = layout
        .contexts
        .iter()
        .enumerate()
        .flat_map(|(ci, ctx)| ctx.modules.iter().enumerate().map(move |(mi, m)| (m.dir.clone(), ci, mi)))
        .filter_map(|(dir, ci, mi)| models[ci][mi].as_ref().map(|m| (dir, m.root.fqn.clone())))
        .collect();
    let scope = Scope {
        events: &events,
        ports: &ports,
        module_roots,
    };
    let lanes = Lanes {
        exchange: exchange.clone(),
        events: &events,
        ports: &ports,
        port_store: &port_store,
        contexts: &layout,
    };
    let mut flows: Vec<Flow> = Vec::new();
    let mut flow_slugs: BTreeSet<String> = BTreeSet::new();
    // service index → wire name → (name, doc, source) of what it publishes.
    let mut published: BTreeMap<usize, BTreeMap<String, (String, String, String)>> = BTreeMap::new();
    let mut queues: BTreeMap<usize, Vec<Channel>> = BTreeMap::new();

    // The HTTP edge: one interface per route file, one operation per route,
    // one flow per route whose controller the tree has.
    let mut provides: BTreeMap<usize, BTreeMap<String, Vec<RpcMethod>>> = BTreeMap::new();
    let mut openapi_docs: BTreeMap<usize, (String, Vec<Op>)> = BTreeMap::new();
    let mut missing_controllers: BTreeSet<String> = BTreeSet::new();
    let mut unanswered: BTreeSet<String> = BTreeSet::new();
    // use case → the operation ids of the routes that run it, in the service
    // the use case is filed under; a route in another service is a call
    // across contexts and shows in the flow instead.
    let mut exposed: BTreeMap<usize, Vec<String>> = BTreeMap::new();
    for (si, svc) in svcs.iter().enumerate() {
        let Some(ai) = svc.app else { continue };
        let app = &layout.contexts[svc.ctx].apps[ai];
        let routes = transport::routes(&app.dir);
        if routes.is_empty() {
            continue;
        }
        let doc_name = openapi_name(&opts.openapi_out, &svc.slug);
        let mut ops: Vec<Op> = Vec::new();
        let mut op_ids: BTreeSet<String> = BTreeSet::new();
        for route in &routes {
            let iface = route.file.file_stem().map(|s| slug(&s.to_string_lossy())).unwrap_or_default();
            let controller = tree.class(&route.controller);
            if controller.is_none() && missing_controllers.insert(route.controller.clone()) {
                b.warn(
                    &rel(&route.file),
                    format!("{} answers {} but is not in the tree; the operation has no doc and no flow past the call", route.controller, route.path),
                );
            }
            let doc = controller.map(|c| clean_doc(&c.doc)).unwrap_or_default();
            let summary_ = {
                let s = summary(&doc);
                if s.is_empty() { sentence(&slug(&route.name)) } else { s }
            };
            let mut op_id = slug(&route.name).replace('-', "_");
            let stem = op_id.clone();
            let mut n = 2;
            while !op_ids.insert(op_id.clone()) {
                op_id = format!("{stem}_{n}");
                n += 1;
            }
            let verbs: Vec<String> = if route.verbs.is_empty() { vec!["ANY".into()] } else { route.verbs.clone() };
            for verb in &verbs {
                ops.push(Op {
                    operation_id: if verbs.len() > 1 { format!("{op_id}_{}", verb.to_ascii_lowercase()) } else { op_id.clone() },
                    verb: verb.to_ascii_lowercase(),
                    path: route.path.clone(),
                    summary: summary_.clone(),
                    description: if doc.lines().count() > 1 { doc.clone() } else { String::new() },
                    tag: iface.clone(),
                    route_name: Some(route.name.clone()),
                    source: format!("{}:{}", rel(&route.file), route.line),
                });
            }
            if route.verbs.is_empty() {
                continue;
            }
            let verb = route.verbs[0].clone();
            provides.entry(si).or_default().entry(iface.clone()).or_default().push(RpcMethod {
                name: op_id.clone(),
                doc: summary_.clone(),
                http: HttpRoute {
                    method: verb.clone(),
                    path: route.path.clone(),
                },
            });

            // The flow: the call in, what the controller dispatches or asks,
            // and what the handler does, followed through the classes it holds.
            let mut participants = vec![
                Participant {
                    id: "client".into(),
                    kind: "actor".into(),
                    context: None,
                    label: None,
                },
                lanes.service(svc),
            ];
            let mut steps = vec![FlowNode::Step(Step {
                id: "s1".into(),
                from: "client".into(),
                to: svc.id.clone(),
                kind: "rpc".into(),
                label: format!("{verb} {}", route.path),
                status: "declared".into(),
                reference: Some(format!("{}.{iface}/{op_id}", svc.id)),
                note: None,
                line: Some(format!("{}:{}", rel(&route.file), route.line)),
                handoff: None,
                store_access: None,
            })];
            if let Some(controller) = controller {
                let invoke_line = controller.method("__invoke").map(|m| m.line).unwrap_or(controller.line);
                let file = tree.file_of(&controller.fqn).map(|f| f.path.clone()).unwrap_or_default();
                for (how, message) in transport::messages_of(&tree, controller) {
                    let Some(&ui) = handlers.get(&message) else {
                        if unanswered.insert(message.clone()) {
                            b.warn(&controller.fqn, format!("{} {}s `{}`, which no handler in the tree answers", controller.name, how, short(&message)));
                        }
                        continue;
                    };
                    let uc = &use_cases[ui];
                    let target_ctx = placed[ui].map(|(c, _)| c);
                    let lane_svc = match target_ctx {
                        Some(tc) if tc != svc.ctx => &svcs[primary[tc]],
                        _ => svc,
                    };
                    let op_ref = placed[ui].and_then(|(c, m)| m.map(|m| format!("{}/{}", agg_ids[c][m], slug(&uc.id))));
                    if lane_svc.id == svc.id {
                        exposed.entry(ui).or_default().push(op_id.clone());
                    }
                    if lane_svc.id != svc.id {
                        let p = lanes.service(lane_svc);
                        if !participants.iter().any(|x| x.id == p.id) {
                            participants.push(p);
                        }
                        steps.push(FlowNode::Step(Step {
                            id: format!("s{}", steps.len() + 1),
                            from: svc.id.clone(),
                            to: lane_svc.id.clone(),
                            kind: "call".into(),
                            label: format!("{how} {}", uc.id),
                            status: "declared".into(),
                            reference: op_ref,
                            note: Some(format!(
                                "In process: the application loads {}'s code and runs the handler itself over an in-memory {} bus.",
                                layout.contexts[target_ctx.unwrap_or(svc.ctx)].name,
                                uc.kind
                            )),
                            line: Some(format!("{}:{invoke_line}", rel(&file))),
                            handoff: None,
                            store_access: None,
                        }));
                    }
                    let mut effects = Vec::new();
                    follow(&tree, &scope, &uc.handler.fqn, "__invoke", 6, &mut BTreeSet::new(), &mut effects);
                    lanes.steps(lane_svc, &effects, &mut steps, &mut participants, &rel);
                    note_published(&mut published, &svcs, lane_svc, &effects, &events, &rel);
                }
            }
            let flow_slug = unique(&mut flow_slugs, format!("{}-{}", svc.slug, slug(&route.name)));
            flows.push(Flow {
                id: format!("flow.{flow_slug}"),
                slug: flow_slug,
                name: sentence(&slug(&route.name)),
                summary: summary(&doc),
                source: rel(&route.file),
                owner: layout.contexts[svc.ctx].slug.clone(),
                participants,
                steps,
            });
        }
        openapi_docs.insert(si, (doc_name, ops));
    }

    // Policies: one flow per subscriber, from the exchange in through its
    // own queue, then whatever it does.
    let mut order: Vec<usize> = (0..subscribers.len()).collect();
    order.sort_by(|a, c| subscribers[*a].class.fqn.cmp(&subscribers[*c].class.fqn));
    for si in order {
        let s = &subscribers[si];
        let Some((ci, _)) = sub_placed[si] else { continue };
        let svc = &svcs[primary[ci]];
        let queue = queue_name(&s.class.fqn);
        let invoke = s.class.method("__invoke");
        let line = invoke.map(|m| m.line).unwrap_or(s.class.line);
        let mut participants = vec![lanes.bus(), lanes.service(svc)];
        let mut steps = Vec::new();
        let mut messages = Vec::new();
        for ev in &s.events {
            let known = events.get(ev);
            let (label, reference, wire, doc) = match (ev.as_str(), known) {
                ("*", _) => ("every domain event".to_string(), None, String::new(), String::new()),
                (_, Some(e)) => (e.name.clone(), Some(e.id.clone()), e.wire.clone(), e.doc.clone()),
                (_, None) => (short(ev).to_string(), None, ev.clone(), String::new()),
            };
            if ev == "*" {
                // Bound to everything: the queue carries every event the tree
                // declares, and the step says so once rather than per event.
                let mut all: Vec<&EventRef> = events.values().collect();
                all.sort_by(|a, c| a.wire.cmp(&c.wire));
                messages.extend(all.into_iter().map(|e| ChannelMessage {
                    name: e.wire.clone(),
                    title: e.name.clone(),
                    doc: e.doc.clone(),
                    direction: "receive".into(),
                }));
            }
            steps.push(FlowNode::Step(Step {
                id: format!("s{}", steps.len() + 1),
                from: "bus".into(),
                to: svc.id.clone(),
                kind: "event".into(),
                label: label.clone(),
                status: if ev == "*" || known.is_some() { "declared".into() } else { "unresolved".into() },
                reference,
                note: if ev == "*" {
                    Some("Subscribed to `DomainEvent::class`: the queue is bound to every event the exchange carries.".into())
                } else if known.is_none() {
                    Some(format!("Reacts to `{}`, which no context in the tree declares.", short(ev)))
                } else {
                    None
                },
                line: Some(format!("{}:{line}", rel(&s.file.path))),
                handoff: if ev == "*" {
                    None
                } else {
                    Some(Handoff {
                        kind: "message".into(),
                        transport: "rabbitmq".into(),
                        channel: queue.clone(),
                        message: wire.clone(),
                        direction: "receive".into(),
                    })
                },
                store_access: None,
            }));
            if ev != "*" {
                messages.push(ChannelMessage {
                    name: wire,
                    title: label,
                    doc,
                    direction: "receive".into(),
                });
            }
        }
        let mut effects = Vec::new();
        follow(&tree, &scope, &s.class.fqn, "__invoke", 6, &mut BTreeSet::new(), &mut effects);
        lanes.steps(svc, &effects, &mut steps, &mut participants, &rel);
        note_published(&mut published, &svcs, svc, &effects, &events, &rel);
        queues.entry(primary[ci]).or_default().push(Channel {
            address: queue.clone(),
            kind: "event".into(),
            title: format!("Queue · {}", queue.rsplit('.').next().unwrap_or(&queue)),
            doc: format!("{}'s own queue, bound to the `{exchange}` exchange for what it subscribes to; the consumer command works it.", s.class.name),
            messages,
            source: format!("{}:{}", rel(&s.file.path), s.class.line),
        });
        let flow_slug = unique(&mut flow_slugs, format!("{}-{}", layout.contexts[ci].slug, slug(&s.class.name)));
        flows.push(Flow {
            id: format!("flow.{flow_slug}"),
            slug: flow_slug,
            name: sentence(&slug(&s.class.name)),
            summary: summary(&s.class.doc),
            source: rel(&s.file.path),
            owner: layout.contexts[ci].slug.clone(),
            participants,
            steps,
        });
    }

    // The fragment: contexts, services, aggregates.
    let mut contexts: Vec<Context> = Vec::new();
    let mut store_contexts: Vec<Context> = Vec::new();
    let mut all_stores: Vec<Store> = Vec::new();
    for (ci, ctx) in layout.contexts.iter().enumerate() {
        let mut services: Vec<Service> = Vec::new();
        for (si, svc) in svcs.iter().enumerate().filter(|(_, s)| s.ctx == ci) {
            let mut aggregates: Vec<Aggregate> = Vec::new();
            if si == primary[ci] {
                for (mi, module) in ctx.modules.iter().enumerate() {
                    let agg_id = &agg_ids[ci][mi];
                    let model = models[ci][mi].as_ref();
                    let mut operations: Vec<Operation> = Vec::new();
                    for (ui, uc) in use_cases.iter().enumerate() {
                        if placed[ui] == Some((ci, Some(mi))) {
                            let mut by: Vec<String> = exposed.get(&ui).cloned().unwrap_or_default();
                            by.sort();
                            by.dedup();
                            operations.push(Operation {
                                id: slug(&uc.id),
                                kind: uc.kind.clone(),
                                doc: uc.doc.clone(),
                                exposed_by: if by.is_empty() { None } else { Some(by) },
                                fields: uc.fields.clone(),
                                source: format!("{}:{}", rel(&uc.file.path), uc.line),
                            });
                        }
                    }
                    operations.sort_by(|a, c| a.id.cmp(&c.id));
                    let subs_here = sub_placed.iter().filter(|p| **p == Some((ci, Some(mi)))).count();
                    let Some(model) = model else {
                        if operations.is_empty() && subs_here == 0 {
                            b.warn(
                                &format!("{}/{}", ctx.slug, module.slug),
                                format!("{} has no aggregate root under Domain/ and no use case under Application/; nothing to catalog", module.name),
                            );
                            continue;
                        }
                        aggregates.push(Aggregate {
                            id: agg_id.clone(),
                            slug: module.slug.clone(),
                            name: title(&module.slug),
                            readme: String::new(),
                            kind: Some("model-group".into()),
                            root: String::new(),
                            entities: vec![],
                            value_objects: vec![],
                            operations,
                            events: vec![],
                            enums: vec![],
                        });
                        continue;
                    };
                    let mut evs: Vec<Event> = Vec::new();
                    for decl in &model.events {
                        let e = &events[&decl.class.fqn];
                        let mut consumers: Vec<EventConsumer> = Vec::new();
                        for (sj, s) in subscribers.iter().enumerate() {
                            if !s.events.iter().any(|x| x == "*" || *x == decl.class.fqn) {
                                continue;
                            }
                            let Some((sc, _)) = sub_placed[sj] else { continue };
                            consumers.push(EventConsumer {
                                service: svcs[primary[sc]].id.clone(),
                                status: "declared".into(),
                                note: Some(s.class.name.clone()),
                            });
                        }
                        consumers.sort_by(|a, c| (&a.service, &a.note).cmp(&(&c.service, &c.note)));
                        evs.push(Event {
                            id: e.id.clone(),
                            slug: slug(&e.name),
                            name: e.name.clone(),
                            versions: vec![EventVersion {
                                version: "v1".into(),
                                doc: e.doc.clone(),
                                source: rel(&decl.file.path),
                                fields: decl.fields.clone(),
                            }],
                            consumers,
                            wire: Wire {
                                name: e.wire.clone(),
                                channel: Some(exchange.clone()),
                            },
                        });
                    }
                    let mut entities: Vec<Block> = vec![block_of(&tree, model.root, agg_id)];
                    entities.extend(model.entities.iter().map(|c| block_of(&tree, c, agg_id)));
                    let mut value_objects: Vec<Block> = model.values.iter().map(|c| block_of(&tree, c, agg_id)).collect();
                    value_objects.sort_by(|a, c| a.name.cmp(&c.name));
                    let enums: Vec<Enum> = model
                        .enums
                        .iter()
                        .map(|c| Enum {
                            id: format!("{agg_id}.{}", slug(&c.name)),
                            slug: slug(&c.name),
                            name: c.name.clone(),
                            doc: summary(&c.doc),
                            deprecated: c.deprecated(),
                            values: c
                                .cases
                                .iter()
                                .map(|case| EnumValue {
                                    name: case.value.as_ref().and_then(Val::as_str).map(String::from).unwrap_or_else(|| case.name.clone()),
                                    doc: summary(&case.doc),
                                    deprecated: case.deprecated,
                                })
                                .collect(),
                        })
                        .collect();
                    aggregates.push(Aggregate {
                        id: agg_id.clone(),
                        slug: module.slug.clone(),
                        name: model.root.name.clone(),
                        readme: clean_doc(&model.root.doc),
                        kind: None,
                        root: model.root.name.clone(),
                        entities,
                        value_objects,
                        operations,
                        events: evs,
                        enums,
                    });
                }
            }
            let mut channels: Vec<Channel> = Vec::new();
            if let Some(sent) = published.get(&si) {
                channels.push(Channel {
                    address: exchange.clone(),
                    kind: "event".into(),
                    title: format!("Exchange · {exchange}"),
                    doc: "Domain events, published to the RabbitMQ exchange under their wire names once the aggregate that recorded them is saved.".into(),
                    messages: sent
                        .iter()
                        .map(|(wire, (name, doc, _))| ChannelMessage {
                            name: wire.clone(),
                            title: name.clone(),
                            doc: doc.clone(),
                            direction: "send".into(),
                        })
                        .collect(),
                    source: sent.values().map(|(_, _, s)| s.clone()).min().unwrap_or_default(),
                });
            }
            channels.extend(queues.remove(&si).unwrap_or_default());
            let rpc_services: Vec<RpcService> = provides
                .remove(&si)
                .map(|by_iface| {
                    by_iface
                        .into_iter()
                        .map(|(iface, mut methods)| {
                            methods.sort_by(|a, c| a.name.cmp(&c.name));
                            RpcService {
                                id: format!("{}.{iface}", svc.id),
                                methods,
                                source: {
                                    let (name, _) = &openapi_docs[&si];
                                    let output = input.output.trim_matches('/');
                                    if output.is_empty() { rel(&svc.path.join("portolan").join(name)) } else { format!("{output}/{name}") }
                                },
                            }
                        })
                        .collect()
                })
                .unwrap_or_default();
            services.push(Service {
                id: svc.id.clone(),
                slug: svc.app.map(|ai| ctx.apps[ai].slug.clone()).unwrap_or_else(|| ctx.slug.clone()),
                name: svc.name.clone(),
                repo: repo.clone(),
                path: rel(&svc.path),
                readme: svc.app.and_then(|ai| fs::read_to_string(ctx.apps[ai].dir.join("README.md")).ok()).map(|s| s.trim().to_string()).unwrap_or_default(),
                provides: rpc_services,
                consumes: vec![],
                aggregates,
                channels,
                stores: vec![],
            });
        }
        contexts.push(Context {
            id: ctx.slug.clone(),
            slug: ctx.slug.clone(),
            name: ctx.name.clone(),
            summary: String::new(),
            classification: opts.classification.clone(),
            services,
        });
        if !ctx_stores[ci].is_empty() {
            let svc = &svcs[primary[ci]];
            store_contexts.push(Context {
                id: ctx.slug.clone(),
                slug: ctx.slug.clone(),
                name: String::new(),
                summary: String::new(),
                classification: None,
                services: vec![Service {
                    id: svc.id.clone(),
                    slug: svc.app.map(|ai| ctx.apps[ai].slug.clone()).unwrap_or_else(|| ctx.slug.clone()),
                    name: String::new(),
                    repo: String::new(),
                    path: String::new(),
                    readme: String::new(),
                    provides: vec![],
                    consumes: vec![],
                    aggregates: vec![],
                    channels: vec![],
                    stores: ctx_stores[ci].iter().map(|s| s.id.clone()).collect(),
                }],
            });
            all_stores.extend(ctx_stores[ci].drain(..));
        }
    }

    let fragment = Catalog {
        contexts,
        defs: serde_json::Map::new(),
        flows,
        adrs: vec![],
        stores: vec![],
    };
    b.files.push(File {
        name: if opts.out.is_empty() { "domain.json".into() } else { opts.out.clone() },
        contents: serde_json::to_string_pretty(&fragment).unwrap_or_default() + "\n",
    });
    for (si, (name, ops)) in &openapi_docs {
        if ops.is_empty() {
            continue;
        }
        b.files.push(File {
            name: name.clone(),
            contents: to_yaml(&openapi::document(ops, &svcs[*si].name)),
        });
    }
    if !all_stores.is_empty() {
        let store_fragment = Catalog {
            contexts: store_contexts,
            defs: serde_json::Map::new(),
            flows: vec![],
            adrs: vec![],
            stores: all_stores,
        };
        b.files.push(File {
            name: if opts.stores_out.is_empty() { "stores.json".into() } else { opts.stores_out.clone() },
            contents: serde_json::to_string_pretty(&store_fragment).unwrap_or_default() + "\n",
        });
    }

    Response {
        files: b.files,
        warnings: b.warnings,
        describe: None,
    }
}

/// `openapi.{service}.yaml` with the service filled in; a name without the
/// placeholder gets the service before its extension, so two applications
/// never write the same file.
fn openapi_name(template: &str, service: &str) -> String {
    let template = if template.is_empty() { "openapi.{service}.yaml" } else { template };
    if template.contains("{service}") {
        return template.replace("{service}", service);
    }
    match template.rsplit_once('.') {
        Some((stem, ext)) => format!("{stem}.{service}.{ext}"),
        None => format!("{template}.{service}"),
    }
}

fn block_of(tree: &Tree, class: &ClassInfo, agg_id: &str) -> Block {
    Block {
        id: block_id(agg_id, &slug(&class.name)),
        slug: slug(&class.name),
        name: class.name.clone(),
        doc: summary(&class.doc),
        fields: shape_of(tree, class),
    }
}

/// What a mapped entity persists: the aggregate whose root or entity it is.
fn persists_of(layout: &Layout, models: &[Vec<Option<Model>>], agg_ids: &[Vec<String>], ci: usize, entity: &str) -> Option<Persists> {
    for mi in 0..layout.contexts[ci].modules.len() {
        let Some(model) = &models[ci][mi] else { continue };
        let agg_id = &agg_ids[ci][mi];
        if model.root.fqn == entity {
            return Some(Persists {
                aggregate: agg_id.clone(),
                block: block_id(agg_id, &slug(&model.root.name)),
            });
        }
        if let Some(e) = model.entities.iter().find(|e| e.fqn == entity) {
            return Some(Persists {
                aggregate: agg_id.clone(),
                block: block_id(agg_id, &slug(&e.name)),
            });
        }
    }
    None
}

/// A slug nobody else in the run has: the stem, or the stem numbered.
fn unique(taken: &mut BTreeSet<String>, stem: String) -> String {
    let mut candidate = stem.clone();
    let mut n = 2;
    while !taken.insert(candidate.clone()) {
        candidate = format!("{stem}-{n}");
        n += 1;
    }
    candidate
}

fn note_published(
    published: &mut BTreeMap<usize, BTreeMap<String, (String, String, String)>>,
    svcs: &[Svc],
    svc: &Svc,
    effects: &[Effect],
    events: &BTreeMap<String, EventRef>,
    rel: &dyn Fn(&Path) -> String,
) {
    let Some(si) = svcs.iter().position(|s| s.id == svc.id) else { return };
    for effect in effects {
        if let Effect::Publish { event, file, line } = effect
            && let Some(e) = events.get(event)
        {
            let source = format!("{}:{line}", rel(file));
            let entry = published.entry(si).or_default().entry(e.wire.clone()).or_insert((e.name.clone(), e.doc.clone(), source.clone()));
            if source < entry.2 {
                entry.2 = source;
            }
        }
    }
}

/// What a method does that a flow draws: an event recorded or published, a
/// port called.
#[derive(Debug, Clone)]
enum Effect {
    Publish { event: String, file: PathBuf, line: u32 },
    Access { port: String, method: String, file: PathBuf, line: u32 },
}

struct Lanes<'a> {
    exchange: String,
    events: &'a BTreeMap<String, EventRef>,
    ports: &'a BTreeMap<String, (usize, usize)>,
    port_store: &'a BTreeMap<String, StoreRef>,
    contexts: &'a Layout,
}

impl Lanes<'_> {
    fn service(&self, svc: &Svc) -> Participant {
        Participant {
            id: svc.id.clone(),
            kind: "service".into(),
            context: Some(self.contexts.contexts[svc.ctx].slug.clone()),
            label: None,
        }
    }
    fn bus(&self) -> Participant {
        Participant {
            id: "bus".into(),
            kind: "broker".into(),
            context: None,
            label: Some(format!("RabbitMQ · {}", self.exchange)),
        }
    }

    fn steps(&self, svc: &Svc, effects: &[Effect], steps: &mut Vec<FlowNode>, participants: &mut Vec<Participant>, rel: &dyn Fn(&Path) -> String) {
        let mut lane = |p: Participant| {
            if !participants.iter().any(|x| x.id == p.id) {
                participants.push(p);
            }
        };
        for effect in effects {
            let n = steps.len() + 1;
            match effect {
                Effect::Publish { event, file, line } => {
                    lane(self.bus());
                    let known = self.events.get(event);
                    steps.push(FlowNode::Step(Step {
                        id: format!("s{n}"),
                        from: svc.id.clone(),
                        to: "bus".into(),
                        kind: "event".into(),
                        label: known.map(|e| e.name.clone()).unwrap_or_else(|| short(event).to_string()),
                        status: if known.is_some() { "declared".into() } else { "unresolved".into() },
                        reference: known.map(|e| e.id.clone()),
                        note: None,
                        line: Some(format!("{}:{line}", rel(file))),
                        handoff: Some(Handoff {
                            kind: "message".into(),
                            transport: "rabbitmq".into(),
                            channel: self.exchange.clone(),
                            message: known.map(|e| e.wire.clone()).unwrap_or_else(|| event.clone()),
                            direction: "send".into(),
                        }),
                        store_access: None,
                    }));
                }
                Effect::Access { port, method, file, line } => {
                    let Some(store) = self.port_store.get(port) else { continue };
                    if !self.ports.contains_key(port) {
                        continue;
                    }
                    lane(Participant {
                        id: store.lane.clone(),
                        kind: "store".into(),
                        context: Some(self.contexts.contexts[store.ctx].slug.clone()),
                        label: None,
                    });
                    let label = format!("{}.{method}", short(port));
                    steps.push(FlowNode::Step(Step {
                        id: format!("s{n}"),
                        from: svc.id.clone(),
                        to: store.lane.clone(),
                        kind: "call".into(),
                        label: label.clone(),
                        status: "declared".into(),
                        reference: None,
                        note: None,
                        line: Some(format!("{}:{line}", rel(file))),
                        handoff: None,
                        store_access: Some(StoreAccess {
                            store: store.id.clone(),
                            method: label,
                        }),
                    }));
                }
            }
        }
    }
}

/// `$this->repository->save(...)`: the port the class holds and the method
/// called on it, when the property's type is a port.
fn port_call(ports: &BTreeMap<String, (usize, usize)>, owner: &ClassInfo, chain: &crate::source::Chain) -> Option<(String, String)> {
    let Base::Var(v) = &chain.base else { return None };
    if v != "this" {
        return None;
    }
    let [prop, call, ..] = chain.parts.as_slice() else { return None };
    if prop.args.is_some() || call.args.is_none() {
        return None;
    }
    let class = owner.prop_class(&prop.name)?;
    if !ports.contains_key(class) {
        return None;
    }
    Some((class.to_string(), call.name.clone()))
}

/// A method by name on a class or, failing that, up its parents in the tree.
fn find_method<'a>(tree: &'a Tree, class: &'a ClassInfo, name: &str) -> Option<(&'a ClassInfo, &'a MethodInfo)> {
    let mut current = Some(class);
    let mut depth = 0;
    while let Some(c) = current {
        if let Some(m) = c.method(name) {
            return Some((c, m));
        }
        depth += 1;
        if depth > 16 {
            break;
        }
        current = c
            .extends
            .first()
            .and_then(|p| tree.class(p))
            .or_else(|| c.traits.iter().find_map(|t| tree.class(t).filter(|tc| tc.method(name).is_some())));
    }
    None
}

/// What a method does, itself and through the methods it calls on the
/// classes it holds: `$this->creator->__invoke(...)` reaches CourseCreator,
/// `Course::create(...)` reaches the root, `apply($this->incrementer, [...])`
/// the callable it holds; on the way, `record(new Event)` and
/// `publish(new Event)` are events out, and a call on a `*Repository`
/// property is the store.
/// What `follow` reads the tree against.
struct Scope<'a> {
    events: &'a BTreeMap<String, EventRef>,
    ports: &'a BTreeMap<String, (usize, usize)>,
    /// Module directory → the root declared under it, for a call on a local
    /// variable the reader cannot type: `$counter->increment(...)` in a
    /// Courses-counter use case is tried against CoursesCounter.
    module_roots: Vec<(PathBuf, String)>,
}

fn follow(
    tree: &Tree,
    scope: &Scope,
    class: &str,
    method: &str,
    depth: usize,
    visited: &mut BTreeSet<(String, String)>,
    out: &mut Vec<Effect>,
) {
    if depth == 0 || !visited.insert((class.to_string(), method.to_string())) {
        return;
    }
    let Some(info) = tree.class(class) else { return };
    let Some((owner, m)) = find_method(tree, info, method) else { return };
    let Some(file) = tree.file_of(&owner.fqn) else { return };
    let mut flat = Vec::new();
    for chain in &m.chains {
        chain.flatten(&mut flat);
    }
    for chain in flat {
        // An event out: `->record(new X(...))`, `->publish(new X(...))`.
        if let Some(part) = chain.parts.iter().find(|p| (p.name == "record" || p.name == "publish") && p.args.is_some())
            && let Some(Val::Chain(inner)) = part.args.as_ref().and_then(|a| a.first())
            && let Base::New(event, _) = &inner.base
            && (scope.events.contains_key(event) || tree.class(event).is_some_and(|c| domain::is_event(tree, c)))
        {
            push_unique(
                out,
                Effect::Publish {
                    event: event.clone(),
                    file: file.path.clone(),
                    line: chain.line,
                },
            );
            continue;
        }
        if let Some((port, method)) = port_call(scope.ports, owner, chain).or_else(|| port_call(scope.ports, info, chain)) {
            push_unique(
                out,
                Effect::Access {
                    port,
                    method,
                    file: file.path.clone(),
                    line: chain.line,
                },
            );
            continue;
        }
        let target = match &chain.base {
            Base::Var(v) if v == "this" => match chain.parts.as_slice() {
                [call, ..] if call.args.is_some() => Some((owner.fqn.clone(), call.name.clone())),
                [prop, call, ..] if prop.args.is_none() && call.args.is_some() => info
                    .prop_class(&prop.name)
                    .or_else(|| owner.prop_class(&prop.name))
                    .map(|c| (c.to_string(), call.name.clone())),
                _ => None,
            },
            // A local: typed by the parameter of that name, or tried against
            // the root of the module the method sits in.
            Base::Var(v) => match chain.parts.as_slice() {
                [call, ..] if call.args.is_some() => {
                    let by_param = m.params.iter().find(|p| p.name == *v).and_then(|p| p.class.clone());
                    let by_root = scope.module_roots.iter().find(|(dir, _)| file.path.starts_with(dir)).map(|(_, root)| root.clone());
                    [by_param, by_root]
                        .into_iter()
                        .flatten()
                        .find(|c| tree.class(c).and_then(|ci| find_method(tree, ci, &call.name)).is_some())
                        .map(|c| (c, call.name.clone()))
                }
                _ => None,
            },
            Base::Static(c) => match chain.parts.first() {
                Some(call) if call.args.is_some() => {
                    let target = match c.as_str() {
                        "self" | "static" => owner.fqn.clone(),
                        "parent" => owner.extends.first().cloned().unwrap_or_default(),
                        other => other.to_string(),
                    };
                    Some((target, call.name.clone()))
                }
                _ => None,
            },
            Base::New(c, _) => chain.parts.first().filter(|p| p.args.is_some()).map(|p| (c.clone(), p.name.clone())),
            // `apply($this->incrementer, [$courseId])`: the callable it holds.
            Base::Func(name, args) if name == "apply" || name.ends_with("\\apply") => match args.first() {
                Some(Val::Chain(inner)) => match (&inner.base, inner.parts.as_slice()) {
                    (Base::Var(v), [prop]) if v == "this" && prop.args.is_none() => {
                        info.prop_class(&prop.name).or_else(|| owner.prop_class(&prop.name)).map(|c| (c.to_string(), "__invoke".to_string()))
                    }
                    _ => None,
                },
                _ => None,
            },
            _ => None,
        };
        if let Some((target, name)) = target.filter(|(t, _)| tree.class(t).is_some()) {
            follow(tree, scope, &target, &name, depth - 1, visited, out);
        }
    }
}

fn push_unique(out: &mut Vec<Effect>, effect: Effect) {
    let same = |a: &Effect| match (a, &effect) {
        (Effect::Publish { event: e1, file: f1, line: l1 }, Effect::Publish { event: e2, file: f2, line: l2 }) => e1 == e2 && f1 == f2 && l1 == l2,
        (
            Effect::Access {
                port: p1, method: m1, file: f1, line: l1,
            },
            Effect::Access {
                port: p2, method: m2, file: f2, line: l2,
            },
        ) => p1 == p2 && m1 == m2 && f1 == f2 && l1 == l2,
        _ => false,
    };
    if !out.iter().any(same) {
        out.push(effect);
    }
}

/// composer.json's `support.source`, or its `homepage` when that is a
/// repository, spelled the way go.mod spells a module: host/owner/name.
fn composer_repo(root: &Path) -> String {
    let Ok(text) = fs::read_to_string(root.join("composer.json")) else {
        return String::new();
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
        return String::new();
    };
    let candidates = [json.pointer("/support/source").and_then(|v| v.as_str()), json.get("homepage").and_then(|v| v.as_str())];
    for url in candidates.into_iter().flatten() {
        if url.contains("github.com") || url.contains("gitlab.com") || url.contains("bitbucket.org") {
            return url
                .trim_start_matches("git+")
                .trim_start_matches("https://")
                .trim_start_matches("http://")
                .trim_start_matches("git@")
                .replacen(':', "/", if url.starts_with("git@") { 1 } else { 0 })
                .trim_end_matches(".git")
                .trim_end_matches('/')
                .to_string();
        }
    }
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_openapi_document_per_service() {
        assert_eq!(openapi_name("", "mooc-backend"), "openapi.mooc-backend.yaml");
        assert_eq!(openapi_name("openapi.{service}.yaml", "mooc-backend"), "openapi.mooc-backend.yaml");
        assert_eq!(openapi_name("openapi.inferred.yaml", "mooc-backend"), "openapi.inferred.mooc-backend.yaml");
        assert_eq!(openapi_name("contract", "x"), "contract.x");
    }
}
