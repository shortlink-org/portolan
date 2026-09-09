# Portolan

*Generated from the portolan catalog · commit `6 sources` · at 2026-09-06T20:39:44+07:00. Do not edit by hand.*


## Contexts

| Context | Services | Summary |
| --- | --- | --- |
| [Portolan](portolan/README.md) | [Host](portolan/host/README.md), [Plugins](portolan/plugins/README.md), [Site](portolan/site/README.md) | The tool that reads an architecture catalog from the code and specifications that already describe a software estate. It is documented here as the system that extracts, merges, validates and presents those facts. |

## Flows

| Flow | Owner | Summary |
| --- | --- | --- |
| [npm run gen](flows/gen.md) | [portolan](portolan/README.md) | Three passes over the manifest, each after the previous one's files are on disk: extract reads trees and specifications into fragments, verify overlays evidence on the merged catalog, generate turns it into pages. Every plugin is one JSON message in and one out; the host writes, the plugin never does. |

## Decisions

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [portolan.0001](adr/portolan.0001.md) | A plugin names files and never writes them | accepted | 2026-09-02 |
| [portolan.0002](adr/portolan.0002.md) | The host stamps a fragment from its input's last commit | accepted | 2026-09-02 |
| [portolan.0003](adr/portolan.0003.md) | The Go catalog is a mirror held by a round-trip test | accepted | 2026-09-02 |
| [portolan.0004](adr/portolan.0004.md) | `contexts` and `services` stay the wire format | accepted | 2026-09-06 |
| [portolan.0005](adr/portolan.0005.md) | CSS moves what appears; Motion moves what leaves or changes place | accepted | 2026-09-06 |
| [portolan.0006](adr/portolan.0006.md) | An extractor runs as wasm over a preopened workspace | accepted | 2026-09-08 |
| [portolan.0007](adr/portolan.0007.md) | The host reads history for a plugin that asks | accepted | 2026-09-08 |
| [portolan.0008](adr/portolan.0008.md) | A plugin that needs a socket runs inside the host | accepted | 2026-09-08 |
