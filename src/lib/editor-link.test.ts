import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDITOR,
  EDITORS,
  absolutePath,
  editorHref,
  editorName,
  editorWhere,
  isEditorId,
} from "./editor-link";
import { parseEditor } from "./editor-prefs";
import type { BuildInfo } from "./build-info";

const ws = "/Users/me/estate";

describe("absolutePath", () => {
  it("joins the workspace and a relative path", () => {
    expect(absolutePath(ws, "internal/oms/app/checkout.go")).toBe(
      "/Users/me/estate/internal/oms/app/checkout.go",
    );
    expect(absolutePath(`${ws}/`, "./a.go")).toBe("/Users/me/estate/a.go");
  });

  it("refuses what the server would refuse", () => {
    expect(absolutePath(ws, "/etc/passwd")).toBeNull();
    expect(absolutePath(ws, "../outside.go")).toBeNull();
    expect(absolutePath(ws, "a/../../b.go")).toBeNull();
    expect(absolutePath(ws, "")).toBeNull();
    expect(absolutePath("", "a.go")).toBeNull();
  });
});

describe("editorHref", () => {
  it("opens a file at a line in VS Code and its relatives", () => {
    expect(editorHref("vscode", ws, "order_repo.go:141")).toBe(
      "vscode://file/Users/me/estate/order_repo.go:141",
    );
    expect(editorHref("cursor", ws, "order_repo.go")).toBe(
      "cursor://file/Users/me/estate/order_repo.go",
    );
    expect(editorHref("zed", ws, "a/b.rs:7")).toBe(
      "zed://file/Users/me/estate/a/b.rs:7",
    );
  });

  it("speaks JetBrains' own scheme", () => {
    expect(editorHref("idea", ws, "src/Main.java:12")).toBe(
      "idea://open?file=%2FUsers%2Fme%2Festate%2Fsrc%2FMain.java&line=12",
    );
    expect(editorHref("idea", ws, "src/Main.java")).toBe(
      "idea://open?file=%2FUsers%2Fme%2Festate%2Fsrc%2FMain.java",
    );
  });

  it("encodes a space in a directory name", () => {
    expect(editorHref("vscode", "/Users/me/my estate", "a/c.go:3")).toBe(
      "vscode://file/Users/me/my%20estate/a/c.go:3",
    );
  });

  it("is null for what is not a path in the workspace", () => {
    expect(editorHref("vscode", ws, "trace 9f2c1a../span 04")).toBeNull();
    expect(editorHref("vscode", ws, "/abs/path.go:1")).toBeNull();
  });
});

describe("editorWhere", () => {
  const info = {
    repoUrl: "https://github.com/acme/estate",
    commit: "abc",
    forge: "github",
  } as unknown as BuildInfo;

  it("keeps a local path, with its line", () => {
    expect(
      editorWhere({ kind: "local", path: "a/b.go", line: 3, href: null }, info),
    ).toBe("a/b.go:3");
    expect(
      editorWhere({ kind: "local", path: "a/b.go", line: null, href: null }, info),
    ).toBe("a/b.go");
  });

  it("keeps a forge path only in the repository this was built from", () => {
    const remote = {
      kind: "remote" as const,
      provider: "github" as const,
      origin: "https://github.com",
      ref: "abc",
      path: "a/b.go",
      line: 9,
      href: "https://github.com/acme/estate/blob/abc/a/b.go#L9",
    };
    expect(
      editorWhere(
        { ...remote, repositoryUrl: "https://github.com/acme/estate" },
        info,
      ),
    ).toBe("a/b.go:9");
    expect(
      editorWhere(
        { ...remote, repositoryUrl: "https://github.com/acme/other" },
        info,
      ),
    ).toBeNull();
    expect(
      editorWhere(
        { ...remote, repositoryUrl: "https://github.com/acme/estate" },
        { ...info, repoUrl: "" },
      ),
    ).toBeNull();
  });
});

describe("editors", () => {
  it("names every editor and defaults to VS Code", () => {
    for (const e of EDITORS) {
      expect(isEditorId(e.id)).toBe(true);
      expect(editorName(e.id)).toBe(e.name);
    }
    expect(isEditorId("emacs")).toBe(false);
    expect(parseEditor(null)).toBe(DEFAULT_EDITOR);
    expect(parseEditor("emacs")).toBe(DEFAULT_EDITOR);
    expect(parseEditor("zed")).toBe("zed");
  });
});
