//! A call to another service, read off the generated client the adapter
//! holds. Protos are indexed across the Cargo workspace: a monorepo caller
//! may compile a sibling crate's contract or use generated bindings from a
//! registry without copying a proto beside its adapter. A call on a field
//! typed as a generated client, including through a local type alias and a
//! cloned local binding, is matched to that client's service. The id is the
//! one the callee's extractor would give:
//! `payments.v1.PaymentService/Authorize`.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use syn::visit::Visit;
use syn::{Expr, ImplItem, Item, ItemImpl, Member, Pat, Type};

use crate::catalog::RpcCall;
use crate::ids::same_name;
use crate::protocol::Builder;
use crate::source::{Crate, Source, self_type_name};

/// One call the adapter makes, in the catalog's terms.
#[derive(Debug, Clone)]
pub struct RpcHop {
    /// "payments.v1.PaymentService/Authorize"
    pub id: String,
    /// What the manifest's peers map is keyed by: the proto package.
    pub pkg: String,
    /// The proto the call was named from.
    pub source: String,
}

#[derive(Debug, Clone)]
pub struct ProtoService {
    pub pkg: String,
    pub name: String,
    pub rpcs: Vec<String>,
    pub source: String,
}

/// The protos under a directory, however deep: package, services, rpcs.
pub fn read_protos(dir: &Path, rel: &dyn Fn(&Path) -> String) -> Vec<ProtoService> {
    let mut files = Vec::new();
    collect(dir, &mut files);
    files.sort();
    files
        .into_iter()
        .filter_map(|p| fs::read_to_string(&p).ok().map(|t| proto_services(&t, &rel(&p))))
        .flatten()
        .collect()
}

fn collect(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if matches!(path.file_name().and_then(|n| n.to_str()), Some("target" | ".git")) {
                continue;
            }
            collect(&path, out);
        } else if path.extension().is_some_and(|e| e == "proto") {
            out.push(path);
        }
    }
}

/// The Cargo workspace is the contract boundary available to one crate. A
/// monorepo may compile a sibling crate's proto without copying it into the
/// caller, so stopping at the service directory loses a real dependency.
pub fn cargo_workspace(crate_root: &Path) -> PathBuf {
    let mut current = Some(crate_root);
    while let Some(dir) = current {
        let manifest = dir.join("Cargo.toml");
        if fs::read_to_string(manifest).is_ok_and(|text| text.lines().any(|line| line.trim() == "[workspace]")) {
            return dir.to_path_buf();
        }
        current = dir.parent();
    }
    crate_root.to_path_buf()
}

/// RPC calls made by generated clients, independent of whether the service's
/// application and domain layers follow any particular directory layout.
pub fn read_rpc_calls(krate: &Crate, contracts_root: &Path, peers: &BTreeMap<String, String>, rel: &dyn Fn(&Path) -> String, b: &mut Builder) -> Vec<RpcCall> {
    let services = read_protos(contracts_root, rel);
    let mut contracts: BTreeMap<String, Vec<&ProtoService>> = BTreeMap::new();
    for service in &services {
        contracts.entry(service.name.clone()).or_default().push(service);
    }

    let mut calls = BTreeMap::new();
    let mut warned = BTreeSet::new();
    for src in &krate.sources {
        let type_aliases: BTreeMap<String, &Type> = src
            .file
            .items
            .iter()
            .filter_map(|item| match item {
                Item::Type(alias) => Some((alias.ident.to_string(), &*alias.ty)),
                _ => None,
            })
            .collect();
        for strukt in src.structs() {
            let fields: BTreeMap<String, String> = strukt
                .fields
                .iter()
                .filter_map(|field| {
                    let name = field.ident.as_ref()?.to_string();
                    client_service(&field.ty, &type_aliases, &mut BTreeSet::new()).map(|service| (name, service))
                })
                .collect();
            if fields.is_empty() {
                continue;
            }

            for implementation in src.impls_of(&strukt.ident.to_string()) {
                let mut finder = ClientCalls {
                    fields: &fields,
                    aliases: BTreeMap::new(),
                    contracts: &contracts,
                    peers,
                    calls: &mut calls,
                    warned: &mut warned,
                    b,
                };
                finder.visit_item_impl(implementation);
            }
        }
    }
    calls.into_values().collect()
}

