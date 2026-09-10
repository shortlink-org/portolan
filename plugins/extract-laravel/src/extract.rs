//! One application in, one fragment out - three, when the routes prove an
//! HTTP contract and the migrations a database. A fragment, not a catalog:
//! it carries one context and one service, and is merged with everything
//! else before anything validates it.
//!
//! The service is the application; each module is a model group under it,
//! the way a Django application is under extract-django. A monolith of
//! forty packages is one service with forty groups, and the events that
//! cross between them are the reason the groups are worth telling apart.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::catalog::{
    Aggregate, Catalog, Channel, ChannelMessage, Column, Context, Event, EventConsumer, EventVersion, Flow, FlowNode, ForeignKey, Handoff, HttpRoute,
    Participant, Persists, RpcMethod, RpcService, Service, Step, Store, StoreAccess, Table, TableAccess, Wire,
};
use crate::events::{self, Events, Kind, Listener};
use crate::ids::{aggregate_id, block_id, event_id, sentence, service_id, short, slug, title};
use crate::jobs::{self, Jobs};
use crate::layout::{self, Module};
use crate::models;
use crate::openapi::{self, Op};
use crate::protocol::{Builder, File, Input, Options, Response};
use crate::routes::{self, Action, Endpoint};
use crate::source::{Base, ClassInfo, MethodInfo, Tree, summary};
use crate::stores;
use crate::yaml::to_yaml;

