# Glossary — Portolan

*Generated from the portolan catalog · commit `10 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Context:** [Portolan](README.md)
- **Terms:** 44
- **Read from:** [`GLOSSARY.md`](https://github.com/shortlink-org/portolan/blob/main/GLOSSARY.md)

One meaning per word inside this context, as the glossary beside the code states it.

## Terms

- **ADR** — A decision an estate wrote down with the alternative it rejected, read out of the record files a manifest step names and frozen: the body goes into the catalog exactly as written and is never regenerated from the model.
- **Aggregate** — What a domain extractor read as one thing: a root, its entities and value objects, the events it publishes, the commands and queries on it, and its lifecycle when the code keeps a table of one.
- **Answer** — What comes back from an rpc step, looked up in the contract that declares the method rather than recorded: a reply is the far end of the same hop, not a second thing that happened.
- **Catalog** — One source of facts in the shape `src/catalog.ts` decides: contexts, defs, flows, adrs, stores, modules, terms, repos and externals. A reader never sees one; the estate is the merge of several.
- **Chain** — What happens after an event, as far as the flows can say: each consumer followed into the flow where it hears the event, what it publishes after that, and the same question asked of those events.
- **Component** — The neutral reading of a service, for a repository that was not laid out for a domain model: an application, a webapp, a worker, a job, a function, a CLI, a library or a data pipeline, said by its kind. The wire and the code say service; the README and the setup wizard say component when the kind is neutral. Decided in portolan.0004.
- **Context** — The estate's top grouping level and nothing more: it owns services and states no relationship to its neighbours, because the map of who talks to whom is drawn from the calls and events themselves. Its kind says whether it is a bounded context, a system, a product, a team or a namespace.
- **Declared** — The status of a fact a fragment states and nothing has yet shown happening.
- **Estate** — Everything the manifest's sources find, merged and validated as one: the whole a reader browses, dated from the sources that carry a stamp.
- **Event** — A fact in the past tense that an aggregate publishes, on a channel its service declares, with the shared definition of its payload in defs.
- **External** — A system outside the estate with a contract: what it answers on, read from the copy of its document vendored beside the adapter that calls it, and nothing else. Nobody in the estate provides it, so it sits at the root beside the contexts and has no aggregates and no repository.
- **Extractor** — A plugin that reads a tree or a specification and answers with a fragment. It runs before there is a merged catalog and is handed none.
- **Fetcher** — A plugin that brings a tree from elsewhere, a repository or a schema registry, into a cache against a lock, so a later build reproduces it without a socket. The cache is a tree the extractors read like any other.
- **Flow** — A walkthrough of steps between participants, owned by one context: derived from the code of one component, read from a `.flow.md` file, or overlaid by a verifier from a recorded trace.
- **Fragment** — A catalog written beside one service by one extractor, in the `portolan/` directory the sources glob finds. A fragment naming a peer it does not own is normal: referential integrity is a property of the union.
- **Generator** — A plugin that reads the merged catalog and answers with files: markdown, Mermaid, Backstage entities. It names files and never writes them.
- **Group** — The neutral reading of a context whose kind is system, product, team or namespace. The wire and the code say context; the README and the setup wizard say group when the kind is neutral. Decided in portolan.0004.
- **Hop** — One thing a step records: a call made, an rpc invoked or an event published, from one participant to another. Never a reply.
- **Host** — The side that runs the plugins, merges and validates the sources, stamps and writes the fragments and pages, and refuses a file name that climbs out of its output directory: `scripts/gen.mjs` and what it calls.
- **Lifecycle** — The states an aggregate root can be in and one move per edge, the method that makes it and the event it hands back, read off a table the code keeps and never off the branches of the methods. Terminal states are derived on the page and never written down.
- **Manifest** — `portolan.json`: where the facts come from, what produces them, and what turns them into something to read. Its schema is composed from what every declared plugin says it can be told.
- **Module** — A schema module the estate publishes or vendors, a proto module on the Buf Schema Registry or a subject in a Confluent registry. A module names its own owner; a service listing one it does not own reads it.
- **Owner** — Who to ask about a service, read from CODEOWNERS by a verifier.
- **Participant** — A lane in a flow: an actor, a service, a broker, a store, an external or an unknown. The order of participants is the order of lanes.
- **Peer** — The service that answers for what a component calls, told to the extractor by the manifest because the generated client names the package and the operation and only the manifest knows whose it is. A package with no peer line is called as unknown.
- **Phase** — One of the three passes the host makes over the manifest: extract, verify, generate. Each phase's steps run after the previous phase's files are on disk.
- **Pin** — A reader's own answer to where they keep coming back to: a kind and a catalog id, kept in the browser, resolved against the catalog at render time and going quiet when the build no longer has the thing.
- **Plugin** — A program that takes one JSON message on stdin and answers with one on stdout, run as a process or as a wasm module, in whichever language it was written. An extractor, a verifier, a generator or a fetcher.
- **Problem** — An edge that leaves the chart: a call nobody answers, a channel with a second publisher, a column whose lineage crosses a service boundary. Listed on the Problems page, errors first.
- **Project** — A named source root in the manifest, so the pipeline inputs that belong to one repository have one name on the Settings page.
- **Repository pin** — A repository the estate was read at and the commit it was read at, so a source path in another repository is still a link. A fact about the estate, not a field on a service.
- **Service** — What a context owns: a repository path, what it provides and consumes, its aggregates, the stores and modules it touches. Its kind says what it is when it is not a service in the domain sense; see component.
- **Source** — A file the manifest's sources globs find: a fragment an extractor wrote, a hand-written file in `data/`, a fetched repository's pin.
- **Stamp** — The commit and date the host writes onto a fragment: the last commit that touched the input it was read from, never a clock a plugin read. Decided in portolan.0002.
- **Status** — Whether the estate stands behind a fact: verified, declared or unresolved, best first.
- **Step** — One move in a flow: from a participant to a participant, an rpc, an event or a call, carrying a status. The manifest borrows the word for one plugin run on one input, and the host keys the files it wrote by that; the two meanings never meet in one file.
- **Store** — Where a service keeps state: a database with its tables, views, keys and column lineage, naming its own owner. A service that lists a store it does not own reads it.
- **Term** — One entry of a context's glossary, read out of its `GLOSSARY.md`: the word and what it means, carried through as written.
- **Trail** — The pages a reader has been to, most recent first, kept in the browser.
- **Unknown** — A participant a flow names that the catalog has no service for: drawn as unknown and its steps left unresolved, never dropped.
- **Unresolved** — The status of a reference nothing in the catalog answers: a call to a method no service provides, an event nobody publishes.
- **Verified** — The status of a fact a recorded trace showed happening.
- **Verifier** — A plugin that reads evidence, traces or CODEOWNERS, and overlays what it found on the merged catalog: a status, an owner.
- **Wire format** — The JSON keys as a fragment spells them. `contexts` and `services` are kept as they were so an old catalog loads; a kind on either says how to read the node. Decided in portolan.0004.
