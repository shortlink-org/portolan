// "Open in my editor", next to every "open on the forge".
//
// It exists only while a local Portolan server answers: that server knows
// where on the disk the workspace is, and a static build does not - so on a
// static build the status request fails once, quietly, and the link is never
// drawn. The status query is the one Settings asks; it is asked here with a
// long stale time, once per page load, and Settings' own refetches keep it
// current.
//
// Which editor is a preference kept in this browser, chosen on Settings.

import { useQuery } from "@tanstack/react-query";
import { PenLine } from "lucide-react";
import { create } from "zustand";
import { editorHref, editorName, editorWhere } from "../lib/editor-link";
import type { EditorId } from "../lib/editor-link";
import { readEditor, writeEditor } from "../lib/editor-prefs";
import { localStatusQuery } from "../lib/queries";
import type { SourceLocation } from "../lib/source-link";

interface EditorState {
  editor: EditorId;
  set: (editor: EditorId) => void;
}

export const useEditorStore = create<EditorState>()((set) => ({
  editor: readEditor(),
  set: (editor) => {
    writeEditor(editor);
    set({ editor });
  },
}));

/** The absolute path of the workspace a local server serves, or null. */
export function useWorkspace(): string | null {
  const status = useQuery({
    ...localStatusQuery(),
    staleTime: Infinity,
    retry: false,
  });
  const data = status.data;
  return data?.local === true && typeof data.workspace === "string"
    ? data.workspace
    : null;
}

export function useEditorTarget(location: SourceLocation | null): {
  href: string;
  name: string;
} | null {
  const workspace = useWorkspace();
  const editor = useEditorStore((s) => s.editor);
  if (!workspace || !location) return null;
  const where = editorWhere(location);
  const href = where ? editorHref(editor, workspace, where) : null;
  return href ? { href, name: editorName(editor) } : null;
}

export function EditorLink({
  location,
  variant = "icon",
  className = "",
}: {
  location: SourceLocation | null;
  /** An icon beside other icons, or a word beside "open ↗". */
  variant?: "icon" | "text";
  className?: string;
}) {
  const target = useEditorTarget(location);
  if (!target) return null;
  const { href, name } = target;
  // No target: a scheme URL hands off to the editor and leaves the page
  // where it is. A new tab would be a blank tab.
  return variant === "icon" ? (
    <a
      href={href}
      className={`rounded-control p-1 text-muted hover:bg-raised hover:text-accent ${className}`}
      aria-label={`Open in ${name}`}
      title={`Open in ${name}`}
    >
      <PenLine size={14} aria-hidden />
    </a>
  ) : (
    <a
      href={href}
      className={`mono rounded-control text-accent hover:underline ${className}`}
      title={`Open in ${name}, at this line`}
    >
      edit ↗
    </a>
  );
}