pub fn extract(input: &Input, opts: &Options, cwd: &Path) -> Response {
    let mut b = Builder::default();
    let root = cwd.join(&input.root);
    let cwd_owned = cwd.to_path_buf();
    let rel = move |abs: &Path| -> String { abs.strip_prefix(&cwd_owned).unwrap_or(abs).to_string_lossy().replace('\\', "/") };

    let base = root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let context = if opts.context.is_empty() { slug(&base) } else { opts.context.clone() };
    let service = if opts.service.is_empty() { slug(&base) } else { opts.service.clone() };
    let svc_id = service_id(&context, &service);
    let readme = fs::read_to_string(root.join("README.md")).map(|s| s.trim().to_string()).unwrap_or_default();
    let name = if !opts.service_name.is_empty() {
        opts.service_name.clone()
    } else {
        readme_title(&readme).unwrap_or_else(|| title(&service))
    };

    let (modules, pattern) = layout::modules(&root, &opts.modules);
    if modules.is_empty() {
        b.warn(
            &svc_id,
            format!(
                "no modules under {}: nothing matches `{pattern}`; the fragment describes a service with no model",
                rel(&root)
            ),
        );
    }
    let mut roots: Vec<(PathBuf, usize)> = Vec::new();
    for (i, m) in modules.iter().enumerate() {
        roots.push((m.dir.clone(), i));
        for extra in &m.extra {
            roots.push((extra.clone(), i));
        }
    }
    let tree = Tree::load(&roots);
    for file in &tree.files {
        if file.parse_errors > 0 {
            b.warn(
                &rel(&file.path),
                format!("{} syntax error(s); the file is read as far as it parsed", file.parse_errors),
            );
        }
    }

    let module_slugs: Vec<String> = modules.iter().map(|m| m.slug.clone()).collect();
    let events = events::read(&tree, &module_slugs);
    let jobs = jobs::read(&tree);
    let schema = stores::read_schema(&tree);
    let endpoints: Vec<Endpoint> = tree.files.iter().filter(|f| layout::is_route_file(&f.path)).flat_map(routes::read).collect();

    // Aggregates: one model group per module that has anything in it.
    let mut aggregates: Vec<Aggregate> = Vec::new();
    let mut event_ids: BTreeMap<String, String> = BTreeMap::new();
    // table name → (aggregate id, block id, model): what a table persists.
    let mut persisted: BTreeMap<String, (String, String, String)> = BTreeMap::new();
    for (i, m) in modules.iter().enumerate() {
        let agg_id = aggregate_id(&svc_id, &format!("models-{}", m.slug));
        for decl in events.decls.iter().filter(|d| d.module == i) {
            event_ids.insert(decl.key.clone(), event_id(&agg_id, &decl.name));
        }
    }
    for (i, m) in modules.iter().enumerate() {
        let agg_slug = format!("models-{}", m.slug);
        let agg_id = aggregate_id(&svc_id, &agg_slug);
        let found = models::read_models(&tree, i);
        for model in &found {
            persisted.entry(stores::table_of_model(model.class)).or_insert((
                agg_id.clone(),
                block_id(&agg_id, &slug(&model.class.name)),
                model.class.fqn.clone(),
            ));
        }
        let entities = found.iter().map(|model| models::block_of(model, &agg_id)).collect::<Vec<_>>();
        let enums = models::read_enums(&tree, i, &found, &agg_id);
        let mut named = 0;
        let mut evs: Vec<Event> = Vec::new();
        for decl in events.decls.iter().filter(|d| d.module == i) {
            if decl.kind == Kind::Named {
                named += 1;
            }
            let id = event_ids[&decl.key].clone();
            let mut consumers: Vec<EventConsumer> = Vec::new();
            for l in events.listeners_of(&decl.key) {
                let note = format!("{}::{}", short(&l.class), l.method);
                if !consumers.iter().any(|c| c.note.as_deref() == Some(&note)) {
                    consumers.push(EventConsumer {
                        service: svc_id.clone(),
                        status: "declared".into(),
                        note: Some(note),
                    });
                }
            }
            consumers.sort_by(|a, c| a.note.cmp(&c.note));
            evs.push(Event {
                id,
                slug: decl.slug.clone(),
                name: decl.name.clone(),
                versions: vec![EventVersion {
                    version: "v1".into(),
                    doc: summary(&decl.doc),
                    source: rel(&decl.source),
                    fields: decl.fields.clone(),
                }],
                consumers,
                wire: Wire {
                    name: decl.key.clone(),
                    channel: None,
                },
            });
        }
        if named > 0 {
            b.warn(
                &agg_id,
                format!("{named} event(s) are dispatched by name, `Event::dispatch('...')`, and declare no payload; their fields are unknown"),
            );
        }
        if entities.is_empty() && evs.is_empty() && enums.is_empty() {
            continue;
        }
        aggregates.push(Aggregate {
            id: agg_id,
            slug: agg_slug,
            name: m.name.clone(),
            readme: module_readme(m),
            kind: Some("model-group".into()),
            root: String::new(),
            entities,
            value_objects: vec![],
            operations: vec![],
            events: evs,
            enums,
        });
    }

    // The store: the tables the migrations replay, and every access the
    // code makes to one, whether or not a migration declared it.
    let store_slug = if opts.store.is_empty() { "db".to_string() } else { opts.store.clone() };
    let store_id = format!("{svc_id}.{store_slug}");
    let mut table_accesses: BTreeMap<String, Vec<TableAccess>> = BTreeMap::new();
    for (file, chain, owner) in events::every_chain(&tree) {
        let Some((class, _)) = owner else { continue };
        let Some(access) = stores::access_of(&tree, class, chain) else { continue };
        let entry = table_accesses.entry(access.table.clone()).or_default();
        let source = format!("{}:{}", rel(&file.path), chain.line);
        if !entry.iter().any(|a| a.method == access.method && a.source == source) {
            entry.push(TableAccess {
                operation: access.operation,
                method: access.method,
                source,
            });
        }
    }
    let has_store = !schema.tables.is_empty() || !table_accesses.is_empty();
    let store_kind = if !opts.store_kind.is_empty() {
        opts.store_kind.clone()
    } else {
        stores::env_default(&root.join("config").join("database.php"), "DB_CONNECTION")
            .map(|c| stores::store_kind(&c).to_string())
            .unwrap_or_else(|| "mysql".into())
    };
    let queue_driver = stores::env_default(&root.join("config").join("queue.php"), "QUEUE_CONNECTION").unwrap_or_else(|| "sync".into());

    let lanes = Lanes {
        svc_id: svc_id.clone(),
        context: context.clone(),
        store: if has_store {
            Some((store_id.clone(), format!("{service}-{store_slug}")))
        } else {
            None
        },
        events: &events,
        event_ids: &event_ids,
        jobs: &jobs,
    };

    // Endpoints: one interface per module with routes, and one operation per route.
    let openapi_name = if opts.openapi_out.is_empty() {
        "openapi.inferred.yaml".to_string()
    } else {
        opts.openapi_out.clone()
    };
    let openapi_source = {
        let output = input.output.trim_matches('/');
        if output.is_empty() {
            rel(&root.join("portolan").join(&openapi_name))
        } else {
            format!("{output}/{openapi_name}")
        }
    };
    let mut op_ids: BTreeSet<String> = BTreeSet::new();
    let mut ops: Vec<Op> = Vec::new();
    let mut missing_controllers: BTreeSet<String> = BTreeSet::new();
    let mut provides: BTreeMap<usize, Vec<RpcMethod>> = BTreeMap::new();
    let mut flows: Vec<Flow> = Vec::new();
    let mut flow_slugs: BTreeSet<String> = BTreeSet::new();
    let mut ordered: Vec<&Endpoint> = endpoints.iter().collect();
    ordered.sort_by(|a, c| (&a.file, a.line, &a.verb, &a.path).cmp(&(&c.file, c.line, &c.verb, &c.path)));
    for ep in ordered {
        let m = &modules[ep.module];
        let (controller, doc) = match &ep.action {
            Action::Controller(class, method) => {
                let handler = tree.class(class).and_then(|c| find_method(&tree, c, method));
                if handler.is_none() && missing_controllers.insert(class.clone()) {
                    b.warn(
                        &rel(&ep.file),
                        format!("{class} answers routes here but is not in the tree; its operations have no doc and no flow past the call"),
                    );
                }
                (Some((class.clone(), method.clone())), handler.map(|(_, m)| m.doc.clone()).unwrap_or_default())
            }
            Action::Unknown => {
                b.warn(
                    &rel(&ep.file),
                    format!(
                        "the action of {} {} at line {} cannot be read from the source; the route is kept without one",
                        ep.verb, ep.path, ep.line
                    ),
                );
                (None, String::new())
            }
            _ => (None, String::new()),
        };
        let base_name = match (&ep.name, &controller) {
            (Some(n), _) => n.clone(),
            (None, Some((class, method))) => format!("{}.{method}", short(class).trim_end_matches("Controller")),
            (None, None) => format!("{} {}", ep.verb.to_ascii_lowercase(), ep.path),
        };
        let mut op_id = slug(&base_name).replace('-', "_");
        let stem = op_id.clone();
        let mut n = 2;
        while !op_ids.insert(op_id.clone()) {
            op_id = format!("{stem}_{n}");
            n += 1;
        }
        let summary_ = {
            let s = summary(&doc);
            if s.is_empty() { sentence(&slug(&base_name)) } else { s }
        };
        ops.push(Op {
            operation_id: op_id.clone(),
            verb: ep.verb.to_ascii_lowercase(),
            path: ep.path.clone(),
            summary: summary_.clone(),
            description: if doc.lines().count() > 1 { doc.clone() } else { String::new() },
            tag: m.slug.clone(),
            route_name: ep.name.clone(),
            source: format!("{}:{}", rel(&ep.file), ep.line),
        });
        if ep.verb == "ANY" {
            // Answers every verb: a path item in the document, no operation
            // and no flow, because there is no one call to draw.
            continue;
        }
        provides.entry(ep.module).or_default().push(RpcMethod {
            name: op_id.clone(),
            doc: summary_.clone(),
            http: HttpRoute {
                method: ep.verb.clone(),
                path: ep.path.clone(),
            },
        });

        // The flow: the call in, then whatever the handler does, followed
        // through the classes it holds.
        let mut effects = Vec::new();
        if let Some((class, method)) = &controller {
            follow(&tree, &jobs, class, method, 5, &mut BTreeSet::new(), &mut effects);
        }
        let mut participants = vec![
            Participant {
                id: "client".into(),
                kind: "actor".into(),
                context: None,
                label: None,
            },
            lanes.service(),
        ];
        let mut steps = vec![FlowNode::Step(Step {
            id: "s1".into(),
            from: "client".into(),
            to: svc_id.clone(),
            kind: "rpc".into(),
            label: op_id.clone(),
            status: "declared".into(),
            reference: None,
            note: None,
            line: Some(format!("{}:{}", rel(&ep.file), ep.line)),
            handoff: None,
            store_access: None,
        })];
        lanes.steps(&effects, &mut steps, &mut participants, &rel);
        let flow_slug = unique(&mut flow_slugs, format!("{service}-{}", op_id.replace('_', "-")));
        flows.push(Flow {
            id: format!("flow.{flow_slug}"),
            slug: flow_slug,
            name: sentence(&slug(&base_name)),
            summary: summary(&doc),
            source: rel(&ep.file),
            owner: context.clone(),
            participants,
            steps,
        });
    }
    let rpc_services: Vec<RpcService> = provides
        .into_iter()
        .map(|(i, mut methods)| {
            methods.sort_by(|a, c| a.name.cmp(&c.name));
            RpcService {
                id: format!("{svc_id}.{}", modules[i].slug),
                methods,
                source: openapi_source.clone(),
            }
        })
        .collect();

    // Policies: one flow per listener method, with every event it reacts to.
    let mut by_handler: BTreeMap<(String, String), Vec<&Listener>> = BTreeMap::new();
    for l in &events.listeners {
        by_handler.entry((l.class.clone(), l.method.clone())).or_default().push(l);
    }
    for ((class, method), listeners) in by_handler {
        let handler = tree.class(&class).and_then(|c| find_method(&tree, c, &method));
        let first = listeners[0];
        let source_file = tree.file_of(&class).map(|f| f.path.clone()).unwrap_or_else(|| first.file.clone());
        let flow_slug = unique(&mut flow_slugs, format!("{service}-{}-{}", slug(short(&class)), slug(&method)));
        let mut steps = Vec::new();
        for l in &listeners {
            let known = event_ids.contains_key(&l.key);
            if !known {
                b.warn(
                    &class,
                    format!(
                        "{}::{method} listens to `{}`, which nothing in the tree dispatches; the step is unresolved",
                        short(&class),
                        l.key
                    ),
                );
            }
            let line = handler.map(|(_, m)| m.line).unwrap_or(l.line);
            steps.push(FlowNode::Step(Step {
                id: format!("s{}", steps.len() + 1),
                from: "bus".into(),
                to: svc_id.clone(),
                kind: "event".into(),
                label: events.display(&l.key),
                status: if known { "declared".into() } else { "unresolved".into() },
                reference: event_ids.get(&l.key).cloned(),
                note: if known {
                    None
                } else {
                    Some(format!("Reacts to `{}`, which is not an event this tree dispatches.", l.key))
                },
                line: Some(format!("{}:{line}", rel(&source_file))),
                handoff: None,
                store_access: None,
            }));
        }
        let mut effects = Vec::new();
        follow(&tree, &jobs, &class, &method, 5, &mut BTreeSet::new(), &mut effects);
        let mut participants = vec![lanes.bus(), lanes.service()];
        lanes.steps(&effects, &mut steps, &mut participants, &rel);
        // `handle` says nothing; the class was named for what it does.
        let flow_name = if matches!(method.as_str(), "handle" | "__invoke") {
            sentence(&slug(short(&class)))
        } else {
            sentence(&slug(&method))
        };
        flows.push(Flow {
            id: format!("flow.{flow_slug}"),
            slug: flow_slug,
            name: flow_name,
            summary: handler.map(|(_, m)| summary(&m.doc)).unwrap_or_default(),
            source: rel(&source_file),
            owner: context.clone(),
            participants,
            steps,
        });
    }

    // Workers: one flow per job, from the queue in.
    let mut sorted_jobs: Vec<&jobs::Job> = jobs.jobs.iter().collect();
    sorted_jobs.sort_by(|a, c| a.fqn.cmp(&c.fqn));
    for job in &sorted_jobs {
        let queue = jobs.queue_of(&job.fqn, None);
        let handler = tree
            .class(&job.fqn)
            .and_then(|c| find_method(&tree, c, "handle").or_else(|| find_method(&tree, c, "__invoke")));
        let flow_slug = unique(&mut flow_slugs, format!("{service}-job-{}", slug(&job.name)));
        let mut participants = vec![lanes.queue(&queue), lanes.service()];
        let mut steps = vec![FlowNode::Step(Step {
            id: "s1".into(),
            from: lanes.queue(&queue).id,
            to: svc_id.clone(),
            kind: "call".into(),
            label: format!("work {}", job.name),
            status: "declared".into(),
            reference: None,
            note: None,
            line: Some(format!("{}:{}", rel(&job.file), handler.map(|(_, m)| m.line).unwrap_or(job.line))),
            handoff: Some(Handoff {
                kind: "job".into(),
                transport: "laravel-queue".into(),
                channel: queue.clone(),
                message: job.fqn.clone(),
                direction: "receive".into(),
            }),
            store_access: None,
        })];
        let mut effects = Vec::new();
        if let Some((_, m)) = handler {
            follow(&tree, &jobs, &job.fqn, &m.name, 5, &mut BTreeSet::new(), &mut effects);
        }
        lanes.steps(&effects, &mut steps, &mut participants, &rel);
        flows.push(Flow {
            id: format!("flow.{flow_slug}"),
            slug: flow_slug,
            name: sentence(&slug(&job.name)),
            summary: summary(&job.doc),
            source: rel(&job.file),
            owner: context.clone(),
            participants,
            steps,
        });
    }

    // Channels: one per queue, with what is put on it and what works it.
    let mut queues: BTreeMap<String, Vec<&jobs::Job>> = BTreeMap::new();
    for job in &sorted_jobs {
        queues.entry(jobs.queue_of(&job.fqn, None)).or_default().push(job);
    }
    for d in &jobs.dispatches {
        if let Some(job) = jobs.job(&d.job) {
            let queue = jobs.queue_of(&d.job, d.queue.as_deref());
            let entry = queues.entry(queue).or_default();
            if !entry.iter().any(|j| j.fqn == job.fqn) {
                entry.push(job);
            }
        }
    }
    let mut channels: Vec<Channel> = Vec::new();
    for (queue, jobs_on) in &queues {
        let mut messages = Vec::new();
        let mut source = String::new();
        let mut jobs_on: Vec<&&jobs::Job> = jobs_on.iter().collect();
        jobs_on.sort_by(|a, c| a.fqn.cmp(&c.fqn));
        for job in jobs_on {
            let sent = jobs
                .dispatches
                .iter()
                .filter(|d| d.job == job.fqn && jobs.queue_of(&d.job, d.queue.as_deref()) == *queue)
                .min_by_key(|d| (d.file.clone(), d.line));
            if let Some(d) = sent {
                if source.is_empty() {
                    source = format!("{}:{}", rel(&d.file), d.line);
                }
                messages.push(ChannelMessage {
                    name: job.fqn.clone(),
                    title: job.name.clone(),
                    doc: summary(&job.doc),
                    direction: "send".into(),
                });
            }
            let doc = summary(&job.doc);
            messages.push(ChannelMessage {
                name: job.fqn.clone(),
                title: job.name.clone(),
                doc: format!(
                    "Worked by `{}::handle` on the `{queue}` queue.{}{doc}",
                    job.name,
                    if doc.is_empty() { "" } else { " " }
                ),
                direction: "receive".into(),
            });
        }
        if source.is_empty()
            && let Some(job) = jobs_on_first(&queues[queue])
        {
            source = format!("{}:{}", rel(&job.file), job.line);
        }
        channels.push(Channel {
            address: queue.clone(),
            kind: "job".into(),
            title: format!("Queue · {queue}"),
            doc: format!("Jobs queued and worked through Laravel's queue over {queue_driver}."),
            messages,
            source,
        });
    }

    let svc = Service {
        id: svc_id.clone(),
        slug: service.clone(),
        name: name.clone(),
        repo: if opts.repo.is_empty() { composer_repo(&root) } else { opts.repo.clone() },
        path: rel(&root),
        readme,
        provides: rpc_services,
        consumes: vec![],
        aggregates,
        channels,
        stores: vec![],
    };
    if svc.aggregates.is_empty() && !modules.is_empty() {
        b.warn(
            &svc_id,
            "no models, events or enums under the modules; the fragment describes a service with no model",
        );
    }
    let has_provides = !svc.provides.is_empty();

    let fragment = Catalog {
        contexts: vec![Context {
            id: context.clone(),
            slug: context.clone(),
            name: if opts.context_name.is_empty() {
                title(&context)
            } else {
                opts.context_name.clone()
            },
            summary: opts.context_summary.clone().unwrap_or_default(),
            classification: opts.classification.clone(),
            services: vec![svc],
        }],
        defs: serde_json::Map::new(),
        flows,
        adrs: vec![],
        stores: vec![],
    };
    let contents = serde_json::to_string_pretty(&fragment).unwrap_or_default() + "\n";
    b.files.push(File {
        name: if opts.out.is_empty() { "domain.json".into() } else { opts.out.clone() },
        contents,
    });
    if has_provides {
        b.files.push(File {
            name: openapi_name,
            contents: to_yaml(&openapi::document(&ops, &name)),
        });
    }

    // The store fragment: the tables, what each persists, and who touches it.
    if has_store {
        let mut tables: Vec<Table> = Vec::new();
        let mut seen: BTreeSet<String> = BTreeSet::new();
        let mut missing_fk: BTreeSet<String> = BTreeSet::new();
        for def in &schema.tables {
            seen.insert(def.name.clone());
            let persists = persisted.get(&def.name);
            let model_fields: Vec<String> = persists
                .and_then(|(_, _, fqn)| tree.class(fqn))
                .map(|c| models::fields_of(c).into_iter().map(|f| f.name).collect())
                .unwrap_or_default();
            let model_name = persists.and_then(|(_, _, fqn)| tree.class(fqn)).map(|c| c.name.clone());
            tables.push(Table {
                id: format!("{store_id}.{}", def.name),
                name: def.name.clone(),
                doc: String::new(),
                columns: def
                    .columns
                    .iter()
                    .map(|c| Column {
                        name: c.name.clone(),
                        type_: c.type_.clone(),
                        nullable: c.nullable,
                        pk: c.pk,
                        // A key into a table this tree does not create - the
                        // framework's, or a package not read - has nowhere to
                        // point; it is dropped and reported once per target.
                        fk: c.fk.clone().and_then(|f| {
                            let known = schema
                                .tables
                                .iter()
                                .any(|t| t.name == f.table && t.columns.iter().any(|col| col.name == f.column));
                            if known {
                                Some(ForeignKey {
                                    table: format!("{store_id}.{}", f.table),
                                    ..f
                                })
                            } else {
                                missing_fk.insert(format!("{}.{}", f.table, f.column));
                                None
                            }
                        }),
                        maps: match &model_name {
                            Some(model) if model_fields.contains(&c.name) => Some(format!("{model}.{}", c.name)),
                            _ => None,
                        },
                        doc: c.doc.clone(),
                    })
                    .collect(),
                indexes: def
                    .indexes
                    .iter()
                    .map(|i| crate::catalog::TableIndex {
                        name: i.name.clone(),
                        columns: i.columns.clone(),
                        unique: i.unique,
                    })
                    .collect(),
                persists: persists.map(|(aggregate, block, _)| Persists {
                    aggregate: aggregate.clone(),
                    block: block.clone(),
                }),
                accesses: table_accesses.remove(&def.name).unwrap_or_default(),
            });
        }
        for target in &missing_fk {
            b.warn(
                &store_id,
                format!("a foreign key points at `{target}`, which no migration in the tree creates; the key is left off"),
            );
        }
        // A table the code reaches that no migration here declares: kept,
        // with no columns, so that the access has somewhere to land.
        for (name, accesses) in table_accesses {
            if seen.contains(&name) {
                continue;
            }
            let persists = persisted.get(&name);
            b.warn(
                &format!("{store_id}.{name}"),
                format!("the code reads or writes `{name}`, which no migration in the tree creates; the table is kept with no columns"),
            );
            tables.push(Table {
                id: format!("{store_id}.{name}"),
                name: name.clone(),
                doc: String::new(),
                columns: vec![],
                indexes: vec![],
                persists: persists.map(|(aggregate, block, _)| Persists {
                    aggregate: aggregate.clone(),
                    block: block.clone(),
                }),
                accesses,
            });
        }
        let store_fragment = Catalog {
            contexts: vec![Context {
                id: context.clone(),
                slug: context.clone(),
                name: String::new(),
                summary: String::new(),
                classification: None,
                services: vec![Service {
                    id: svc_id.clone(),
                    slug: service.clone(),
                    name: String::new(),
                    repo: String::new(),
                    path: String::new(),
                    readme: String::new(),
                    provides: vec![],
                    consumes: vec![],
                    aggregates: vec![],
                    channels: vec![],
                    stores: vec![store_id.clone()],
                }],
            }],
            defs: serde_json::Map::new(),
            flows: vec![],
            adrs: vec![],
            stores: vec![Store {
                id: store_id.clone(),
                slug: store_slug,
                name: format!("{name} database"),
                kind: store_kind,
                owner: svc_id.clone(),
                tables,
                source: rel(&root),
            }],
        };
        b.files.push(File {
            name: if opts.stores_out.is_empty() {
                "stores.json".into()
            } else {
                opts.stores_out.clone()
            },
            contents: serde_json::to_string_pretty(&store_fragment).unwrap_or_default() + "\n",
        });
    }

    Response {
        files: b.files,
        warnings: b.warnings,
        describe: None,
    }
}

