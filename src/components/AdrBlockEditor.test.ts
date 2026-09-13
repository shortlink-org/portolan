// @vitest-environment jsdom

import { BlockNoteEditor } from "@blocknote/core";
import { describe, expect, it } from "vitest";
import { adrEditorSchema } from "./AdrBlockEditor";

describe("ADR block editor Markdown boundary", () => {
  it("round-trips the supported MADR structure, tables and Mermaid fences", () => {
    const markdown = `## Context and Problem Statement

Keep the source readable.

| option | result |
| --- | --- |
| A | accepted |

\`\`\`mermaid
sequenceDiagram
    Client->>API: decide
\`\`\`
`;
    const parser = BlockNoteEditor.create({ schema: adrEditorSchema });
    const blocks = parser.tryParseMarkdownToBlocks(markdown);
    const editor = BlockNoteEditor.create({ schema: adrEditorSchema, initialContent: blocks });
    const written = editor.blocksToMarkdownLossy();

    expect(written).toContain("## Context and Problem Statement");
    expect(written).toMatch(/\| option\s+\| result\s+\|/);
    expect(written).toContain("```mermaid");
    expect(written).toContain("Client->>API: decide");
  });
});
