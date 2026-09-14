import { describe, expect, it, vi } from "vitest";

import { checkForUpdate, isNewer } from "./update.mjs";

describe("dev update suggestion", () => {
  it("checks latest once and returns the newer version", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: "0.5.0" }),
    }));
    const latest = await checkForUpdate("0.4.0", { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://registry.npmjs.org/@shortlink-org%2Fportolan/latest",
      expect.objectContaining({ headers: { accept: "application/json" }, signal: expect.any(AbortSignal) }),
    );
    expect(latest).toBe("0.5.0");
  });

  it("stays quiet when latest is not newer", async () => {
    for (const version of ["0.4.0", "0.3.9"]) {
      await expect(checkForUpdate("0.4.0", {
        fetchImpl: async () => ({ ok: true, json: async () => ({ version }) }),
      })).resolves.toBeNull();
    }
  });

  it("does not block dev startup when the registry is unavailable", async () => {
    await expect(checkForUpdate("0.4.0", {
      fetchImpl: async () => { throw new Error("offline"); },
    })).resolves.toBeNull();
  });
});

describe("version comparison", () => {
  it.each([
    ["0.4.1", "0.4.0", true],
    ["0.5.0", "0.4.9", true],
    ["1.0.0", "0.99.0", true],
    ["1.0.0", "1.0.0-rc.1", true],
    ["1.0.0-rc.2", "1.0.0-rc.1", true],
    ["1.0.0-rc.1", "1.0.0", false],
    ["not-semver", "1.0.0", false],
  ])("compares %s with %s", (candidate, current, expected) => {
    expect(isNewer(candidate, current)).toBe(expected);
  });
});
