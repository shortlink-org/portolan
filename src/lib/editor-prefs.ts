// Which editor the "open in editor" link opens. One key, one value, and the
// default when nothing is stored or storage is unavailable.

import { DEFAULT_EDITOR, isEditorId } from "./editor-link";
import type { EditorId } from "./editor-link";

export const EDITOR_KEY = "portolan.editor";

export function parseEditor(raw: string | null | undefined): EditorId {
  return isEditorId(raw) ? raw : DEFAULT_EDITOR;
}

export function readEditor(): EditorId {
  try {
    return parseEditor(localStorage.getItem(EDITOR_KEY));
  } catch {
    return DEFAULT_EDITOR;
  }
}

export function writeEditor(editor: EditorId): void {
  try {
    localStorage.setItem(EDITOR_KEY, editor);
  } catch {
    // A private window keeps the choice for the session in memory only.
  }
}
