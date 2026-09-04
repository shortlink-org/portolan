//! A crate as the extractor sees it: every `.rs` under the source directory,
//! parsed once, with what a reader needs off each - its module path, the
//! names its `use` lines bring in, its items, and enough of the text to say
//! where a node is and what an expression looked like.
//!
//! There is no type checker; everything is resolved by name and by `use`
//! path, which is all a layout that is the claim needs.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use proc_macro2::Span;
use quote::ToTokens;
use syn::spanned::Spanned;
use syn::{Attribute, Expr, ImplItem, Item, ItemImpl, ItemStruct, ItemTrait, Type, UseTree};

/// One parsed file.
pub struct Source {
    /// Absolute path.
    pub path: PathBuf,
    /// `crate::domain::order::port` for src/domain/order/port.rs; `crate` for main.rs and lib.rs.
    pub module: String,
    pub text: String,
    pub file: syn::File,
    /// Local name → the full path a `use` line brought it in under.
    pub uses: BTreeMap<String, String>,
}

impl Source {
    /// `file:line` of a node, with the file relative the way the caller wants it.
    pub fn at(&self, span: Span, rel: &dyn Fn(&Path) -> String) -> String {
        format!("{}:{}", rel(&self.path), span.start().line)
    }

    /// The text a span covers, as written, joined on one line.
    pub fn text_of(&self, span: Span) -> String {
        let start = span.start();
        let end = span.end();
        let lines: Vec<&str> = self.text.lines().collect();
        if start.line == 0 || start.line > lines.len() || end.line > lines.len() {
            return String::new();
        }
        let piece = if start.line == end.line {
            let line = lines[start.line - 1];
            slice_columns(line, start.column, end.column).to_string()
        } else {
            let mut out = String::new();
            for (i, n) in (start.line..=end.line).enumerate() {
                let line = lines[n - 1];
                let part = if i == 0 {
                    slice_columns(line, start.column, line.chars().count())
                } else if n == end.line {
                    slice_columns(line, 0, end.column)
                } else {
                    line
                };
                if i > 0 {
                    out.push(' ');
                }
                out.push_str(part.trim());
            }
            out
        };
        piece.split_whitespace().collect::<Vec<_>>().join(" ")
    }

    pub fn structs(&self) -> impl Iterator<Item = &ItemStruct> {
        self.file.items.iter().filter_map(|i| match i {
            Item::Struct(s) => Some(s),
            _ => None,
        })
    }

    pub fn traits(&self) -> impl Iterator<Item = &ItemTrait> {
        self.file.items.iter().filter_map(|i| match i {
            Item::Trait(t) => Some(t),
            _ => None,
        })
    }

    pub fn impls(&self) -> impl Iterator<Item = &ItemImpl> {
        self.file.items.iter().filter_map(|i| match i {
            Item::Impl(im) => Some(im),
            _ => None,
        })
    }

    /// Every `impl` block for a struct by name: the inherent ones and the trait ones.
    pub fn impls_of(&self, name: &str) -> Vec<&ItemImpl> {
        self.impls().filter(|im| self_type_name(im).as_deref() == Some(name)).collect()
    }

    /// A method on a struct, from any of its impl blocks.
    pub fn method(&self, name: &str, method: &str) -> Option<&syn::ImplItemFn> {
        self.impls_of(name).into_iter().flat_map(|im| im.items.iter()).find_map(|it| match it {
            ImplItem::Fn(f) if f.sig.ident == method => Some(f),
            _ => None,
        })
    }

    /// The full path a local name resolves to: what a `use` brought it in as,
    /// or the name itself when nothing did.
    pub fn resolve(&self, local: &str) -> String {
        self.uses.get(local).cloned().unwrap_or_else(|| local.to_string())
    }

    /// A path written in the code - `get_order::UseCase`, `Order` - as the
    /// full path its first segment's `use` line implies.
    pub fn resolve_path(&self, written: &str) -> String {
        let mut parts = written.split("::");
        let first = parts.next().unwrap_or_default();
        let rest: Vec<&str> = parts.collect();
        let head = if first == "crate" || first == "self" || first == "super" {
            first.to_string()
        } else {
            self.resolve(first)
        };
        if rest.is_empty() {
            return head;
        }
        format!("{head}::{}", rest.join("::"))
    }
}

/// Everything under the source directory, in path order.
pub struct Crate {
    pub root: PathBuf,
    pub sources: Vec<Source>,
}

impl Crate {
    pub fn load(src: &Path) -> Crate {
        let mut paths = Vec::new();
        collect(src, &mut paths);
        paths.sort();
        let sources = paths
            .into_iter()
            .filter_map(|path| {
                let text = fs::read_to_string(&path).ok()?;
                let file = syn::parse_file(&text).ok()?;
                let module = module_path(src, &path);
                let uses = uses_of(&file, &module);
                Some(Source {
                    path,
                    module,
                    text,
                    file,
                    uses,
                })
            })
            .collect();
        Crate {
            root: src.to_path_buf(),
            sources,
        }
    }

