// Chat proxy for the demo site. Holds the Gemini key so the static UI does
// not have to. Forwards only `messages` and `stream`; the model is fixed here.
const UPSTREAM =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MAX_BODY = 400_000; // characters; llms.txt plus the question

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
    if (!success) return reply(429, "too many requests");

    const raw = await request.text();
    if (raw.length > MAX_BODY) return reply(413, "too large");
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return reply(400, "bad json");
    }
    if (!Array.isArray(body.messages)) return reply(400, "messages required");

    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.GEMINI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.MODEL,
        stream: body.stream === true,
        messages: body.messages,
      }),
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...cors,
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      },
    });
  },
};
