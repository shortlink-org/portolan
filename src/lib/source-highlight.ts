import { common, createLowlight } from "lowlight";
import { sourceGrammar } from "./source-code";

const lowlight = createLowlight(common);

export type HighlightNode =
  | { type: "text"; value: string }
  | {
      type: "element";
      tagName: string;
      properties?: Record<string, unknown>;
      children: HighlightNode[];
    };

/** Tokenise a bounded source window. Unknown languages deliberately stay plain. */
export function highlightSource(path: string, code: string): HighlightNode[] {
  const grammar = sourceGrammar(path);
  if (!grammar) return [{ type: "text", value: code }];
  try {
    return lowlight.highlight(grammar, code).children as HighlightNode[];
  } catch {
    return [{ type: "text", value: code }];
  }
}