    pub fn get(&self, path: &Path) -> Option<&Source> {
        self.sources.iter().find(|s| s.path == path)
    }

    /// The sources under a directory, top level only.
    pub fn in_dir(&self, dir: &Path) -> Vec<&Source> {
        self.sources.iter().filter(|s| s.path.parent() == Some(dir)).collect()
    }

    /// The sources under a directory, however deep.
    pub fn under(&self, dir: &Path) -> Vec<&Source> {
        self.sources.iter().filter(|s| s.path.starts_with(dir)).collect()
    }

    /// The source declaring a struct or trait of that name, when there is
    /// exactly one; with a full path to go on, the one whose module the path
    /// names or re-exports from.
    pub fn declaring(&self, name: &str, full: Option<&str>) -> Option<&Source> {
        let candidates: Vec<&Source> = self
            .sources
            .iter()
            .filter(|s| {
                s.structs().any(|st| st.ident == name)
                    || s.traits().any(|t| t.ident == name)
                    || s.file.items.iter().any(|i| matches!(i, Item::Enum(e) if e.ident == name))
            })
            .collect();
        if let Some(full) = full
            && let Some(module) = full.strip_suffix(&format!("::{name}"))
            && let Some(hit) = candidates.iter().find(|s| s.module == module || s.module.starts_with(&format!("{module}::")))
        {
            return Some(hit);
        }
        if candidates.len() == 1 { Some(candidates[0]) } else { None }
    }
}

fn collect(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

/// src/domain/order/port.rs → crate::domain::order::port; a mod.rs is its directory.
pub fn module_path(src: &Path, path: &Path) -> String {
    let rel = path.strip_prefix(src).unwrap_or(path);
    let mut parts: Vec<String> = rel.iter().map(|p| p.to_string_lossy().to_string()).collect();
    if let Some(last) = parts.last_mut() {
        *last = last.trim_end_matches(".rs").to_string();
    }
    if matches!(parts.last().map(String::as_str), Some("mod") | Some("main") | Some("lib")) {
        parts.pop();
    }
    std::iter::once("crate".to_string()).chain(parts).collect::<Vec<_>>().join("::")
}

/// `use a::b::{c, d as e, f::{g, self}};` → c, e, g, f by their full paths.
fn uses_of(file: &syn::File, module: &str) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for item in &file.items {
        if let Item::Use(u) = item {
            flatten(&u.tree, Vec::new(), module, &mut out);
        }
    }
    out
}

fn flatten(tree: &UseTree, prefix: Vec<String>, module: &str, out: &mut BTreeMap<String, String>) {
    match tree {
        UseTree::Path(p) => {
            let mut next = prefix;
            next.push(p.ident.to_string());
            flatten(&p.tree, next, module, out);
        }
        UseTree::Name(n) => {
            let mut full = prefix;
            let name = n.ident.to_string();
            if name == "self" {
                if let Some(last) = full.last().cloned() {
                    out.insert(last, absolute(&full, module));
                }
                return;
            }
            full.push(name.clone());
            out.insert(name, absolute(&full, module));
        }
        UseTree::Rename(r) => {
            let mut full = prefix;
            full.push(r.ident.to_string());
            out.insert(r.rename.to_string(), absolute(&full, module));
        }
        UseTree::Glob(_) => {}
        UseTree::Group(g) => {
            for t in &g.items {
                flatten(t, prefix.clone(), module, out);
            }
        }
    }
}

/// `super::x` and `self::x` spelled from the crate root.
fn absolute(parts: &[String], module: &str) -> String {
    let mut base: Vec<String> = module.split("::").map(String::from).collect();
    let mut i = 0;
    while i < parts.len() {
        match parts[i].as_str() {
            "self" => {}
            "super" => {
                base.pop();
            }
            "crate" => {
                base = vec!["crate".into()];
            }
            _ => break,
        }
        i += 1;
    }
    if i == 0 {
        return parts.join("::");
    }
    base.extend(parts[i..].iter().cloned());
    base.join("::")
}

/// The doc comment on an item, joined the way it was written, blank lines kept.
pub fn doc_of(attrs: &[Attribute]) -> String {
    let mut lines = Vec::new();
    for attr in attrs {
        if !attr.path().is_ident("doc") {
            continue;
        }
        if let syn::Meta::NameValue(nv) = &attr.meta
            && let Expr::Lit(syn::ExprLit { lit: syn::Lit::Str(s), .. }) = &nv.value
        {
            lines.push(s.value().trim().to_string());
        }
    }
    lines.join("\n").trim().to_string()
}