fn client_service(typ: &Type, aliases: &BTreeMap<String, &Type>, seen: &mut BTreeSet<String>) -> Option<String> {
    let Type::Path(path) = typ else { return None };
    let name = path.path.segments.last()?.ident.to_string();
    if let Some(target) = aliases.get(&name)
        && seen.insert(name.clone())
    {
        return client_service(target, aliases, seen);
    }
    name.strip_suffix("Client").filter(|service| !service.is_empty()).map(str::to_string)
}

struct ClientCalls<'a> {
    fields: &'a BTreeMap<String, String>,
    aliases: BTreeMap<String, String>,
    contracts: &'a BTreeMap<String, Vec<&'a ProtoService>>,
    peers: &'a BTreeMap<String, String>,
    calls: &'a mut BTreeMap<String, RpcCall>,
    warned: &'a mut BTreeSet<String>,
    b: &'a mut Builder,
}

impl ClientCalls<'_> {
    fn service_of(&self, expr: &Expr) -> Option<String> {
        match expr {
            Expr::Field(field) if matches!(&*field.base, Expr::Path(path) if path.path.is_ident("self")) => match &field.member {
                Member::Named(name) => self.fields.get(&name.to_string()).cloned(),
                Member::Unnamed(_) => None,
            },
            Expr::Path(path) => path.path.get_ident().and_then(|name| self.aliases.get(&name.to_string()).cloned()),
            Expr::MethodCall(call) if call.method == "clone" => self.service_of(&call.receiver),
            Expr::Paren(paren) => self.service_of(&paren.expr),
            Expr::Reference(reference) => self.service_of(&reference.expr),
            _ => None,
        }
    }

    fn record(&mut self, service_name: &str, method: &str) {
        let Some(candidates) = self.contracts.get(service_name) else { return };
        let matching: Vec<&&ProtoService> = candidates
            .iter()
            .filter(|service| service.rpcs.iter().any(|rpc| same_name(rpc, method)))
            .collect();
        if matching.len() != 1 {
            return;
        }
        let service = matching[0];
        let rpc = service.rpcs.iter().find(|rpc| same_name(rpc, method)).expect("matching rpc");
        let id = format!("{}.{}/{}", service.pkg, service.name, rpc);
        let (peer, status) = match self.peers.get(&service.pkg) {
            Some(peer) => (peer.clone(), "declared".to_string()),
            None => {
                if self.warned.insert(service.pkg.clone()) {
                    self.b.warn(
                        &id,
                        format!("calls {} and the manifest names no peer for that package; add it under `peers` to say which service answers, until then the call is unresolved", service.pkg),
                    );
                }
                (service.pkg.clone(), "unresolved".to_string())
            }
        };
        self.calls.entry(id.clone()).or_insert(RpcCall {
            id,
            peer,
            status,
            source: service.source.clone(),
        });
    }
}

impl<'ast> Visit<'ast> for ClientCalls<'_> {
    fn visit_item_impl(&mut self, implementation: &'ast ItemImpl) {
        if self_type_name(implementation).is_none() {
            return;
        }
        for item in &implementation.items {
            if let ImplItem::Fn(method) = item {
                self.aliases.clear();
                self.visit_block(&method.block);
            }
        }
    }

    fn visit_local(&mut self, local: &'ast syn::Local) {
        if let (Pat::Ident(name), Some(init)) = (&local.pat, &local.init)
            && let Some(service) = self.service_of(&init.expr)
        {
            self.aliases.insert(name.ident.to_string(), service);
        }
        syn::visit::visit_local(self, local);
    }

    fn visit_expr_method_call(&mut self, call: &'ast syn::ExprMethodCall) {
        if let Some(service) = self.service_of(&call.receiver) {
            self.record(&service, &call.method.to_string());
        }
        syn::visit::visit_expr_method_call(self, call);
    }
}

