# Proposal

## Why

Portolan can already read normalized OpenSpec changes, but users still have to connect the extractor manually, and a specification remains an isolated screen without history, automatically derived impact, or shared navigation. SDD should become useful as soon as a standard directory appears in a repository, without `portolan.yaml`, hand-authored catalog IDs, or additional configuration.

## What Changes

- Detect supported SDD layouts automatically and connect the built-in extractor with safe defaults.
- Show the Git history of a change and its artifacts without writing provenance into the generated fragment.
- Identify affected components from changed paths and known repository and service path boundaries.
- Turn only exact textual references—catalog IDs, file paths, `path:line`, URLs, and known identifiers—into verifiable links.
- Build a deterministic activity feed from Git, specification diffs, checklists, and automatically derived impact.
- Include changes, requirements, and scenarios in global search, the command palette, breadcrumbs, and backlinks.

## Capabilities

### New Capabilities

- `automatic-sdd-workflow`: zero-config discovery, history, exact links, path impact, activity feed, search and navigation for supported SDD artifacts.

### Modified Capabilities

None. Existing extractor, catalog merge, architecture evidence, and branch draft semantics are extended without changing their current contracts.

## Impact

- **Local discovery/setup:** a standard `openspec/` layout becomes a high-confidence detection and creates an SDD extraction step automatically.
- **Catalog host:** Git history and branch diff remain external enrichment so identical source files continue to produce byte-identical fragments.
- **Catalog model:** SDD links, path impact, and activity are derived facts; author lifecycle and implementation evidence remain separate dimensions.
- **UI:** `/specs`, global search, the command palette, breadcrumbs, Changes, and backlinks gain SDD entries.
- **Safety:** free-form text is not used for semantic matching. Ambiguous names remain plain text or unresolved exact references.
- **Out of scope:** editing OpenSpec from Portolan, changing task checkboxes automatically, generating requirements with an LLM, Spec Kit or Kiro adapters, and claiming runtime conformance from path co-change alone.
