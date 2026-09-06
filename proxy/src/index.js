// The demo's answerer.
//
// The static site cannot hold a key, so this worker holds it. It runs the
// same loop the browser runs with a key of the reader's own - the prompt and
// the tools are imported from the app, not copied - and streams the answer
// back in the SDK's own protocol, which is what useChat in the panel reads.
//
// What it refuses: any Origin but the site's, more than ten requests a minute
// from one address, a body over the limit, and any page path that is not a
// markdown file under docs/. What it never sends the model: the whole
// catalog. The index is a few hundred lines; pages are opened one at a time.

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  ToolLoopAgent,
  createAgentUIStreamResponse,
  jsonSchema,
  stepCountIs,
  tool,
} from "ai";
import {
  DISPLAY_TOOLS,
  MAX_STEPS,
  TOOL_SPECS,
  clipPage,
  instructions,
  pagePath,
} from "../../src/chat/prompt.ts";

const MAX_BODY = 400_000; // characters: a conversation, not a catalog
const MAX_MESSAGES = 60;
/** The site's files, cached at the edge for five minutes. */
const CACHED = { cf: { cacheTtl: 300, cacheEverything: true } };

async function readIndex(env) {
  const response = await fetch(`${env.DOCS_BASE}llms.txt`, CACHED);
  if (!response.ok) throw new Error(`llms.txt answered ${response.status}`);
  return response.text();
}

async function readPage(env, raw) {
  const path = pagePath(raw);
  if (!path) return "That is not a page of the catalog. Use a path from the index.";
  const response = await fetch(`${env.DOCS_BASE}${path}`, CACHED);
  if (!response.ok) return `No page at ${path}. Use a path from the index.`;
  return clipPage(await response.text());
}

function tools(env) {
  const set = {
    read_page: tool({
      description: TOOL_SPECS.read_page.description,
      inputSchema: jsonSchema(TOOL_SPECS.read_page.input),
      execute: ({ path }) => readPage(env, path),
    }),
  };
  // Drawn by the browser from the catalog it holds; here they only exist so
  // the model may call them, and a call ends the answer.
  for (const name of DISPLAY_TOOLS) {
    set[name] = tool({
      description: TOOL_SPECS[name].description,
      inputSchema: jsonSchema(TOOL_SPECS[name].input),
    });
  }
  return set;
}

/** The status first, so the panel can tell a limit from a busy model. */
function describe(error) {
  const status = error && typeof error === "object" ? error.statusCode : undefined;
  const message =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : String(error);
  return status ? `${status}: ${message}` : message;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") ?? "";
    const allowed = env.ALLOWED_ORIGINS.split(",").includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": allowed ? origin : "null",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    };
    const reply = (status, text) => new Response(text, { status, headers: cors });

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST" || new URL(request.url).pathname !== "/chat") {
      return reply(404, "not found");
    }
    if (!allowed) return reply(403, "forbidden");

    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const { success } = await env.CHAT_LIMIT.limit({ key: ip });
    if (!success) return reply(429, "too many requests: ten a minute per reader");

    const raw = await request.text();
    if (raw.length > MAX_BODY) return reply(413, "too large");
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return reply(400, "bad json");
    }
    if (!Array.isArray(body.messages) || body.messages.length > MAX_MESSAGES) {
      return reply(400, "messages required");
    }

    let index;
    try {
      index = await readIndex(env);
    } catch (error) {
      return reply(502, `the catalog index could not be read: ${describe(error)}`);
    }

    const google = createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY });
    const agent = new ToolLoopAgent({
      model: google(env.MODEL),
      instructions: instructions(index),
      tools: tools(env),
      stopWhen: stepCountIs(MAX_STEPS),
    });

    return createAgentUIStreamResponse({
      agent,
      uiMessages: body.messages,
      headers: cors,
      onError: describe,
    });
  },
};