/// The first paragraph of a doc, on one line.
pub fn first_paragraph(doc: &str) -> String {
    doc.split("\n\n").next().unwrap_or("").split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A type as written, with the spacing a person would use: `Vec<Line>`, `Option<&str>`.
pub fn type_text(ty: &Type) -> String {
    tidy(&ty.to_token_stream().to_string())
}

pub fn tidy(tokens: &str) -> String {
    let mut s = tokens.to_string();
    for (from, to) in [
        (" < ", "<"),
        (" <", "<"),
        ("< ", "<"),
        (" >", ">"),
        (" ,", ","),
        (" :: ", "::"),
        (" ::", "::"),
        (":: ", "::"),
        ("& ", "&"),
        ("' ", "'"),
        (" ;", ";"),
        (" (", "("),
        ("( ", "("),
        (" )", ")"),
        (" [", "["),
        ("[ ", "["),
        (" ]", "]"),
        ("! ", "!"),
        (" .", "."),
        (". ", "."),
    ] {
        while s.contains(from) {
            s = s.replace(from, to);
        }
    }
    s.replace("&mut", "&mut ").replace("&mut  ", "&mut ").trim().to_string()
}

/// The name the type is about, wrappers set aside: `Arc<dyn Orders>` is
/// Orders, `Result<Order, Error>` is Order, `&[OrderEvent]` is OrderEvent,
/// `Option<Vec<Line>>` is Line. A tuple is its own thing and stays one.
pub fn bare_type(ty: &Type) -> String {
    match ty {
        Type::Reference(r) => bare_type(&r.elem),
        Type::Paren(p) => bare_type(&p.elem),
        Type::Slice(s) => bare_type(&s.elem),
        Type::Array(a) => bare_type(&a.elem),
        Type::TraitObject(t) => t
            .bounds
            .iter()
            .find_map(|b| match b {
                syn::TypeParamBound::Trait(tb) => tb.path.segments.last().map(|s| s.ident.to_string()),
                _ => None,
            })
            .unwrap_or_default(),
        Type::ImplTrait(t) => t
            .bounds
            .iter()
            .find_map(|b| match b {
                syn::TypeParamBound::Trait(tb) => tb.path.segments.last().map(|s| s.ident.to_string()),
                _ => None,
            })
            .unwrap_or_default(),
        Type::Path(p) => {
            let Some(last) = p.path.segments.last() else { return String::new() };
            let name = last.ident.to_string();
            if matches!(
                name.as_str(),
                "Arc" | "Box" | "Rc" | "Option" | "Vec" | "Result" | "Mutex" | "RwLock" | "Pin" | "Cow"
            ) && let syn::PathArguments::AngleBracketed(args) = &last.arguments
                && let Some(syn::GenericArgument::Type(inner)) = args.args.first()
            {
                return bare_type(inner);
            }
            name
        }
        Type::Tuple(_) => String::new(),
        _ => String::new(),
    }
}

/// The types a value of this type is, by position: `(Order, OrderPlaced)`
/// under any wrapper is two, anything else is one.
pub fn positions(ty: &Type) -> Vec<String> {
    match ty {
        Type::Reference(r) => positions(&r.elem),
        Type::Paren(p) => positions(&p.elem),
        Type::Path(p) => {
            let Some(last) = p.path.segments.last() else { return vec![] };
            let name = last.ident.to_string();
            if matches!(name.as_str(), "Result" | "Option" | "Box" | "Arc" | "Pin" | "Vec")
                && let syn::PathArguments::AngleBracketed(args) = &last.arguments
                && let Some(syn::GenericArgument::Type(inner)) = args.args.first()
            {
                return positions(inner);
            }
            vec![bare_type(ty)]
        }
        Type::Tuple(t) => t.elems.iter().map(bare_type).collect(),
        _ => vec![bare_type(ty)],
    }
}

/// The struct an `impl` block is for, by name.
pub fn self_type_name(im: &ItemImpl) -> Option<String> {
    match &*im.self_ty {
        Type::Path(p) => p.path.segments.last().map(|s| s.ident.to_string()),
        _ => None,
    }
}

/// The trait an `impl X for Y` block implements, by name.
pub fn trait_name(im: &ItemImpl) -> Option<String> {
    im.trait_.as_ref().and_then(|(_, path, _)| path.segments.last().map(|s| s.ident.to_string()))
}

/// The methods of an impl block, in order.
pub fn methods(im: &ItemImpl) -> impl Iterator<Item = &syn::ImplItemFn> {
    im.items.iter().filter_map(|it| match it {
        ImplItem::Fn(f) => Some(f),
        _ => None,
    })
}

/// Whether a function is `pub`.
pub fn is_public(vis: &syn::Visibility) -> bool {
    matches!(vis, syn::Visibility::Public(_))
}

/// Where a node is, as a span the readers pass around.
pub fn span_of<T: Spanned>(node: &T) -> Span {
    node.span()
}

fn slice_columns(line: &str, start: usize, end: usize) -> &str {
    let mut byte_start = line.len();
    let mut byte_end = line.len();
    for (i, (b, _)) in line.char_indices().enumerate() {
        if i == start {
            byte_start = b;
        }
        if i == end {
            byte_end = b;
            break;
        }
    }
    if byte_start > byte_end {
        return "";
    }
    &line[byte_start..byte_end]
}
