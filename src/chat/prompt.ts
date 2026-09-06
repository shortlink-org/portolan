// What the model is told, and what it may ask for.
//
// One file for both halves of the chat: the browser, when the reader brings
// their own key, and the Cloudflare worker in proxy/, which imports this file
// as it is. The rules a page path has to satisfy therefore cannot drift
// between the two, and neither can the instructions.
//
// The model never sees the whole catalog. It sees llms.txt - the index, a few
// hundred lines naming every page - and a tool that opens one page at a time.
// Four opened pages cost a tenth of the tokens the full file would, which on
// a free tier is the difference between a demo that answers all day and one
// that stops before lunch.

/** Longest page the tool hands back; the rest is cut with a note. */
export const PAGE_LIMIT = 60_000;

export type ToolName =
  | "read_page"
  | "show_service"
  | "show_flow"
  | "show_between"
  | "show_lifecycle";

/** A tool as both halves declare it: a sentence and a flat object schema. */
export interface ToolSpec {
  description: string;
  input: {
    type: "object";
    properties: Record<string, { type: "string"; description: string }>;
    required: string[];
  };
}

/** Every tool, with the schema both halves declare it with. */
export const TOOL_SPECS: Record<ToolName, ToolSpec> = {
  read_page: {
    description:
      "Open one page of the catalog by the path the index gives, e.g. docs/auth/README.md. Returns its markdown.",
    input: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "A path exactly as the index spells it",
        },
      },
      required: ["path"],
    },
  },
  show_service: {
    description:
      "Show one service as a card: its context, what it provides and consumes, its aggregates and events. Call it last, after the text.",
    input: {
      type: "object",
      properties: {
        id: { type: "string", description: "The service id, e.g. shop.oms" },
      },
      required: ["id"],
    },
  },
  show_flow: {
    description:
      "Draw one flow as a sequence diagram. Call it last, after the text.",
    input: {
      type: "object",
      properties: {
        id: { type: "string", description: "The flow id or slug" },
      },
      required: ["id"],
    },
  },
  show_between: {
    description:
      "Show what runs between two bounded contexts: every call one makes into the other. Call it last, after the text.",
    input: {
      type: "object",
      properties: {
        a: { type: "string", description: "A context id, e.g. shop" },
        b: { type: "string", description: "Another context id, e.g. payments" },
      },
      required: ["a", "b"],
    },
  },
  show_lifecycle: {
    description:
      "Draw an aggregate's state machine. Call it last, after the text.",
    input: {
      type: "object",
      properties: {
        aggregate: {
          type: "string",
          description: "The aggregate id, e.g. auth.auth.user",
        },
      },
      required: ["aggregate"],
    },
  },
};

/** The tools that draw something and end the answer rather than continue it. */
export const DISPLAY_TOOLS: readonly ToolName[] = [
  "show_service",
  "show_flow",
  "show_between",
  "show_lifecycle",
];

/** How many model calls one answer may take: reads, then the text, then a card. */
export const MAX_STEPS = 6;

/**
 * A page path the tool may open, or null. The index links pages as
 * `docs/<context>/<page>.md`; the model is allowed to drop the `docs/` and
 * a leading slash, and nothing else - no scheme, no `..`, no other extension.
 */
export function pagePath(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let path = input.trim().replace(/^\.?\//, "");
  if (!path.startsWith("docs/")) path = `docs/${path}`;
  if (!path.endsWith(".md")) return null;
  const segments = path.split("/");
  if (
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        !/^[A-Za-z0-9._-]+$/.test(segment),
    )
  ) {
    return null;
  }
  return path;
}

/** The page as the model gets it: cut at the limit, and told so. */
export function clipPage(text: string): string {
  if (text.length <= PAGE_LIMIT) return text;
  return `${text.slice(0, PAGE_LIMIT)}\n\n[cut: the page goes on for ${text.length - PAGE_LIMIT} more characters]`;
}

/** The system prompt, with the index folded in. */
export function instructions(index: string): string {
  return `You are the guide to an architecture catalog: bounded contexts, services, aggregates, events, flows and decisions (ADRs). The index of its pages is below.

How to answer:
- Answer in the language the question was asked in.
- Before answering about a particular service, flow, decision, aggregate or context, call read_page on the page that documents it. The index says what each page covers. Open at most four pages per answer.
- Name things by their catalog ids, spelled exactly as the catalog spells them (shop.oms, auth.auth.user.PasswordChanged, adr slugs), so they can be linked.
- Be brief: a few sentences or a short list. Markdown is fine. Never draw diagrams yourself.
- When a picture would help, finish with exactly one show_* call: show_service for one service, show_flow for a flow, show_between for what runs between two contexts, show_lifecycle for an aggregate's state machine. Write the text first; the call is the last thing in the answer.
- When the catalog does not say, say so rather than guess.

# Index

${index}`;
}
