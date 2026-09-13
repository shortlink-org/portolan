import "@blocknote/mantine/style.css";

import { BlockNoteSchema, combineByGroup } from "@blocknote/core";
import { filterSuggestionItems } from "@blocknote/core/extensions";
import * as locales from "@blocknote/core/locales";
import {
  createReactDiagramBlockSpec,
  getDiagramSlashMenuItems,
  locales as diagramLocales,
} from "@blocknote/diagram-block";
import { BlockNoteView } from "@blocknote/mantine";
import {
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  useCreateBlockNote,
} from "@blocknote/react";
import { Plus, Table2, Trash2, Workflow } from "lucide-react";
import { useMemo, useState } from "react";
import { useTheme } from "../app/theme";

const schema = BlockNoteSchema.create().extend({
  blockSpecs: {
    diagram: createReactDiagramBlockSpec(),
  },
});

const initialContent = [
  { type: "heading" as const, props: { level: 2 as const }, content: "Context and Problem Statement" },
  { type: "paragraph" as const, content: "What decision needs to be made, and why now?" },
  { type: "heading" as const, props: { level: 2 as const }, content: "Decision Drivers" },
  { type: "bulletListItem" as const, content: "A constraint or goal that matters." },
  { type: "heading" as const, props: { level: 2 as const }, content: "Considered Options" },
  { type: "numberedListItem" as const, content: "First option — its relevant trade-off." },
  { type: "numberedListItem" as const, content: "Second option — its relevant trade-off." },
  { type: "heading" as const, props: { level: 2 as const }, content: "Decision Outcome" },
  { type: "paragraph" as const, content: "Chosen option: First option." },
  { type: "heading" as const, props: { level: 3 as const }, content: "Consequences" },
  { type: "bulletListItem" as const, content: "Good: what becomes easier or safer." },
  { type: "bulletListItem" as const, content: "Bad: what cost or limitation is accepted." },
];

type AdrBlockEditorProps = {
  disabled: boolean;
  onChange: (markdown: string) => void;
};

export function AdrBlockEditor({ disabled, onChange }: AdrBlockEditorProps) {
  const { theme } = useTheme();
  const [tableSelected, setTableSelected] = useState(false);
  const editor = useCreateBlockNote({
    schema,
    dictionary: {
      ...locales.en,
      diagram: diagramLocales.en,
    },
    initialContent,
    tables: {
      splitCells: true,
      cellBackgroundColor: true,
      cellTextColor: true,
      headers: true,
    },
  });

  const slashMenuItems = useMemo(() => async (query: string) => (
    filterSuggestionItems(
      combineByGroup(
        getDefaultReactSlashMenuItems(editor),
        getDiagramSlashMenuItems(editor),
      ),
      query,
    )
  ), [editor]);

  function insertAfterCursor(block: {
    type: "table";
    content: { type: "tableContent"; rows: Array<{ cells: string[] }> };
  } | { type: "diagram"; content: string }) {
    const current = editor.getTextCursorPosition().block ?? editor.document.at(-1);
    if (!current) return;
    const inserted = editor.insertBlocks([block], current, "after")[0];
    if (inserted) editor.setTextCursorPosition(inserted, "end");
  }

  function updateSelectedBlock() {
    setTableSelected(editor.getTextCursorPosition().block?.type === "table");
  }

  function removeSelectedTable() {
    const current = editor.getTextCursorPosition().block;
    if (current?.type !== "table") return;
    editor.removeBlocks([current]);
    setTableSelected(false);
    onChange(editor.blocksToMarkdownLossy());
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <span className="mono mr-auto inline-flex items-center gap-2 text-faint">
          <Plus size={13} /> type / for blocks
        </span>
        <button
          type="button"
          className="tbtn h-7 px-2"
          disabled={disabled}
          onClick={() => insertAfterCursor({
            type: "table",
            content: {
              type: "tableContent",
              rows: [{ cells: ["", "", ""] }, { cells: ["", "", ""] }],
            },
          })}
        >
          <Table2 size={13} /> Table
        </button>
        <button type="button" className="tbtn h-7 px-2" disabled={disabled} onClick={() => insertAfterCursor({ type: "diagram", content: "graph TD\n    A[Start] --> B[Decision]" })}>
          <Workflow size={13} /> Mermaid
        </button>
        {tableSelected ? (
          <button type="button" className="tbtn h-7 px-2 text-unresolved" disabled={disabled} onClick={removeSelectedTable}>
            <Trash2 size={13} /> Delete table
          </button>
        ) : null}
      </div>
      <BlockNoteView
        className="adr-block-editor"
        editor={editor}
        editable={!disabled}
        theme={theme}
        slashMenu={false}
        onChange={() => onChange(editor.blocksToMarkdownLossy())}
        onSelectionChange={updateSelectedBlock}
      >
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={slashMenuItems}
        />
      </BlockNoteView>
    </>
  );
}
