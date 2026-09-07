// A source path, as a link the reader's own editor opens.
//
// The forge link answers "show me this file at the built commit". This one
// answers "let me edit it", which is the question a reader whose own catalog
// is on screen is actually asking - and going through GitHub to reach a file
// that is on the disk under the browser is the trip this saves.
//
// It needs an absolute path, which only the local server knows: the catalog
// spells sources relative to the repository, and the browser has no idea
// where that repository is. So a link exists only in local mode, and the
// workspace the server reports is joined with the catalog's own path.

import { buildInfo } from "./build-info";
import type { BuildInfo } from "./build-info";
import { bare, looksLikePath, splitLine } from "./source-link";
import type { SourceLocation } from "./source-link";

/** The editors with a URL scheme that opens a file at a line. */
export const EDITORS = [
  { id: "vscode", name: "VS Code" },
  { id: "vscode-insiders", name: "VS Code Insiders" },
  { id: "cursor", name: "Cursor" },
  { id: "zed", name: "Zed" },
  { id: "idea", name: "JetBrains" },
] as const;

export type EditorId = (typeof EDITORS)[number]["id"];

export const DEFAULT_EDITOR: EditorId = "vscode";

export function isEditorId(value: unknown): value is EditorId {
  return EDITORS.some((e) => e.id === value);
}

export function editorName(id: EditorId): string {
  return EDITORS.find((e) => e.id === id)?.name ?? id;
}

/**
 * Join a workspace and a catalog path into one absolute path, or null when
 * the path is not one the workspace can hold: absolute already, or climbing
 * out of it. The server refuses those too; refusing here means no dead link.
 */
export function absolutePath(workspace: string, path: string): string | null {
  const root = workspace.replace(/\/+$/, "");
  if (!root) return null;
  const clean = path.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (!clean || clean.startsWith("/") || clean.split("/").includes("..")) {
    return null;
  }
  return `${root}/${clean}`;
}

/**
 * The link that opens `where` - a path, or `path:line` - in `editor`, or null
 * when there is nothing to open. The path segments are percent-encoded as a
 * URL's would be, so a space in a directory name survives the scheme.
 */
export function editorHref(
  editor: EditorId,
  workspace: string,
  where: string,
): string | null {
  const { path, line } = splitLine(where);
  if (!looksLikePath(path)) return null;
  const absolute = absolutePath(workspace, path);
  if (!absolute) return null;

  if (editor === "idea") {
    const query = new URLSearchParams({ file: absolute });
    if (line) query.set("line", String(line));
    return `idea://open?${query.toString()}`;
  }

  const encoded = absolute.split("/").map(encodeURIComponent).join("/");
  return `${editor}://file${encoded}${line ? `:${line}` : ""}`;
}

/**
 * The catalog path a resolved source can be edited at, or null when the file
 * is not in this workspace: a service fetched from another repository lives
 * on the forge, not on the disk under the browser. A path with no forge
 * behind it is local by definition, and a forge path counts when the forge
 * is the repository this was built from.
 */
export function editorWhere(
  location: SourceLocation,
  info: BuildInfo = buildInfo,
): string | null {
  if (location.kind === "remote") {
    if (!info.repoUrl || bare(location.repositoryUrl) !== bare(info.repoUrl)) {
      return null;
    }
  }
  return location.line ? `${location.path}:${location.line}` : location.path;
}
