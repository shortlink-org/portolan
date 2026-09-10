// The tools as the browser declares them, for a reader's own model.
//
// read_page runs here and fetches the page from the site itself; the show_*
// tools have no execute on purpose - a call to one ends the answer, and the
// panel draws the card from the catalog it already has.

import { jsonSchema, tool } from "ai";
import { clipPage, pagePath, TOOL_SPECS } from "./prompt";
import { activeCatalogDocs } from "../data";

/** One page of the generated docs, as the model gets it. */
export async function readPage(raw: unknown): Promise<string> {
  const path = pagePath(raw);
  if (!path) return "That is not a page of the catalog. Use a path from the index.";
  if (!activeCatalogDocs) return "No documentation is configured for this catalog.";
  const response = await fetch(`${activeCatalogDocs.pages}${path.slice("docs/".length)}`);
  if (!response.ok) return `No page at ${path}. Use a path from the index.`;
  return clipPage(await response.text());
}

/** llms.txt, once per session. */
let indexPromise: Promise<string> | null = null;
export function loadIndex(): Promise<string> {
  if (!activeCatalogDocs) return Promise.reject(new Error("No documentation is configured for this catalog."));
  indexPromise ??= fetch(activeCatalogDocs.index).then((response) => {
    if (!response.ok) {
      indexPromise = null;
      throw new Error("the catalog index (llms.txt) could not be read");
    }
    return response.text();
  });
  return indexPromise;
}

export function browserTools() {
  return {
    read_page: tool({
      description: TOOL_SPECS.read_page.description,
      inputSchema: jsonSchema<{ path: string }>(TOOL_SPECS.read_page.input),
      execute: ({ path }) => readPage(path),
    }),
    show_service: tool({
      description: TOOL_SPECS.show_service.description,
      inputSchema: jsonSchema<{ id: string }>(TOOL_SPECS.show_service.input),
    }),
    show_flow: tool({
      description: TOOL_SPECS.show_flow.description,
      inputSchema: jsonSchema<{ id: string }>(TOOL_SPECS.show_flow.input),
    }),
    show_between: tool({
      description: TOOL_SPECS.show_between.description,
      inputSchema: jsonSchema<{ a: string; b: string }>(TOOL_SPECS.show_between.input),
    }),
    show_lifecycle: tool({
      description: TOOL_SPECS.show_lifecycle.description,
      inputSchema: jsonSchema<{ aggregate: string }>(TOOL_SPECS.show_lifecycle.input),
    }),
  };
}
