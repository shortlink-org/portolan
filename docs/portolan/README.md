# Portolan

*Generated from the portolan catalog · commit `3 sources` · at 2026-09-06T20:39:44+07:00. Do not edit by hand.*

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

- [Glossary](glossary.md) — 44 terms this context spells one way

## Decisions

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [portolan.0001](../adr/portolan.0001.md) | A plugin names files and never writes them | accepted | 2026-09-02 |
| [portolan.0002](../adr/portolan.0002.md) | The host stamps a fragment from its input's last commit | accepted | 2026-09-02 |
| [portolan.0003](../adr/portolan.0003.md) | The Go catalog is a mirror held by a round-trip test | accepted | 2026-09-02 |
| [portolan.0004](../adr/portolan.0004.md) | `contexts` and `services` stay the wire format | accepted | 2026-09-06 |
| [portolan.0005](../adr/portolan.0005.md) | CSS moves what appears; Motion moves what leaves or changes place | accepted | 2026-09-06 |
| [portolan.0006](../adr/portolan.0006.md) | An extractor runs as wasm over a preopened workspace | accepted | 2026-09-08 |
| [portolan.0007](../adr/portolan.0007.md) | The host reads history for a plugin that asks | accepted | 2026-09-08 |
| [portolan.0008](../adr/portolan.0008.md) | A plugin that needs a socket runs inside the host | accepted | 2026-09-08 |
| [portolan.0009](../adr/portolan.0009.md) | The typed Go call graph runs as a native sidecar | accepted | 2026-09-10 |
