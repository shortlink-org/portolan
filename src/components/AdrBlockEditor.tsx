import "@blocknote/mantine/style.css";

import { BlockNoteEditor, BlockNoteSchema, combineByGroup } from "@blocknote/core";
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

export const adrEditorSchema = BlockNoteSchema.create().extend({
  blockSpecs: {
    diagram: createReactDiagramBlockSpec(),
  },
});

type AdrBlockEditorProps = {
  disabled: boolean;
  initialMarkdown: string;
  onChange: (markdown: string) => void;
};

function normalizedMarkdown(editor: { blocksToMarkdownLossy: () => string }): string {
  const markdown = editor.blocksToMarkdownLossy().trim();
  return markdown ? `${markdown}\n` : "";
}

export function AdrBlockEditor({ disabled, initialMarkdown, onChange }: AdrBlockEditorProps) {
  const { theme } = useTheme();
  const [tableSelected, setTableSelected] = useState(false);
  const parsed = useMemo(
    () => BlockNoteEditor.create({ schema: adrEditorSchema }).tryParseMarkdownToBlocks(initialMarkdown),
    [initialMarkdown],
  );
  const editor = useCreateBlockNote({
    schema: adrEditorSchema,
    dictionary: {
      ...locales.en,
      diagram: diagramLocales.en,
    },
    initialContent: parsed,
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
    onChange(normalizedMarkdown(editor));
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
        onChange={() => onChange(normalizedMarkdown(editor))}
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
