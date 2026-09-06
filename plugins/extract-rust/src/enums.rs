//! The closed sets an aggregate's fields take values from.
//!
//! A `pub enum` whose every variant is a bare name is a set of values - a
//! reason, a status, a code - and a consumer of the aggregate's events will
//! switch on it. One with data in its variants is a sum type, which is a
//! shape, not a set, and is left alone. `Error` is left alone too: it is what
//! a command refuses with, and a consumer never sees it on the wire.
//!
//! The value's name is what a consumer sees. When the enum spells that out -
//! an `as_str` or any method whose body is a `match` on `self` with a string
//! literal per arm - the literal is the name and the variant is not; the
//! lifecycle reads the same method the same way. Otherwise the variant's own
//! name is the value.

use std::collections::BTreeMap;
use std::path::Path;

use syn::{Expr, Fields, ItemEnum, Lit, Pat};

use crate::catalog::{Enum, EnumValue};
use crate::ids::{block_id, slug};
use crate::source::{Crate, Source, doc_of, is_public, methods};

/// The enums declared in the aggregate's own files and under `vo/`.
pub fn read_enums(krate: &Crate, aggregate_id: &str, dir: &Path) -> Vec<Enum> {
    let mut out = Vec::new();
    for src in krate.in_dir(dir).into_iter().chain(krate.in_dir(&dir.join("vo"))) {
        for item in &src.file.items {
            let syn::Item::Enum(en) = item else { continue };
            if !is_public(&en.vis) || en.ident == "Error" || !is_closed_set(en) {
                continue;
            }
            out.push(read_enum(src, aggregate_id, en));
        }
    }
    out
}

/// Every variant a bare name: `Placed`, not `Move(&'static str)`.
fn is_closed_set(en: &ItemEnum) -> bool {
    !en.variants.is_empty() && en.variants.iter().all(|v| matches!(v.fields, Fields::Unit))
}

fn read_enum(src: &Source, aggregate_id: &str, en: &ItemEnum) -> Enum {
    let name = en.ident.to_string();
    let spelled = spelled_values(src, &name);
    let values = en
        .variants
        .iter()
        .map(|v| {
            let variant = v.ident.to_string();
            EnumValue {
                name: spelled.get(&variant).cloned().unwrap_or(variant),
                doc: doc_of(&v.attrs),
                deprecated: is_deprecated(&v.attrs),
            }
        })
        .collect();
    Enum {
        id: block_id(aggregate_id, &slug(&name)),
        slug: slug(&name),
        name,
        doc: doc_of(&en.attrs),
        deprecated: is_deprecated(&en.attrs),
        values,
    }
}

fn is_deprecated(attrs: &[syn::Attribute]) -> bool {
    attrs.iter().any(|a| a.path().is_ident("deprecated"))
}

/// Variant name → the literal an inherent method answers for it, read off
/// the first method whose body is `match self { Status::Placed => "placed", … }`.
fn spelled_values(src: &Source, name: &str) -> BTreeMap<String, String> {
    for im in src.impls_of(name) {
        for f in methods(im) {
            let map = match_arms(&f.block, name);
            if !map.is_empty() {
                return map;
            }
        }
    }
    BTreeMap::new()
}

fn match_arms(block: &syn::Block, name: &str) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for stmt in &block.stmts {
        let expr = match stmt {
            syn::Stmt::Expr(e, _) => e,
            _ => continue,
        };
        let Expr::Match(m) = expr else { continue };
        for arm in &m.arms {
            let Some(variant) = variant_of(&arm.pat, name) else { continue };
            if let Expr::Lit(syn::ExprLit { lit: Lit::Str(s), .. }) = &*arm.body {
                out.insert(variant, s.value());
            }
        }
    }
    out
}

/// `Status::Placed` or `Self::Placed` → `Placed`.
fn variant_of(pat: &Pat, name: &str) -> Option<String> {
    let Pat::Path(p) = pat else { return None };
    let segments: Vec<String> = p.path.segments.iter().map(|s| s.ident.to_string()).collect();
    match segments.as_slice() {
        [head, variant] if head == name || head == "Self" => Some(variant.clone()),
        _ => None,
    }
}
