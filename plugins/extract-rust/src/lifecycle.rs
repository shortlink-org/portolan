//! The root's lifecycle, read off two things the code already has: a table
//! that says where a status can go, and the one method that changes it.
//!
//!   pub const TRANSITIONS: &[(&str, &[&str])] = &[("placed", &["confirmed", "cancelled"]), ("confirmed", &[]), ("cancelled", &[])];
//!   fn move_to(&mut self, next: Status) -> Result<(), Error> { … self.status = next; … }
//!   pub fn confirm(&mut self, now: DateTime<Utc>) -> Result<OrderConfirmed, Error> { self.move_to(Status::Confirmed)?; … }
//!
//! The table gives the states, in its own order, and the edges. The method
//! that assigns `self.status` is the mover; every public method that calls it
//! with a literal - a string, or a variant of the status enum, `Status::Confirmed`
//! read as `confirmed` - makes the edges into that state, and hands back
//! whatever event its return type names. Nothing is inferred beyond that.

use std::collections::BTreeMap;
use std::path::Path;

use syn::visit::Visit;
use syn::{Expr, Item, ItemStruct, Lit};

use crate::catalog::{Lifecycle, Transition};
use crate::ids::slug;
use crate::protocol::Builder;
use crate::source::{Crate, Source, bare_type, is_public, methods, span_of};

pub const TABLE: &str = "TRANSITIONS";

#[allow(clippy::too_many_arguments)]
pub fn read_lifecycle(
    krate: &Crate,
    dir: &Path,
    root_src: &Source,
    root: &ItemStruct,
    events: &BTreeMap<String, String>,
    id: &str,
    rel: &dyn Fn(&Path) -> String,
    b: &mut Builder,
) -> Option<Lifecycle> {
    let table = read_table(krate, dir)?;
    let states: Vec<String> = table.iter().map(|(s, _)| s.clone()).collect();
    let root_name = root.ident.to_string();

    let Some(mover) = mover_of(root_src, &root_name) else {
        b.warn(
            id,
            format!(
                "{}: {root_name} has a {TABLE} table but no method assigns self.status, so nothing is read as moving along it",
                rel(&root_src.path)
            ),
        );
        return Some(Lifecycle { states, transitions: vec![] });
    };

    let mut transitions = Vec::new();
    let mut made = std::collections::BTreeSet::new();
    for im in root_src.impls_of(&root_name) {
        for m in methods(im) {
            let name = m.sig.ident.to_string();
            if name == mover || !is_public(&m.vis) {
                continue;
            }
            let emits = match &m.sig.output {
                syn::ReturnType::Type(_, ty) => events.get(&bare_type(ty)).cloned(),
                syn::ReturnType::Default => None,
            };
            let mut finder = Moves {
                mover: &mover,
                moves: vec![],
                assigns: vec![],
            };
            finder.visit_block(&m.block);
            for (to, span) in finder.moves {
                if !table.iter().any(|(s, _)| *s == to) {
                    b.warn(
                        id,
                        format!("{}: {name} moves to \"{to}\", which is not a state in {TABLE}", root_src.at(span, rel)),
                    );
                    continue;
                }
                for (from, targets) in &table {
                    if !targets.contains(&to) {
                        continue;
                    }
                    made.insert(format!("{from}→{to}"));
                    transitions.push(Transition {
                        from: from.clone(),
                        to: to.clone(),
                        on: name.clone(),
                        source: root_src.at(span, rel),
                        emits: emits.clone(),
                    });
                }
            }
            for span in finder.assigns {
                b.warn(
                    id,
                    format!(
                        "{}: {name} assigns self.status directly; a move outside {mover} is not in the lifecycle",
                        root_src.at(span, rel)
                    ),
                );
            }
        }
    }
    for (from, targets) in &table {
        for to in targets {
            if !made.contains(&format!("{from}→{to}")) {
                b.warn(id, format!("{TABLE} allows {from} → {to}, and no method of {root_name} makes that move"));
            }
        }
    }
    let order = |s: &str| table.iter().position(|(x, _)| x == s).unwrap_or(usize::MAX);
    transitions.sort_by_key(|t| (order(&t.from), order(&t.to)));

    Some(Lifecycle { states, transitions })
}

