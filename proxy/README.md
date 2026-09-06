# Chat proxy

A Cloudflare Worker that lets the demo site answer questions about the catalog
without shipping an API key in the bundle. The panel posts the conversation to
`/chat`; the worker runs the answer loop with the demo's Gemini key and streams
it back in the AI SDK's message protocol, which `useChat` in the panel reads.

The loop is the same one the browser runs with a reader's own key: the
instructions and the tools are imported from `src/chat/prompt.ts`, not copied.
The model gets `llms.txt` (the index) and a `read_page` tool that opens one
page of `docs/` at a time; the `show_*` tools have no body here — a call to one
ends the answer, and the panel draws the card from the catalog it holds.

What it enforces:

- `Origin` must be in `ALLOWED_ORIGINS` (wrangler.toml), otherwise 403.
- 10 requests per minute per IP, otherwise 429.
- Body up to 400k characters and 60 messages, otherwise 413 / 400.
- A page path must be a markdown file under `docs/`; anything else is refused
  to the model, not fetched.
- The model is fixed by `MODEL`; the site it reads is fixed by `DOCS_BASE`.

## Deploy

Once, from this directory:

```bash
npm install
npm install -g wrangler
wrangler login
wrangler secret put GEMINI_API_KEY   # key from aistudio.google.com, no card attached
wrangler deploy
```

`wrangler deploy` prints the worker URL, e.g. `https://portolan-chat.<account>.workers.dev`.
Put `<that url>/chat` into the site build as `VITE_CHAT_PROXY_URL` (see
`.github/workflows/pages.yml`). Every later change to the worker, or to
`src/chat/prompt.ts`, is another `wrangler deploy`.

## Check

```bash
curl -N https://portolan-chat.<account>.workers.dev/chat \
  -H 'Origin: https://shortlink-org.github.io' \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"Which contexts are there?"}]}]}'
```

Expect a stream of `data: {...}` lines: a `start`, text deltas, possibly a
`tool-input-available` for `read_page`, and `[DONE]`. The same request without
`Origin` returns 403.

## Rotate the key

```bash
wrangler secret put GEMINI_API_KEY
```

No redeploy needed. Delete the old key in AI Studio.

## Self-hosted

The proxy is optional. A Portolan built without `VITE_CHAT_PROXY_URL` shows the
chat only once the reader sets a model of their own in Settings — any
OpenAI-compatible endpoint, called from the browser. `VITE_CHAT=off` builds a
site with no chat at all.