fn jobs_on_first<'a>(jobs: &[&'a jobs::Job]) -> Option<&'a jobs::Job> {
    jobs.iter().min_by_key(|j| (&j.file, j.line)).copied()
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

/// What a method does that a flow draws: an event out, a job handed to a
/// queue, a table read or written.
#[derive(Debug, Clone)]
enum Effect {
    Publish { key: String, file: PathBuf, line: u32 },
    Enqueue { job: String, queue: String, file: PathBuf, line: u32 },
    Access { method: String, file: PathBuf, line: u32 },
}

/// The lanes a flow can have besides the caller: the service, the bus, the
/// store, and one broker per queue - and how each effect becomes a step.
struct Lanes<'a> {
    svc_id: String,
    context: String,
    store: Option<(String, String)>,
    events: &'a Events,
    event_ids: &'a BTreeMap<String, String>,
    jobs: &'a Jobs,
}

impl Lanes<'_> {
    fn service(&self) -> Participant {
        Participant {
            id: self.svc_id.clone(),
            kind: "service".into(),
            context: Some(self.context.clone()),
            label: None,
        }
    }
    fn bus(&self) -> Participant {
        Participant {
            id: "bus".into(),
            kind: "broker".into(),
            context: None,
            label: None,
        }
    }
    fn queue(&self, queue: &str) -> Participant {
        Participant {
            id: format!("queue-{}", slug(queue)),
            kind: "broker".into(),
            context: None,
            label: Some(format!("Queue · {queue}")),
        }
    }
    fn store_lane(&self) -> Option<Participant> {
        self.store.as_ref().map(|(_, id)| Participant {
            id: id.clone(),
            kind: "store".into(),
            context: Some(self.context.clone()),
            label: None,
        })
    }

    fn steps(&self, effects: &[Effect], steps: &mut Vec<FlowNode>, participants: &mut Vec<Participant>, rel: &dyn Fn(&Path) -> String) {
        let mut lane = |p: Participant| {
            if !participants.iter().any(|x| x.id == p.id) {
                participants.push(p);
            }
        };
        for effect in effects {
            let n = steps.len() + 1;
            match effect {
                Effect::Publish { key, file, line } => {
                    lane(self.bus());
                    let known = self.event_ids.get(key);
                    steps.push(FlowNode::Step(Step {
                        id: format!("s{n}"),
                        from: self.svc_id.clone(),
                        to: "bus".into(),
                        kind: "event".into(),
                        label: self.events.display(key),
                        status: if known.is_some() { "declared".into() } else { "unresolved".into() },
                        reference: known.cloned(),
                        note: None,
                        line: Some(format!("{}:{line}", rel(file))),
                        handoff: None,
                        store_access: None,
                    }));
                }
                Effect::Enqueue { job, queue, file, line } => {
                    let broker = self.queue(queue);
                    let to = broker.id.clone();
                    lane(broker);
                    steps.push(FlowNode::Step(Step {
                        id: format!("s{n}"),
                        from: self.svc_id.clone(),
                        to,
                        kind: "call".into(),
                        label: format!(
                            "enqueue {}",
                            self.jobs.job(job).map(|j| j.name.clone()).unwrap_or_else(|| short(job).to_string())
                        ),
                        status: "declared".into(),
                        reference: None,
                        note: None,
                        line: Some(format!("{}:{line}", rel(file))),
                        handoff: Some(Handoff {
                            kind: "job".into(),
                            transport: "laravel-queue".into(),
                            channel: queue.clone(),
                            message: job.clone(),
                            direction: "send".into(),
                        }),
                        store_access: None,
                    }));
                }
                Effect::Access { method, file, line } => {
                    let Some(store) = self.store_lane() else { continue };
                    let to = store.id.clone();
                    lane(store);
                    steps.push(FlowNode::Step(Step {
                        id: format!("s{n}"),
                        from: self.svc_id.clone(),
                        to,
                        kind: "call".into(),
                        label: method.clone(),
                        status: "declared".into(),
                        reference: None,
                        note: None,
                        line: Some(format!("{}:{line}", rel(file))),
                        handoff: None,
                        store_access: Some(StoreAccess {
                            store: self.store.as_ref().map(|(id, _)| id.clone()).unwrap_or_default(),
                            method: method.clone(),
                        }),
                    }));
                }
            }
        }
    }
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
/// classes it holds: `$this->orders->create(...)` reaches OrderRepository's
/// `create` when the constructor promoted `$orders` with that type, and a
/// step is drawn for each event, job and table on the way.
fn follow(tree: &Tree, jobs: &Jobs, class: &str, method: &str, depth: usize, visited: &mut BTreeSet<(String, String)>, out: &mut Vec<Effect>) {
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
        if let Some(key) = events::dispatched(tree, chain) {
            push_unique(
                out,
                Effect::Publish {
                    key,
                    file: file.path.clone(),
                    line: chain.line,
                },
            );
            continue;
        }
        let enqueued = jobs::dispatched(tree, jobs, chain);
        if !enqueued.is_empty() {
            for (job, queue) in enqueued {
                let queue = jobs.queue_of(&job, queue.as_deref());
                push_unique(
                    out,
                    Effect::Enqueue {
                        job,
                        queue,
                        file: file.path.clone(),
                        line: chain.line,
                    },
                );
            }
            continue;
        }
        if let Some(access) = stores::access_of(tree, owner, chain) {
            push_unique(
                out,
                Effect::Access {
                    method: access.method,
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
            _ => None,
        };
        if let Some((target, name)) = target.filter(|(t, _)| tree.class(t).is_some()) {
            follow(tree, jobs, &target, &name, depth - 1, visited, out);
        }
    }
}

fn push_unique(out: &mut Vec<Effect>, effect: Effect) {
    let same = |a: &Effect| match (a, &effect) {
        (Effect::Publish { key: k1, file: f1, line: l1 }, Effect::Publish { key: k2, file: f2, line: l2 }) => k1 == k2 && f1 == f2 && l1 == l2,
        (
            Effect::Enqueue {
                job: j1, file: f1, line: l1, ..
            },
            Effect::Enqueue {
                job: j2, file: f2, line: l2, ..
            },
        ) => j1 == j2 && f1 == f2 && l1 == l2,
        (
            Effect::Access {
                method: m1,
                file: f1,
                line: l1,
                ..
            },
            Effect::Access {
                method: m2,
                file: f2,
                line: l2,
                ..
            },
        ) => m1 == m2 && f1 == f2 && l1 == l2,
        _ => false,
    };
    if !out.iter().any(same) {
        out.push(effect);
    }
}

fn readme_title(md: &str) -> Option<String> {
    md.lines().map(str::trim).find_map(|l| l.strip_prefix("# ").map(|t| t.trim().to_string()))
}

fn module_readme(m: &Module) -> String {
    for candidate in [m.dir.join("README.md"), m.dir.parent().map(|p| p.join("README.md")).unwrap_or_default()] {
        if let Ok(text) = fs::read_to_string(&candidate) {
            return text.trim().to_string();
        }
    }
    String::new()
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
    let candidates = [
        json.pointer("/support/source").and_then(|v| v.as_str()),
        json.get("homepage").and_then(|v| v.as_str()),
    ];
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
