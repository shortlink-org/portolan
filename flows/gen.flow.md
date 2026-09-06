# npm run gen
owner: portolan
source: scripts/gen.mjs

Three passes over the manifest, each after the previous one's files are on
disk: extract reads trees and specifications into fragments, verify overlays
evidence on the merged catalog, generate turns it into pages. Every plugin is
one JSON message in and one out; the host writes, the plugin never does.

In `--check` mode the same run writes nothing and fails on the first file that
differs from disk, which is what makes committed output reviewable.

## Participants
- developer: actor
- tree: store in portolan "the tree: fragments, docs/, exports/"

## Steps
developer -> portolan.host: npm run gen
portolan.host -> portolan.host: validate the manifest against the composed schema
  > schema/portolan.schema.json is what every declared plugin said it can be told, composed by npm run schema.
loop for each extract step
  portolan.host -> portolan.plugins: extract @scripts/gen.mjs:121
    > The request carries the input root, its stamp and the step's options. The stamp is the last commit that touched the root, never a clock (portolan.0002).
  portolan.host -> tree: write the fragment beside the service
end
portolan.host -> tree: read every source the manifest names @scripts/catalog-sources.mjs:28
portolan.host -> portolan.host: merge, validate and enrich the union
  > The same code the site runs: src/merge.ts, src/catalog.ts, src/enrich.ts. A fragment naming a peer it does not own is normal; integrity holds over the union.
loop for each verify step
  portolan.host -> portolan.plugins: verify @scripts/gen.mjs:135
    > The merged catalog rides in the request; the answer is an overlay fragment with what the evidence showed.
  portolan.host -> tree: write the overlay
end
loop for each generate step
  portolan.host -> portolan.plugins: generate @scripts/gen.mjs:165
    > A wasm module with nothing preopened, or a process. It names files and never writes them (portolan.0001).
  portolan.host -> tree: write the pages and delete what stopped being generated
end
portolan.host -> tree: write .portolan/build-report.json
