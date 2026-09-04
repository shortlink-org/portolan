//! Aggregates, read off src/domain: the root by the directory's name, the
//! entities beside it, the value objects under vo/, the events under event/.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use syn::{Expr, Fields, ImplItem, Item, ItemStruct, Lit};

use crate::catalog::{Aggregate, Block, Event, EventVersion, Field, Wire};
use crate::ids::{aggregate_id, block_id, event_id, pascal, slug, title};
use crate::lifecycle::read_lifecycle;
use crate::protocol::Builder;
use crate::source::{Crate, Source, doc_of, type_text};

/// An aggregate as read, with what the flows need beside the catalog's view of it.
pub struct AggregateRead {
    pub aggregate: Aggregate,
    /// The directory it was read from, absolute.
    pub dir: PathBuf,
    /// Event struct name → event id, for the flows.
    pub events: BTreeMap<String, String>,
    /// Struct names declared in the directory's own files: the root and the entities.
    pub own: Vec<String>,
}

pub fn read_aggregates(krate: &Crate, domain: &Path, svc_id: &str, rel: &dyn Fn(&Path) -> String, b: &mut Builder) -> Vec<AggregateRead> {
    let Ok(entries) = fs::read_dir(domain) else { return vec![] };
    let mut dirs: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    dirs.sort();
    dirs.into_iter().filter_map(|dir| read_aggregate(krate, &dir, svc_id, rel, b)).collect()
}

fn read_aggregate(krate: &Crate, dir: &Path, svc_id: &str, rel: &dyn Fn(&Path) -> String, b: &mut Builder) -> Option<AggregateRead> {
    let name = dir.file_name()?.to_string_lossy().to_string();
    let id = aggregate_id(svc_id, &name);
    let root_name = pascal(&name);
    let mut own = Vec::new();
    let mut entities = Vec::new();
    let mut root: Option<(&Source, &ItemStruct)> = None;

    for src in krate.in_dir(dir) {
        for st in src.structs().filter(|s| crate::source::is_public(&s.vis)) {
            own.push(st.ident.to_string());
            if st.ident == root_name {
                root = Some((src, st));
            }
            entities.push(block(&id, st));
        }
    }
    let Some((root_src, root_struct)) = root else {
        b.warn(
            &id,
            format!(
                "{} has no struct {root_name}; a domain directory is named after its root, and this one is skipped",
                rel(dir)
            ),
        );
        return None;
    };
    // The root first, then the entities in file order, as the other extractors list them.
    entities.sort_by_key(|e| if e.name == root_name { 0 } else { 1 });

    let mut value_objects = Vec::new();
    for src in krate.in_dir(&dir.join("vo")) {
        for st in src.structs().filter(|s| crate::source::is_public(&s.vis)) {
            value_objects.push(block(&id, st));
        }
    }

    let channel = channel_of(krate, dir, &name);
    let mut events = Vec::new();
    let mut event_ids = BTreeMap::new();
    for src in krate.in_dir(&dir.join("event")) {
        for st in src.structs().filter(|s| crate::source::is_public(&s.vis)) {
            let Some(wire) = wire_name(src, &st.ident.to_string()) else {
                b.warn(
                    &id,
                    format!(
                        "{}: struct {} names no event - no `fn name` returning a literal and no `NAME` constant - so it is not read as an event",
                        rel(&src.path),
                        st.ident
                    ),
                );
                continue;
            };
            let ev_id = event_id(&id, &st.ident.to_string());
            event_ids.insert(st.ident.to_string(), ev_id.clone());
            events.push(Event {
                id: ev_id,
                slug: slug(&st.ident.to_string()),
                name: st.ident.to_string(),
                versions: vec![EventVersion {
                    version: "v1".into(),
                    doc: doc_of(&st.attrs),
                    source: rel(&src.path),
                    fields: fields(st),
                }],
                consumers: vec![],
                wire: Wire {
                    name: wire,
                    channel: channel.clone(),
                },
            });
        }
    }

    let readme = fs::read_to_string(dir.join("README.md"))
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| doc_of(&root_struct.attrs));
    let lifecycle = read_lifecycle(krate, dir, root_src, root_struct, &event_ids, &id, rel, b);

    Some(AggregateRead {
        aggregate: Aggregate {
            id,
            slug: name.clone(),
            name: title(&name),
            readme,
            root: root_name,
            entities,
            value_objects,
            operations: vec![],
            events,
            lifecycle,
        },
        dir: dir.to_path_buf(),
        events: event_ids,
        own,
    })
}

