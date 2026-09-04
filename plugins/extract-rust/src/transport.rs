//! Endpoints, read off src/infrastructure/transport/grpc/<aggregate>: the
//! proto under proto/ names the service and its rpcs, `impl <Service> for
//! <Handlers>` answers them, and each method's body names the use cases it
//! runs, in order.

use std::fs;
use std::path::{Path, PathBuf};

use syn::visit::Visit;
use syn::{Expr, Fields, ItemStruct};

use crate::clients::read_protos;
use crate::ids::same_name;
use crate::operations::use_case_key_of_module;
use crate::protocol::Builder;
use crate::source::{Crate, Source, bare_type, methods, self_type_name, span_of, trait_name, type_text};

pub struct Endpoint {
    /// The rpc, in the proto's own case: `GetOrder`.
    pub id: String,
    /// file:line of the handler.
    pub line: String,
    pub source: String,
    /// Use case keys, in the order the handler runs them.
    pub use_cases: Vec<String>,
}

pub fn read_transport(krate: &Crate, grpc: &Path, rel: &dyn Fn(&Path) -> String, b: &mut Builder) -> Vec<Endpoint> {
    let Ok(entries) = fs::read_dir(grpc) else { return vec![] };
    let mut dirs: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    dirs.sort();
    let mut endpoints = Vec::new();
    for dir in dirs {
        let protos = read_protos(&dir.join("proto"), rel);
        if protos.is_empty() {
            continue;
        }
        let mut found = std::collections::BTreeSet::new();
        for src in krate
            .under(&dir)
            .into_iter()
            .filter(|s| !s.path.starts_with(dir.join("gen")) && !s.path.starts_with(dir.join("proto")))
        {
            for im in src.impls() {
                let (Some(trait_), Some(strukt)) = (trait_name(im), self_type_name(im)) else {
                    continue;
                };
                let Some(svc) = protos.iter().find(|p| p.name == trait_) else { continue };
                let holder = src.structs().find(|s| s.ident == strukt);
                let ports = holder.map(|h| use_case_fields(src, h)).unwrap_or_default();
                for m in methods(im) {
                    let Some(rpc) = svc.rpcs.iter().find(|r| same_name(r, &m.sig.ident.to_string())) else {
                        continue;
                    };
                    if !found.insert(rpc.clone()) {
                        continue;
                    }
                    let mut runs = Runs { ports: &ports, out: vec![] };
                    runs.visit_block(&m.block);
                    endpoints.push(Endpoint {
                        id: rpc.clone(),
                        line: src.at(span_of(&m.sig), rel),
                        source: rel(&src.path),
                        use_cases: runs.out,
                    });
                }
            }
        }
        for svc in &protos {
            for rpc in &svc.rpcs {
                if !found.contains(rpc) {
                    b.warn(
                        rpc,
                        format!("{} declares {rpc} but no impl of {} under {} answers it", svc.source, svc.name, rel(&dir)),
                    );
                }
            }
        }
    }
    endpoints.sort_by(|a, c| a.id.cmp(&c.id));
    endpoints
}

/// The handler struct's fields that are use cases: `get_order: Arc<GetOrder>`
/// under `use crate::application::order::usecases::get_order::UseCase as GetOrder`,
/// or `get_order::UseCase` under `use crate::application::order::usecases::get_order`.
fn use_case_fields(src: &Source, st: &ItemStruct) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let Fields::Named(named) = &st.fields else { return out };
    for f in &named.named {
        let Some(name) = &f.ident else { continue };
        let written = type_text(&f.ty);
        let bare = bare_type(&f.ty);
        // The path as written inside the wrapper: `get_order::UseCase` or `GetOrder`.
        let path = written
            .split(['<', '>', '&', ' '])
            .find(|p| p.ends_with(&bare))
            .unwrap_or(&bare)
            .trim_start_matches("dyn ")
            .to_string();
        let full = src.resolve_path(&path);
        if let Some(key) = use_case_key_of_module(&full) {
            out.push((name.to_string(), key));
        }
    }
    out
}

/// `self.<field>.handle(…)` on a field that is a use case, in source order.
struct Runs<'a> {
    ports: &'a [(String, String)],
    out: Vec<String>,
}

impl<'ast> Visit<'ast> for Runs<'_> {
    fn visit_expr_method_call(&mut self, call: &'ast syn::ExprMethodCall) {
        if call.method == "handle"
            && let Expr::Field(f) = &*call.receiver
            && let syn::Member::Named(field) = &f.member
            && matches!(&*f.base, Expr::Path(p) if p.path.is_ident("self"))
            && let Some((_, key)) = self.ports.iter().find(|(n, _)| field == n)
            && !self.out.contains(key)
        {
            self.out.push(key.clone());
        }
        syn::visit::visit_expr_method_call(self, call);
    }
}
