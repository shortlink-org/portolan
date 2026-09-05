import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetComparison,
  rememberedComparison,
  rememberComparison,
} from "./comparison-memory";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => vi.unstubAllGlobals());

describe("comparison memory", () => {
  it("remembers and forgets a valid branch pair", () => {
    rememberComparison("main", "feature/catalog");
    expect(rememberedComparison()).toEqual({ base: "main", head: "feature/catalog" });
    forgetComparison();
    expect(rememberedComparison()).toBeNull();
  });

  it("does not remember a comparison of a branch with itself", () => {
    rememberComparison("main", "main");
    expect(rememberedComparison()).toBeNull();
  });

  it("ignores malformed persisted state", () => {
    localStorage.setItem("portolan:last-comparison", "not json");
    expect(rememberedComparison()).toBeNull();
  });
});