/// The event's name on the bus: `fn name(&self) -> &'static str { "oms.OrderPlaced" }`
/// in any impl of the struct, inherent or of a trait, or `pub const NAME: &str = "…"`.
fn wire_name(src: &Source, struct_name: &str) -> Option<String> {
    for im in src.impls_of(struct_name) {
        for item in &im.items {
            match item {
                ImplItem::Fn(f) if f.sig.ident == "name" => {
                    if let Some(lit) = returned_literal(&f.block) {
                        return Some(lit);
                    }
                }
                ImplItem::Const(c) if c.ident == "NAME" => {
                    if let Expr::Lit(syn::ExprLit { lit: Lit::Str(s), .. }) = &c.expr {
                        return Some(s.value());
                    }
                }
                _ => {}
            }
        }
    }
    for item in &src.file.items {
        if let Item::Const(c) = item
            && c.ident == "NAME"
            && let Expr::Lit(syn::ExprLit { lit: Lit::Str(s), .. }) = &*c.expr
        {
            return Some(s.value());
        }
    }
    None
}

/// The string a one-expression body hands back: the tail expression, or a `return`.
pub fn returned_literal(block: &syn::Block) -> Option<String> {
    for stmt in &block.stmts {
        let expr = match stmt {
            syn::Stmt::Expr(e, _) => e,
            _ => continue,
        };
        let expr = match expr {
            Expr::Return(r) => r.expr.as_deref()?,
            e => e,
        };
        if let Expr::Lit(syn::ExprLit { lit: Lit::Str(s), .. }) = expr {
            return Some(s.value());
        }
    }
    None
}

/// Where the aggregate's events go: the `TOPIC` constant of
/// src/infrastructure/repository/<aggregate>/*.rs, the module that turns a
/// domain event into a message. The domain names the event and the adapter
/// names the channel, because the channel is a fact about the transport, not
/// about what happened. None when the module or the constant is missing.
fn channel_of(krate: &Crate, domain_dir: &Path, aggregate: &str) -> Option<String> {
    let repo = domain_dir.parent()?.parent()?.join("infrastructure").join("repository").join(aggregate);
    for src in krate.in_dir(&repo) {
        for item in &src.file.items {
            if let Item::Const(c) = item
                && c.ident == "TOPIC"
                && let Expr::Lit(syn::ExprLit { lit: Lit::Str(s), .. }) = &*c.expr
            {
                return Some(s.value());
            }
        }
    }
    None
}

fn block(aggregate: &str, st: &ItemStruct) -> Block {
    let name = st.ident.to_string();
    Block {
        id: block_id(aggregate, &slug(&name)),
        slug: slug(&name),
        name,
        doc: doc_of(&st.attrs),
        fields: fields(st),
    }
}

/// The fields of a struct, with the type as written; a tuple struct's are numbered.
pub fn fields(st: &ItemStruct) -> Vec<Field> {
    match &st.fields {
        Fields::Named(named) => named
            .named
            .iter()
            .map(|f| Field {
                name: f.ident.as_ref().map(|i| i.to_string()).unwrap_or_default(),
                type_: type_text(&f.ty),
                doc: doc_of(&f.attrs),
            })
            .collect(),
        Fields::Unnamed(unnamed) => unnamed
            .unnamed
            .iter()
            .enumerate()
            .map(|(i, f)| Field {
                name: i.to_string(),
                type_: type_text(&f.ty),
                doc: doc_of(&f.attrs),
            })
            .collect(),
        Fields::Unit => vec![],
    }
}
