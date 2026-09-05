//! Use cases, read off src/application: each `usecases/<name>/mod.rs` is an
//! operation of the aggregate its directory is named after, and the fields of
//! its `UseCase` struct are the ports it reaches through.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use syn::visit::Visit;
use syn::{Expr, Fields, GenericParam, ItemStruct, Type};

use crate::catalog::Operation;
use crate::ids::camel;
use crate::protocol::Builder;
use crate::source::{Crate, Source, bare_type, doc_of, first_paragraph, type_text};

/// A use case: where it is, what it is called, and what it holds.
pub struct UseCase<'a> {
    /// "<aggregate>/<name>", the key the flows and the bindings use.
    pub key: String,
    pub aggregate: String,
    pub name: String,
    pub dir: PathBuf,
    pub source: &'a Source,
    pub strukt: &'a ItemStruct,
    /// Port name → the trait it is typed with, wrappers and generics resolved.
    pub ports: BTreeMap<String, String>,
}

/// The verbs that make a use case a command: what it does to a port that changes the world.
pub const WRITE_METHODS: &[&str] = &["save", "delete", "create", "update", "publish", "remove", "insert", "upsert"];

pub fn read_use_cases<'a>(krate: &'a Crate, application: &Path, rel: &dyn Fn(&Path) -> String, b: &mut Builder) -> Vec<UseCase<'a>> {
    let Ok(entries) = fs::read_dir(application) else { return vec![] };
    let mut aggregates: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    aggregates.sort();
    let mut out = Vec::new();
    for agg_dir in aggregates {
        let aggregate = agg_dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let usecases = agg_dir.join("usecases");
        if aggregate == "policy" || !usecases.is_dir() {
            continue;
        }
        let Ok(names) = fs::read_dir(&usecases) else { continue };
        let mut dirs: Vec<PathBuf> = names.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
        dirs.sort();
        for dir in dirs {
            let name = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let key = format!("{aggregate}/{name}");
            let file = dir.join("mod.rs");
            let found = krate
                .get(&file)
                .and_then(|src| src.structs().find(|s| s.ident == "UseCase").map(|st| (src, st)));
            let Some((source, strukt)) = found else {
                b.warn(
                    &key,
                    format!("{} has no pub struct UseCase in mod.rs; the use case contributes nothing", rel(&dir)),
                );
                continue;
            };
            if source.method("UseCase", "handle").is_none() {
                b.warn(&key, format!("{}: UseCase has no handle method; the use case contributes no steps", rel(&file)));
            }
            let ports = ports_of(strukt);
            out.push(UseCase {
                key,
                aggregate: aggregate.clone(),
                name,
                dir,
                source,
                strukt,
                ports,
            });
        }
    }
    out
}

/// The struct's fields as ports: `orders: Arc<dyn Orders>` is Orders, and a
/// field typed by a generic parameter, `orders: O` under `O: Orders`, is the
/// bound the parameter carries. A function-typed field, `Box<dyn Fn() -> …>`,
/// is a clock and no port.
pub fn ports_of(st: &ItemStruct) -> BTreeMap<String, String> {
    let mut bounds: BTreeMap<String, String> = BTreeMap::new();
    for param in &st.generics.params {
        if let GenericParam::Type(t) = param
            && let Some(bound) = first_trait_bound(&t.bounds)
        {
            bounds.insert(t.ident.to_string(), bound);
        }
    }
    if let Some(wc) = &st.generics.where_clause {
        for pred in &wc.predicates {
            if let syn::WherePredicate::Type(pt) = pred
                && let (Type::Path(p), Some(bound)) = (&pt.bounded_ty, first_trait_bound(&pt.bounds))
                && let Some(id) = p.path.get_ident()
            {
                bounds.insert(id.to_string(), bound);
            }
        }
    }
    let mut out = BTreeMap::new();
    if let Fields::Named(named) = &st.fields {
        for f in &named.named {
            let Some(name) = &f.ident else { continue };
            let written = type_text(&f.ty);
            if written.contains("Fn(") || written.contains("fn(") {
                continue;
            }
            let bare = bare_type(&f.ty);
            let resolved = bounds.get(&bare).cloned().unwrap_or(bare);
            out.insert(name.to_string(), resolved);
        }
    }
    out
}

fn first_trait_bound(bounds: &syn::punctuated::Punctuated<syn::TypeParamBound, syn::Token![+]>) -> Option<String> {
    bounds.iter().find_map(|b| match b {
        syn::TypeParamBound::Trait(t) => {
            let name = t.path.segments.last()?.ident.to_string();
            if matches!(name.as_str(), "Send" | "Sync" | "Clone" | "Sized" | "Fn" | "FnMut" | "FnOnce") {
                None
            } else {
                Some(name)
            }
        }
        _ => None,
    })
}

/// The use case as an operation of its aggregate. `exposedBy` is filled by the transport reader.
pub fn operation_of(uc: &UseCase) -> Operation {
    Operation {
        id: camel(&uc.name),
        kind: if is_command(uc) { "command".into() } else { "query".into() },
        doc: doc_of_use_case(uc),
        exposed_by: None,
    }
}

/// README.md's first paragraph after the title, or the doc comment above the struct.
pub fn doc_of_use_case(uc: &UseCase) -> String {
    if let Ok(text) = fs::read_to_string(uc.dir.join("README.md")) {
        for paragraph in text.split("\n\n").map(str::trim) {
            if !paragraph.is_empty() && !paragraph.starts_with('#') {
                return paragraph.split_whitespace().collect::<Vec<_>>().join(" ");
            }
        }
    }
    first_paragraph(&doc_of(&uc.strukt.attrs))
}

/// A command writes through a port; a query only reads. Read off every method of the struct.
fn is_command(uc: &UseCase) -> bool {
    struct Writes<'a> {
        ports: &'a BTreeMap<String, String>,
        found: bool,
    }
    impl<'ast> Visit<'ast> for Writes<'_> {
        fn visit_expr_method_call(&mut self, call: &'ast syn::ExprMethodCall) {
            let method = call.method.to_string().to_lowercase();
            if WRITE_METHODS.contains(&method.as_str())
                && let Expr::Field(f) = &*call.receiver
                && let syn::Member::Named(port) = &f.member
                && matches!(&*f.base, Expr::Path(p) if p.path.is_ident("self"))
                && self.ports.contains_key(&port.to_string())
            {
                self.found = true;
            }
            syn::visit::visit_expr_method_call(self, call);
        }
    }
    let mut w = Writes {
        ports: &uc.ports,
        found: false,
    };
    for im in uc.source.impls_of("UseCase") {
        w.visit_item_impl(im);
    }
    w.found
}

/// .../application/<aggregate>/usecases/<name> from a module path or a file.
pub fn use_case_key_of_module(module: &str) -> Option<String> {
    let parts: Vec<&str> = module.split("::").collect();
    let i = parts.iter().position(|p| *p == "application")?;
    if parts.get(i + 2) != Some(&"usecases") {
        return None;
    }
    Some(format!("{}/{}", parts.get(i + 1)?, parts.get(i + 3)?))
}
