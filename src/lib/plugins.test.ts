import { describe, expect, it } from "vitest";
import {
  CATEGORY_ORDER,
  hasPluginLabel,
  landingInputs,
  pluginIndex,
  pluginsByCategory,
  runtimeLabel,
} from "./plugins";

describe("plugin index", () => {
  it("is written by npm run schema and names every plugin once", () => {
    expect(pluginIndex.length).toBeGreaterThan(0);
    const names = pluginIndex.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every plugin a category the page has a heading for and a phase to run in", () => {
    for (const entry of pluginIndex) {
      expect(CATEGORY_ORDER, entry.name).toContain(entry.category);
      expect(entry.phases.length, entry.name).toBeGreaterThan(0);
      expect(entry.summary, entry.name).not.toBe("");
    }
  });

  // A plugin added without a display name would reach the landing page as its
  // manifest key. This is the test that says so before a reader does.
  it("has a display name for every plugin", () => {
    const unnamed = pluginIndex.filter((entry) => !hasPluginLabel(entry.name)).map((entry) => entry.name);
    expect(unnamed).toEqual([]);
  });

  it("groups by category in reading order and drops empty groups", () => {
    const groups = pluginsByCategory();
    const order = groups.map((group) => group.category);
    expect(order).toEqual(CATEGORY_ORDER.filter((category) => order.includes(category)));
    for (const group of groups) expect(group.plugins.length).toBeGreaterThan(0);
  });

  it("lists what is read on the landing page, not what is made", () => {
    const inputs = landingInputs();
    expect(inputs.map((group) => group.label)).toContain("languages");
    expect(inputs.flatMap((group) => group.items)).toContain("Go");
    expect(inputs.flatMap((group) => group.items)).not.toContain("Markdown");
  });

  it("names the toolchain a host process asks for", () => {
    expect(runtimeLabel({ runtime: "wasm" } as never)).toBe("WASM sandbox");
    expect(runtimeLabel({ runtime: "host" } as never)).toBe("in the host");
    expect(runtimeLabel({ runtime: "process", toolchain: "cargo" } as never)).toBe("host process · cargo");
  });
});
