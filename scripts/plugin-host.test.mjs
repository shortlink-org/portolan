import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { runPlugin, validateResponse, warningsIn } from "./plugin-host.mjs";

describe("plugin response validation", () => {
  it("accepts only named text files", () => {
    expect(validateResponse("fixture", { files: [{ name: "nested/result.json", contents: "{}" }] })).toEqual({
      files: [{ name: "nested/result.json", contents: "{}" }],
    });
  });

  it("accepts canonical base64 files and rejects malformed binary output", () => {
    expect(validateResponse("fixture", { files: [{ name: "image.png", contents: "iVBORw==", encoding: "base64" }] })).toEqual({
      files: [{ name: "image.png", contents: "iVBORw==", encoding: "base64" }],
    });
    expect(() => validateResponse("fixture", { files: [{ name: "image.png", contents: "not base64", encoding: "base64" }] })).toThrow("not valid base64");
    expect(() => validateResponse("fixture", { files: [{ name: "image.png", contents: "x", encoding: "binary" }] })).toThrow("encoding is not supported");
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
    expect(response.warnings).toEqual([]);
  });

  it("keeps the warnings a plugin wrote to stderr beside its response", async () => {
    const script = `
      process.stderr.write("warning: shop.cart: internal/domain/errors has no struct called Errors\\n");
      process.stderr.write("a note that is not a warning\\n");
      process.stderr.write("warning: docs/adr/0004.md: left out of the fragment\\n");
      process.stdin.resume();
      process.stdin.on("end", () => process.stdout.write(JSON.stringify({files:[]})));
    `;
    const response = await runPlugin(
      { name: "fixture", process: { command: process.execPath, args: ["-e", script] } },
      { portolanVersion: "0.1.0" },
    );
    expect(response.warnings).toEqual([
      "shop.cart: internal/domain/errors has no struct called Errors",
      "docs/adr/0004.md: left out of the fragment",
    ]);
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

// The built-in module, when `npm run plugins:build` has produced it. These
// tests read a tree through it, which is what portolan.0006 allows an extract
// step and denies everything else.
const builtinModule = fileURLToPath(new URL("../plugins/portolan-go.wasm", import.meta.url));
const describeBuiltin = existsSync(builtinModule) ? describe : describe.skip;

describeBuiltin("wasm preopen", () => {
  const plugin = { name: "project", wasm: { url: `file://${builtinModule}` } };
  const request = {
    portolanVersion: "0.1.0",
    input: { root: ".", output: "portolan", commit: "abc1234", generatedAt: "2026-09-08T00:00:00Z" },
    options: { group: "fixture", component: "fixture", componentName: "Fixture", out: "project.json" },
  };
  const workspace = () => {
    const dir = mkdtempSync(join(tmpdir(), "portolan-preopen-"));
    writeFileSync(join(dir, "README.md"), "# Fixture\n");
    writeFileSync(join(dir, "go.mod"), "module example.com/fixture\n\ngo 1.24\n");
    return dir;
  };
  const serviceIn = (result) => JSON.parse(result.files[0].contents).contexts[0].services[0];

  it("reads the workspace an extract step is given", async () => {
    const dir = workspace();
    try {
      const service = serviceIn(await runPlugin(plugin, request, {}, { workspace: dir }));
      expect(service.readme).toBe("# Fixture");
      expect(service.technologies).toContain("Go");
      expect(service.repo).toBe("example.com/fixture");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sees nothing when no workspace is given, as a generator or describe never should", async () => {
    const dir = workspace();
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const service = serviceIn(await runPlugin(plugin, request));
      expect(service.readme).toBe("");
      expect(service.technologies ?? []).not.toContain("Go");
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("warningsIn", () => {
  it("reads only the warning lines, and nothing from an empty stderr", () => {
    expect(warningsIn("")).toEqual([]);
    expect(warningsIn(undefined)).toEqual([]);
    expect(warningsIn("warning: one\r\nnote\nwarning:   two  \nwarning: \n")).toEqual(["one", "two"]);
  });
});
