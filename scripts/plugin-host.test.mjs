import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { runPlugin, validateResponse } from "./plugin-host.mjs";

describe("plugin response validation", () => {
  it("accepts only named text files", () => {
    expect(validateResponse("fixture", { files: [{ name: "nested/result.json", contents: "{}" }] })).toEqual({
      files: [{ name: "nested/result.json", contents: "{}" }],
    });
  });

  it.each(["../secret", "/tmp/result", "C:\\tmp\\result", "a/../../secret", "./result"])(
    "rejects unsafe output name %s",
    (name) => {
      expect(() => validateResponse("fixture", { files: [{ name, contents: "" }] })).toThrow("unsafe name");
    },
  );

  it("rejects duplicate files and removed protocol properties", () => {
    expect(() =>
      validateResponse("fixture", {
        files: [
          { name: "same", contents: "one" },
          { name: "same", contents: "two" },
        ],
      }),
    ).toThrow("duplicate output file");
    expect(() => validateResponse("fixture", { files: [], diagnostics: [] })).toThrow("unsupported properties");
  });
});

describe("process plugins", () => {
  it("passes arguments directly and parses a bounded response", async () => {
    const script = `
      process.stdin.resume();
      process.stdin.on("end", () => process.stdout.write(JSON.stringify({files:[{name:process.argv[1],contents:"ok"}]})));
    `;
    const response = await runPlugin(
      { name: "fixture", process: { command: process.execPath, args: ["-e", script, "name with spaces.txt"] } },
      { portolanVersion: "0.1.0" },
    );
    expect(response.files).toEqual([{ name: "name with spaces.txt", contents: "ok" }]);
  });

  it("kills a zip-bomb-like response before buffering it", async () => {
    const script = `process.stdout.write("x".repeat(4096));`;
    await expect(
      runPlugin(
        { name: "bomb", process: { command: process.execPath, args: ["-e", script] } },
        {},
        { responseBytes: 1024 },
      ),
    ).rejects.toThrow("response exceeds 1024 bytes");
  });
});

describe("wasm plugins", () => {
  it("terminates a module whose _start never returns", async () => {
    const dir = mkdtempSync(join(tmpdir(), "portolan-plugin-host-"));
    const path = join(dir, "hang.wasm");
    // (module (memory (export "memory") 1)
    //   (func (export "_start") (loop br 0)))
    writeFileSync(path, Buffer.from(
      "0061736d01000000010401600000030201000503010001071302066d656d6f72790200065f737461727400000a0901070003400c000b0b",
      "hex",
    ));
    try {
      await expect(
        runPlugin(
          { name: "hang", wasm: { url: `file://${path}` } },
          {},
          { timeoutMs: 100 },
        ),
      ).rejects.toThrow("timed out after 100 ms");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
