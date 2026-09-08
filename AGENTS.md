# Agent notes

## UI preview verification

- A generated catalog is not a verified UI result. After extractor or catalog changes, run every derived presentation step used by the page, including `npm run gen` and `npm run likec4:gen` when diagrams are involved.
- Verify the exact user-visible region that was reported as broken. For diagram changes, inspect the rendered diagram itself; checking JSON, a page heading, or another DOM element is insufficient.
- Reload the same preview URL with a cache-busting query after generation. If the dev server eagerly loaded generated assets, restart it before claiming the UI is updated.
- State which layer was verified: source fragment, merged catalog, generated model, or rendered UI. Do not describe an earlier layer as an end-to-end UI result.
- Keep external-project source trees unchanged and keep their generated preview artifacts outside this repository.

## Direct answers and scope

- When the user asks a simple yes-or-no question about work already completed, answer directly from the known conversation state. Do not run status, log, test, or other verification commands unless the user asks for verification or the answer is genuinely unknown.
- Do not turn a straightforward request into an audit. Perform only the action requested and avoid narrating or checking unrelated workspace state.
- After a requested push succeeds, consider the work complete and stop. Do not monitor CI/CD, wait for workflows, or verify a release, deployment, or package publication unless the user explicitly asks for that follow-up.

## Focused verification

- For a narrowly scoped feature, run the tests and generated/UI checks that cover the changed behavior. Do not spend time on repository-wide regression suites (for example, all Go or TypeScript tests) unless the change crosses those boundaries, a focused check exposes a broader risk, or the user explicitly asks for them.
- Finish implementing the feature before moving to its test pass, then run the relevant checks together instead of rerunning them after every small edit. Use an earlier targeted check only when it is needed to resolve a concrete implementation uncertainty.
