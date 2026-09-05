//! One service in, one fragment out. A fragment, not a catalog: it carries one
//! context and one service, names peers it does not own, and is merged with
//! everything else before anything validates it.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::catalog::{Catalog, Context, Service};
use crate::domain::read_aggregates;
use crate::flows::{FlowOptions, FlowReader};
use crate::ids::{service_id, title};
use crate::operations::{operation_of, read_use_cases};
use crate::protocol::{Builder, File, Input, Options, Response};
use crate::source::Crate;
use crate::transport::read_transport;
use crate::wiring::read_bindings;

pub fn extract(input: &Input, opts: &Options, cwd: &Path) -> Response {
    let mut b = Builder::default();
    let root = cwd.join(&input.root);
    let cwd_owned = cwd.to_path_buf();
    let rel = move |abs: &Path| -> String { abs.strip_prefix(&cwd_owned).unwrap_or(abs).to_string_lossy().replace('\\', "/") };
    let src = root.join(if opts.source.is_empty() { "src" } else { opts.source.as_str() });

    let base = root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let context = if opts.context.is_empty() { base.clone() } else { opts.context.clone() };
    let service = if opts.service.is_empty() { base.clone() } else { opts.service.clone() };
    let svc_id = service_id(&context, &service);
    let readme = fs::read_to_string(root.join("README.md")).map(|s| s.trim().to_string()).unwrap_or_default();

    let krate = Crate::load(&src);
    let mut aggregates = read_aggregates(&krate, &src.join("domain"), &svc_id, &rel, &mut b);
    let use_cases = read_use_cases(&krate, &src.join("application"), &rel, &mut b);
    let bindings = read_bindings(&krate);
    let endpoints = read_transport(&krate, &src.join("infrastructure").join("transport").join("grpc"), &rel, &mut b);

    // Operations belong to the aggregate their use case sits under.
    let mut exposed_by: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for endpoint in &endpoints {
        for key in &endpoint.use_cases {
            exposed_by.entry(key.clone()).or_default().push(endpoint.id.clone());
        }
    }
    for uc in &use_cases {
        let Some(agg) = aggregates.iter_mut().find(|a| a.aggregate.slug == uc.aggregate) else {
            b.warn(
                &svc_id,
                format!(
                    "{} sits under application/{}, but there is no matching aggregate under domain",
                    rel(&uc.dir),
                    uc.aggregate
                ),
            );
            continue;
        };
        let mut op = operation_of(uc);
        if let Some(routes) = exposed_by.get(&uc.key) {
            let mut routes = routes.clone();
            routes.sort();
            op.exposed_by = Some(routes);
        }
        agg.aggregate.operations.push(op);
    }
    for agg in &mut aggregates {
        agg.aggregate.operations.sort_by(|a, c| a.id.cmp(&c.id));
    }

    let mut flows = Vec::new();
    let consumes;
    let referenced;
    {
        let mut reader = FlowReader::new(
            FlowOptions {
                context: context.clone(),
                svc_id: svc_id.clone(),
                service: service.clone(),
                store: opts.store.clone(),
                peers: opts.peers.clone(),
                events: opts.events.clone(),
            },
            &krate,
            &use_cases,
            &bindings,
            &aggregates,
            &rel,
            &mut b,
        );
        for endpoint in &endpoints {
            flows.push(reader.endpoint_flow(endpoint));
        }
        flows.extend(reader.policy_flows(&src.join("application").join("policy")));
        consumes = reader.consumes();
        referenced = reader.referenced.clone();
    }
    for agg in &aggregates {
        for id in agg.events.values() {
            if !referenced.contains(id) {
                b.warn(id, "no flow reaches this event: nothing this extractor could follow publishes it");
            }
        }
    }

    let name = if !opts.service_name.is_empty() {
        opts.service_name.clone()
    } else {
        readme_title(&readme).unwrap_or_else(|| title(&service))
    };
    let svc = Service {
        id: svc_id.clone(),
        slug: service,
        name,
        repo: if opts.repo.is_empty() { cargo_repo(&root) } else { opts.repo.clone() },
        path: rel(&root),
        readme,
        provides: vec![],
        consumes,
        aggregates: aggregates.into_iter().map(|a| a.aggregate).collect(),
    };
    if svc.aggregates.is_empty() {
        b.warn(&svc_id, "no aggregates found under domain; the fragment describes a service with no model");
    }

    let fragment = Catalog {
        generated_at: input.generated_at.clone(),
        commit: input.commit.clone(),
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
    Response {
        files: b.files,
        warnings: b.warnings,
        describe: None,
    }
}

fn readme_title(md: &str) -> Option<String> {
    md.lines().map(str::trim).find_map(|l| l.strip_prefix("# ").map(|t| t.trim().to_string()))
}

/// Cargo.toml's repository, spelled the way go.mod spells a module: host/owner/name.
fn cargo_repo(root: &Path) -> String {
    let Ok(text) = fs::read_to_string(root.join("Cargo.toml")) else {
        return String::new();
    };
    let url = text
        .lines()
        .map(str::trim)
        .find_map(|l| {
            l.strip_prefix("repository")
                .and_then(|r| r.trim().strip_prefix('='))
                .map(|v| v.trim().trim_matches('"').to_string())
        })
        .unwrap_or_default();
    url.trim_start_matches("git+")
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_start_matches("ssh://")
        .trim_start_matches("git@")
        .replacen(':', "/", if url.starts_with("git@") { 1 } else { 0 })
        .trim_end_matches(".git")
        .trim_end_matches('/')
        .to_string()
}

pub fn _unused(_: PathBuf) {}
