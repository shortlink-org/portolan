// How the site's build groups the LikeC4 modules into chunks.
//
// LikeC4's renderer and the generated models are only reached through lazy
// imports (a C4 view, a flow page), but two lazy chunks share them, and left
// alone the bundler hoists what they share into the chunk that imports both:
// the catalog shell every page waits for. Two groups of their own keep them
// off the first load.
//
// Why two and not one: src/likec4/bundle.ts picks the profile's model with a
// top-level `await import(...)`, and every generated model imports LikeC4's
// runtime. A chunk that holds both the awaiting module and the runtime is one
// the model cannot evaluate until the chunk has finished evaluating - which it
// never does, because it is waiting for the model. The browser reports
// nothing; the diagram stays a skeleton. So the runtime is a chunk the app
// group never shares, and the model's static imports never reach the chunk
// that awaits it. scripts/site-chunks.test.mjs holds this apart.

/** LikeC4's own code: the renderer, the core model, the layouts. Icons are
 *  excluded: the shell draws one of them. */
export const LIKEC4_RUNTIME = /[\\/]node_modules[\\/](likec4|@likec4[\\/](?!icons[\\/]))/;

/** The app modules that draw with it, bundle.ts among them. A profile's model
 *  (src/likec4/generated/<profile>.jsx) is named by neither: it stays its own
 *  chunk, loaded by bundle.ts for the profile on screen alone (portolan.0034). */
export const LIKEC4_APP =
  /[\\/]src[\\/]likec4[\\/](bundle\.ts|C4View\.tsx|FlowView\.tsx|InteractiveView\.tsx|CanvasBridge\.tsx|view-index\.ts|container-layout\.ts)$|[\\/]src[\\/]drafts[\\/]branch-view\.ts$/;

/** The groups in the order the bundler tries them. */
export const LIKEC4_CHUNK_GROUPS = [
  { name: "likec4-runtime", test: LIKEC4_RUNTIME },
  { name: "likec4", test: LIKEC4_APP },
];
