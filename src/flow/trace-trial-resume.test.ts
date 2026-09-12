import { describe, expect, it } from "vitest";

import { forgetTraceTrial, recallTraceTrial, rememberTraceTrial } from "./trace-trial-resume";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
  };
}

describe("a recording's trial, remembered across a reload", () => {
  it("is picked up by the page that was watching it, and by no other", () => {
    const storage = fakeStorage();
    rememberTraceTrial(storage, "auth-login", { runId: "r1", writeRunId: null });
    expect(recallTraceTrial(storage, "auth-login")).toEqual({ runId: "r1", writeRunId: null });
    expect(recallTraceTrial(storage, "settings")).toBeNull();

    rememberTraceTrial(storage, "auth-login", { runId: "r1", writeRunId: "w1" });
    expect(recallTraceTrial(storage, "auth-login")).toEqual({ runId: "r1", writeRunId: "w1" });

    forgetTraceTrial(storage);
    expect(recallTraceTrial(storage, "auth-login")).toBeNull();
  });

  it("ignores what it cannot read, and survives having nowhere to write", () => {
    const storage = fakeStorage();
    storage.setItem("portolan.trace-trial.v1", "not json");
    expect(recallTraceTrial(storage, "x")).toBeNull();
    storage.setItem("portolan.trace-trial.v1", JSON.stringify({ scope: "x", runId: 3 }));
    expect(recallTraceTrial(storage, "x")).toBeNull();

    expect(() => rememberTraceTrial(null, "x", { runId: "r", writeRunId: null })).not.toThrow();
    expect(recallTraceTrial(null, "x")).toBeNull();
    const broken = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); }, removeItem: () => { throw new Error("no"); } };
    expect(() => rememberTraceTrial(broken, "x", { runId: "r", writeRunId: null })).not.toThrow();
    expect(recallTraceTrial(broken, "x")).toBeNull();
    expect(() => forgetTraceTrial(broken)).not.toThrow();
  });
});
