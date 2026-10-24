# extract-sdd

Reads OpenSpec changes into Portolan's format-independent `specs[]` model.
The extractor is read-only: proposals, designs, requirement scenarios, and
task checklists remain authored in OpenSpec.

```json
{
  "plugin": "sdd",
  "in": ".",
  "out": ".portolan/fragments",
  "options": { "root": "openspec", "out": "sdd.json" }
}
```

The default `root` is `openspec`. Active changes are read from
`openspec/changes/*`; archived changes are also read from
`openspec/changes/archive/*`.

Lifecycle is normalized as follows:

| source state | lifecycle |
| --- | --- |
| no task checklist | `draft` |
| no checked tasks | `planned` |
| some checked tasks | `implementing` |
| all tasks checked | `complete` |
| under `changes/archive` | `archived` |

Lifecycle and checklist completion are intent metadata. They do not assert
that code, deployments, runtime behavior, or the architecture catalog conform
to the specification.

The normalized model also reserves `spec-kit` and `kiro` format values. This
adapter deliberately emits only `openspec`; unsupported layouts are not
guessed.
