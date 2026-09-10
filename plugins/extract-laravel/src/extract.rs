//! One application in, one fragment out - two, when the routes prove an HTTP
//! contract. A fragment, not a catalog: it carries one context and one
//! service, and is merged with everything else before anything validates it.
//!
//! The service is the application; each module is a model group under it,
//! the way a Django application is under extract-django. A monolith of
//! forty packages is one service with forty groups, and the events that
//! cross between them are the reason the groups are worth telling apart.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::catalog::{
    Aggregate, Catalog, Context, Event, EventConsumer, EventVersion, Flow, FlowNode, HttpRoute, Participant, RpcMethod, RpcService, Service, Step, Wire,
};
use crate::events::{self, Events, Kind, Listener};
use crate::ids::{aggregate_id, event_id, sentence, service_id, short, slug, title};
use crate::layout::{self, Module};
use crate::models;
use crate::openapi::{self, Op};
use crate::protocol::{Builder, File, Input, Options, Response};
use crate::routes::{self, Action, Endpoint};
use crate::source::{Base, ClassInfo, MethodInfo, Tree, summary};
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
    let endpoints: Vec<Endpoint> = tree.files.iter().filter(|f| layout::is_route_file(&f.path)).flat_map(routes::read).collect();

    // Aggregates: one model group per module that has anything in it.
    let mut aggregates: Vec<Aggregate> = Vec::new();
    let mut event_ids: BTreeMap<String, String> = BTreeMap::new();
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

        // The flow: the call in, then whatever the handler publishes, followed
        // through the classes it holds.
        let mut publishes = Vec::new();
        if let Some((class, method)) = &controller {
            follow(&tree, class, method, 5, &mut BTreeSet::new(), &mut publishes);
        }
        let mut flow_slug = format!("{service}-{}", op_id.replace('_', "-"));
        let stem = flow_slug.clone();
        let mut n = 2;
        while !flow_slugs.insert(flow_slug.clone()) {
            flow_slug = format!("{stem}-{n}");
            n += 1;
        }
        let mut participants = vec![
            Participant {
                id: "client".into(),
                kind: "actor".into(),
                context: None,
                label: None,
            },
            Participant {
                id: svc_id.clone(),
                kind: "service".into(),
                context: Some(context.clone()),
                label: None,
            },
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
        })];
        if !publishes.is_empty() {
            participants.push(Participant {
                id: "bus".into(),
                kind: "broker".into(),
                context: None,
                label: None,
            });
        }
        for (key, file, line) in &publishes {
            steps.push(publish_step(steps.len() + 1, &svc_id, key, &events, &event_ids, &rel(file), *line));
        }
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
        let mut flow_slug = format!("{service}-{}-{}", slug(short(&class)), slug(&method));
        let stem = flow_slug.clone();
        let mut n = 2;
        while !flow_slugs.insert(flow_slug.clone()) {
            flow_slug = format!("{stem}-{n}");
            n += 1;
        }
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
            }));
        }
        let mut publishes = Vec::new();
        follow(&tree, &class, &method, 5, &mut BTreeSet::new(), &mut publishes);
        for (key, file, line) in &publishes {
            steps.push(publish_step(steps.len() + 1, &svc_id, key, &events, &event_ids, &rel(file), *line));
        }
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
            participants: vec![
                Participant {
                    id: "bus".into(),
                    kind: "broker".into(),
                    context: None,
                    label: None,
                },
                Participant {
                    id: svc_id.clone(),
                    kind: "service".into(),
                    context: Some(context.clone()),
                    label: None,
                },
            ],
            steps,
        });
    }

    let svc = Service {
        id: svc_id.clone(),
        slug: service,
        name: name.clone(),
        repo: if opts.repo.is_empty() { composer_repo(&root) } else { opts.repo.clone() },
        path: rel(&root),
        readme,
        provides: rpc_services,
        consumes: vec![],
        aggregates,
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
    Response {
        files: b.files,
        warnings: b.warnings,
        describe: None,
    }
}

fn publish_step(n: usize, svc_id: &str, key: &str, events: &Events, event_ids: &BTreeMap<String, String>, file: &str, line: u32) -> FlowNode {
    let known = event_ids.get(key);
    FlowNode::Step(Step {
        id: format!("s{n}"),
        from: svc_id.to_string(),
        to: "bus".into(),
        kind: "event".into(),
        label: events.display(key),
        status: if known.is_some() { "declared".into() } else { "unresolved".into() },
        reference: known.cloned(),
        note: None,
        line: Some(format!("{file}:{line}")),
    })
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

/// What a method publishes, itself and through the methods it calls on the
/// classes it holds: `$this->orders->create(...)` reaches OrderRepository's
/// `create` when the constructor promoted `$orders` with that type.
fn follow(tree: &Tree, class: &str, method: &str, depth: usize, visited: &mut BTreeSet<(String, String)>, out: &mut Vec<(String, PathBuf, u32)>) {
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
            if !out.iter().any(|(k, f, l)| k == &key && f == &file.path && *l == chain.line) {
                out.push((key, file.path.clone(), chain.line));
            }
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
            follow(tree, &target, &name, depth - 1, visited, out);
        }
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
