//! A call to another service, read off the generated client the adapter
//! holds. A gRPC peer: the adapter's directory has a `proto/` with the
//! vendored contract and a `gen/` with tonic's output, and a call on the
//! client, `self.inner.authorize(…)`, is the rpc of that name in the proto's
//! own case. The id is the one the callee's extractor would give:
//! `payments.v1.PaymentService/Authorize`.

use std::fs;
use std::path::{Path, PathBuf};

use syn::visit::Visit;

use crate::ids::same_name;
use crate::protocol::Builder;
use crate::source::Source;

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
            collect(&path, out);
        } else if path.extension().is_some_and(|e| e == "proto") {
            out.push(path);
        }
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