/// `pub const TRANSITIONS: &[(&str, &[&str])] = &[("a", &["b"]), ("b", &[])]` in any file of the directory.
fn read_table(krate: &Crate, dir: &Path) -> Option<Vec<(String, Vec<String>)>> {
    for src in krate.in_dir(dir) {
        for item in &src.file.items {
            let expr = match item {
                Item::Const(c) if c.ident == TABLE => &*c.expr,
                Item::Static(s) if s.ident == TABLE => &*s.expr,
                _ => continue,
            };
            return table_of(expr);
        }
    }
    None
}

fn table_of(expr: &Expr) -> Option<Vec<(String, Vec<String>)>> {
    let Expr::Array(rows) = unref(expr) else { return None };
    let mut out = Vec::new();
    for row in &rows.elems {
        let Expr::Tuple(pair) = unref(row) else { return None };
        let mut it = pair.elems.iter();
        let state = string_of(it.next()?)?;
        let Expr::Array(targets) = unref(it.next()?) else { return None };
        let targets: Option<Vec<String>> = targets.elems.iter().map(string_of).collect();
        out.push((state, targets?));
    }
    Some(out)
}

fn unref(e: &Expr) -> &Expr {
    match e {
        Expr::Reference(r) => unref(&r.expr),
        Expr::Paren(p) => unref(&p.expr),
        _ => e,
    }
}

fn string_of(e: &Expr) -> Option<String> {
    match unref(e) {
        Expr::Lit(syn::ExprLit { lit: Lit::Str(s), .. }) => Some(s.value()),
        _ => None,
    }
}

/// The method whose body assigns `self.status`: the one way the status changes.
fn mover_of(src: &Source, root: &str) -> Option<String> {
    for im in src.impls_of(root) {
        for m in methods(im) {
            let mut finder = Moves {
                mover: "",
                moves: vec![],
                assigns: vec![],
            };
            finder.visit_block(&m.block);
            if !finder.assigns.is_empty() {
                return Some(m.sig.ident.to_string());
            }
        }
    }
    None
}

/// Finds `self.<mover>(<state>, …)` calls and `self.status = …` assignments in a body.
struct Moves<'a> {
    mover: &'a str,
    moves: Vec<(String, proc_macro2::Span)>,
    assigns: Vec<proc_macro2::Span>,
}

impl<'ast> Visit<'ast> for Moves<'_> {
    fn visit_expr_method_call(&mut self, call: &'ast syn::ExprMethodCall) {
        if !self.mover.is_empty()
            && call.method == self.mover
            && is_self(&call.receiver)
            && let Some(first) = call.args.first()
            && let Some(state) = state_literal(first)
        {
            self.moves.push((state, span_of(call)));
        }
        syn::visit::visit_expr_method_call(self, call);
    }

    fn visit_expr_assign(&mut self, assign: &'ast syn::ExprAssign) {
        if let Expr::Field(f) = &*assign.left
            && is_self(&f.base)
            && matches!(&f.member, syn::Member::Named(n) if n == "status")
        {
            self.assigns.push(span_of(assign));
        }
        syn::visit::visit_expr_assign(self, assign);
    }
}

fn is_self(e: &Expr) -> bool {
    matches!(e, Expr::Path(p) if p.path.is_ident("self"))
}

/// `"confirmed"` as itself; `Status::Confirmed` as `confirmed`, the way a state is named in the table.
fn state_literal(e: &Expr) -> Option<String> {
    match unref(e) {
        Expr::Lit(syn::ExprLit { lit: Lit::Str(s), .. }) => Some(s.value()),
        Expr::Path(p) if p.path.segments.len() >= 2 => p.path.segments.last().map(|s| slug(&s.ident.to_string())),
        _ => None,
    }
}