/// A minimal reading of one .proto: comments stripped, then `package`, then each `service { rpc … }`.
pub fn proto_services(text: &str, source: &str) -> Vec<ProtoService> {
    let stripped = strip_comments(text);
    let pkg = stripped
        .lines()
        .find_map(|l| l.trim().strip_prefix("package ").map(|r| r.trim().trim_end_matches(';').trim().to_string()))
        .unwrap_or_default();
    let mut out = Vec::new();
    let mut rest = stripped.as_str();
    while let Some(i) = rest.find("service ") {
        let after = &rest[i + "service ".len()..];
        let Some(open) = after.find('{') else { break };
        let name = after[..open].trim().to_string();
        let Some(close) = after[open..].find('}') else { break };
        let body = &after[open + 1..open + close];
        let rpcs = body
            .split_whitespace()
            .collect::<Vec<_>>()
            .windows(2)
            .filter(|w| w[0] == "rpc")
            .map(|w| w[1].split('(').next().unwrap_or("").to_string())
            .filter(|r| !r.is_empty())
            .collect();
        out.push(ProtoService {
            pkg: pkg.clone(),
            name,
            rpcs,
            source: source.to_string(),
        });
        rest = &after[open + close..];
    }
    out
}

fn strip_comments(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while !rest.is_empty() {
        if let Some(i) = rest.find("//") {
            let block = rest.find("/*");
            if block.is_some_and(|b| b < i) {
                let b = block.unwrap();
                out.push_str(&rest[..b]);
                rest = rest[b + 2..].find("*/").map(|e| &rest[b + 2 + e + 2..]).unwrap_or("");
                continue;
            }
            out.push_str(&rest[..i]);
            rest = rest[i..].find('\n').map(|n| &rest[i + n..]).unwrap_or("");
        } else if let Some(b) = rest.find("/*") {
            out.push_str(&rest[..b]);
            rest = rest[b + 2..].find("*/").map(|e| &rest[b + 2 + e + 2..]).unwrap_or("");
        } else {
            out.push_str(rest);
            break;
        }
    }
    out
}

/// What one adapter file can reach: the services of the proto vendored beside its gen/.
pub fn peer_of(src: &Source, rel: &dyn Fn(&Path) -> String, b: &mut Builder) -> Vec<ProtoService> {
    let Some(dir) = src.path.parent() else { return vec![] };
    let protos = read_protos(&dir.join("proto"), rel);
    if protos.is_empty() && dir.join("gen").is_dir() {
        b.warn(
            &rel(&src.path),
            "sits beside a gen/ with no proto/ to name what the client calls, so its calls cannot be named",
        );
    }
    protos
}

/// The calls one method of an adapter makes to its peer, in order, read off
/// the method's body: every method call whose name is an rpc of the peer.
pub fn adapter_calls(src: &Source, strukt: &str, method: &str, rel: &dyn Fn(&Path) -> String, b: &mut Builder) -> Vec<RpcHop> {
    let Some(m) = src.method(strukt, method) else { return vec![] };
    let peer = peer_of(src, rel, b);
    let mut finder = Calls { peer: &peer, out: vec![] };
    finder.visit_block(&m.block);
    let mut seen = std::collections::BTreeSet::new();
    finder.out.into_iter().filter(|h| seen.insert(h.id.clone())).collect()
}

struct Calls<'a> {
    peer: &'a [ProtoService],
    out: Vec<RpcHop>,
}

impl<'ast> Visit<'ast> for Calls<'_> {
    fn visit_expr_method_call(&mut self, call: &'ast syn::ExprMethodCall) {
        let name = call.method.to_string();
        for svc in self.peer {
            if let Some(rpc) = svc.rpcs.iter().find(|r| same_name(r, &name)) {
                self.out.push(RpcHop {
                    id: format!("{}.{}/{}", svc.pkg, svc.name, rpc),
                    pkg: svc.pkg.clone(),
                    source: svc.source.clone(),
                });
                break;
            }
        }
        syn::visit::visit_expr_method_call(self, call);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_package_services_and_rpcs() {
        let text = "// the contract\nsyntax = \"proto3\";\npackage payments.v1;\n/* block */\nservice PaymentService {\n  // one\n  rpc Authorize(AuthorizeRequest) returns (AuthorizeResponse);\n  rpc Capture(CaptureRequest) returns (CaptureResponse);\n}\n";
        let svcs = proto_services(text, "x.proto");
        assert_eq!(svcs.len(), 1);
        assert_eq!(svcs[0].pkg, "payments.v1");
        assert_eq!(svcs[0].name, "PaymentService");
        assert_eq!(svcs[0].rpcs, vec!["Authorize", "Capture"]);
    }
}
