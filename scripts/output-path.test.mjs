import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { writeOutputFile } from "./output-path.mjs";

describe("generated output paths", () => {
  it("rejects a directory replaced by a symlink between validation and open", () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-output-"));
    const out = join(root, "out");
    const outside = join(root, "outside");
    mkdirSync(join(out, "nested"), { recursive: true });
    mkdirSync(outside);

    try {
      expect(() =>
        writeOutputFile(out, "nested/result.json", "secret", {
          beforeOpen: () => {
            rmSync(join(out, "nested"), { recursive: true });
            symlinkSync(outside, join(out, "nested"), "dir");
          },
        }),
      ).toThrow("is a symlink");
      expect(existsSync(join(outside, "result.json"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a symlink as the final output file", () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-output-"));
    const out = join(root, "out");
    const outside = join(root, "outside.txt");
    mkdirSync(out);
    symlinkSync(outside, join(out, "result.json"));
    try {
      expect(() => writeOutputFile(out, "result.json", "secret")).toThrow("is a symlink");
      expect(existsSync(outside)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
