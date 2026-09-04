//! Bindings, read off the one thing Rust makes explicit: `impl Port for
//! Adapter`. A use case states its need as a trait of its own so that it does
//! not import what satisfies it; whatever implements that trait is what fills
//! the port, and there may be more than one - the adapter over a real peer,
//! and a stand-in for running without it. Every one is kept, and the flow
//! reader picks the one that goes somewhere.

use std::collections::BTreeMap;
use std::path::PathBuf;

use crate::operations::use_case_key_of_module;
use crate::source::{Crate, self_type_name, trait_name};

#[derive(Debug, Clone)]
pub struct Binding {
    /// "<usecase key>.<PortTrait>"
    pub port: String,
    /// The adapter that fills it: its struct, in its file.
    pub file: PathBuf,
    pub strukt: String,
}

/// Every `impl <Trait> for <Struct>` outside domain/ and application/ whose
/// trait a use case declares, keyed the way the flow reader looks them up.
pub fn read_bindings(krate: &Crate) -> BTreeMap<String, Vec<Binding>> {
    let mut out: BTreeMap<String, Vec<Binding>> = BTreeMap::new();
    for src in &krate.sources {
        if src.module.starts_with("crate::domain") || src.module.starts_with("crate::application") {
            continue;
        }
        for im in src.impls() {
            let (Some(trait_), Some(strukt)) = (trait_name(im), self_type_name(im)) else {
                continue;
            };
            let written = im
                .trait_
                .as_ref()
                .map(|(_, p, _)| p.segments.iter().map(|s| s.ident.to_string()).collect::<Vec<_>>().join("::"))
                .unwrap_or_default();
            let full = src.resolve_path(&written);
            let Some(declaring) = krate.declaring(&trait_, Some(&full)) else { continue };
            let Some(key) = use_case_key_of_module(&declaring.module) else { continue };
            let port = format!("{key}.{trait_}");
            out.entry(port.clone()).or_default().push(Binding {
                port,
                file: src.path.clone(),
                strukt,
            });
        }
    }
    out
}
