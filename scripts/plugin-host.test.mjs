import { describe, expect, it } from "vitest";

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
});
