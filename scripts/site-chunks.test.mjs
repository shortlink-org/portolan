import { describe, expect, it } from "vitest";
import { LIKEC4_APP, LIKEC4_CHUNK_GROUPS, LIKEC4_RUNTIME } from "./site-chunks.mjs";

const root = "/work/portolan";
const chunkOf = (id) => LIKEC4_CHUNK_GROUPS.find((group) => group.test.test(id))?.name ?? null;

describe("the LikeC4 chunks", () => {
  it("keep the module that awaits a profile's model apart from the runtime the model imports", () => {
    // bundle.ts awaits `import("./generated/<profile>.jsx")` at its top level,
    // and that model imports likec4/react. Were the two in one chunk, the
    // model could not evaluate until the chunk had, and the chunk waits for
    // the model: a deadlock the browser reports nothing about.
    expect(chunkOf(`${root}/src/likec4/bundle.ts`)).toBe("likec4");
    for (const runtime of [
      `${root}/node_modules/likec4/react/index.mjs`,
      `${root}/node_modules/@likec4/core/dist/model/index.mjs`,
      `${root}/node_modules/@likec4/diagram/dist/index.mjs`,
    ]) {
      expect(chunkOf(runtime)).toBe("likec4-runtime");
      expect(LIKEC4_APP.test(runtime)).toBe(false);
    }
  });

  it("leave every profile's model as a chunk of its own", () => {
    for (const model of [`${root}/src/likec4/generated/example.jsx`, `${root}/src/likec4/generated/default.jsx`]) {
      expect(chunkOf(model)).toBeNull();
    }
  });

  it("keep the icons with the shell that draws one of them", () => {
    expect(chunkOf(`${root}/node_modules/@likec4/icons/all.js`)).toBeNull();
    expect(LIKEC4_RUNTIME.test(`${root}/node_modules/@likec4/icons/all.js`)).toBe(false);
  });

  it("name the drawing modules and the draft view, and nothing else of the app", () => {
    for (const app of ["C4View.tsx", "FlowView.tsx", "InteractiveView.tsx", "CanvasBridge.tsx", "view-index.ts", "container-layout.ts"]) {
      expect(chunkOf(`${root}/src/likec4/${app}`)).toBe("likec4");
    }
    expect(chunkOf(`${root}/src/drafts/branch-view.ts`)).toBe("likec4");
    expect(chunkOf(`${root}/src/likec4/LazyC4View.tsx`)).toBeNull();
    expect(chunkOf(`${root}/src/pages/Overview.tsx`)).toBeNull();
  });
});
