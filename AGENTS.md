# Agent notes

## UI preview verification

- A generated catalog is not a verified UI result. After extractor or catalog changes, run every derived presentation step used by the page, including `npm run gen` and `npm run likec4:gen` when diagrams are involved.
- Verify the exact user-visible region that was reported as broken. For diagram changes, inspect the rendered diagram itself; checking JSON, a page heading, or another DOM element is insufficient.
- Reload the same preview URL with a cache-busting query after generation. If the dev server eagerly loaded generated assets, restart it before claiming the UI is updated.
- State which layer was verified: source fragment, merged catalog, generated model, or rendered UI. Do not describe an earlier layer as an end-to-end UI result.
- Keep external-project source trees unchanged and keep their generated preview artifacts outside this repository.
