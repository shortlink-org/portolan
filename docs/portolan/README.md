# Portolan

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `portolan`
- **Kind:** system

The tool that reads an architecture catalog from the code and specifications that already describe a software estate. It is documented here as the system that extracts, merges, validates and presents those facts.

## Components

| Component | Kind | Technologies | Path |
| --- | --- | --- | --- |
| [Host](host/README.md) | cli | Node.js | `scripts` |
| [Plugins](plugins/README.md) | cli | Go, TypeScript, Rust, Java, Python | `plugins` |
| [Site](site/README.md) | webapp | TypeScript, React, Vite | `src` |

## Language

- [Glossary](glossary.md) — 48 terms this context spells one way

## Decisions

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [portolan.0001](../adr/portolan.0001.md) | A plugin names files and never writes them | accepted | 2026-09-02 |
| [portolan.0002](../adr/portolan.0002.md) | The host stamps a fragment from its input's last commit | superseded | 2026-09-02 |
| [portolan.0003](../adr/portolan.0003.md) | The Go catalog is a mirror held by a round-trip test | accepted | 2026-09-02 |
| [portolan.0004](../adr/portolan.0004.md) | `contexts` and `services` stay the wire format | accepted | 2026-09-06 |
| [portolan.0005](../adr/portolan.0005.md) | CSS moves what appears; Motion moves what leaves or changes place | accepted | 2026-09-06 |
| [portolan.0006](../adr/portolan.0006.md) | An extractor runs as wasm over a preopened workspace | accepted | 2026-09-08 |
| [portolan.0007](../adr/portolan.0007.md) | The host reads history for a plugin that asks | accepted | 2026-09-08 |
| [portolan.0008](../adr/portolan.0008.md) | A plugin that needs a socket runs inside the host | accepted | 2026-09-08 |
| [portolan.0009](../adr/portolan.0009.md) | The typed Go call graph runs as a native sidecar | accepted | 2026-09-10 |
| [portolan.0010](../adr/portolan.0010.md) | Provenance is read from the history, never written into a fragment | accepted | 2026-09-10 |
| [portolan.0011](../adr/portolan.0011.md) | Only names are read from what deploys a service | accepted | 2026-09-11 |
| [portolan.0012](../adr/portolan.0012.md) | Where a service runs is read from the deployer, as a snapshot | accepted | 2026-09-11 |
| [portolan.0013](../adr/portolan.0013.md) | What should run is read from the GitOps tree, and laid under what does | accepted | 2026-09-11 |
| [portolan.0014](../adr/portolan.0014.md) | A recording is kept beside the code, and lays what it showed over the flow | accepted | 2026-09-12 |
| [portolan.0015](../adr/portolan.0015.md) | A rule on a field is read into the catalog, in one vocabulary | accepted | 2026-09-12 |
| [portolan.0016](../adr/portolan.0016.md) | A problem is a rule with a passport, and a new one is written in CEL over one subject | accepted | 2026-09-12 |
| [portolan.0017](../adr/portolan.0017.md) | Every problem rule is CEL over a row that already carries its joins | accepted | 2026-09-12 |
| [portolan.0018](../adr/portolan.0018.md) | A Gateway Route contributes hosts only through a valid attachment | accepted | 2026-09-14 |
| [portolan.0019](../adr/portolan.0019.md) | A branch draft is generated in dev, compared from its merge-base and saved beside main | accepted | 2026-09-15 |
| [portolan.0020](../adr/portolan.0020.md) | Task links are read from the history, never written into a fragment | accepted | 2026-09-15 |
| [portolan.0021](../adr/portolan.0021.md) | An inferred HTTP verb links a call, at medium confidence | accepted | 2026-09-15 |
| [portolan.0022](../adr/portolan.0022.md) | The site toolchain is optional, and the image that needs it ships as its own tag | accepted | 2026-09-16 |
| [portolan.0023](../adr/portolan.0023.md) | The rules the code checks are held against the rules the document promises | accepted | 2026-09-16 |
| [portolan.0024](../adr/portolan.0024.md) | A path across services is composed in the reading, not in the catalog | accepted | 2026-09-16 |
| [portolan.0025](../adr/portolan.0025.md) | An endpoint flow names the method it answers, and that is what pairs a call with its handler | accepted | 2026-09-16 |
| [portolan.0026](../adr/portolan.0026.md) | The whole path is drawn; a partly opened one is not | superseded | 2026-09-16 |
| [portolan.0028](../adr/portolan.0028.md) | A followed flow opens as a document of its own | accepted | 2026-09-16 |
| [portolan.0029](../adr/portolan.0029.md) | A branch of a vendored service is drafted from a clone of its own repository | accepted | 2026-09-17 |
| [portolan.0030](../adr/portolan.0030.md) | Two changes to one entity conflict only when they touch the same thing | accepted | 2026-09-17 |
| [portolan.0031](../adr/portolan.0031.md) | A verifier is handed the flows as declared, not as enriched | accepted | 2026-09-18 |
| [portolan.0032](../adr/portolan.0032.md) | A gRPC call outside the estate is named by the manifest and described by the copy | accepted | 2026-09-18 |
