# Chat proxy

A Cloudflare Worker that lets the demo site answer questions about the catalog
without shipping an API key in the bundle. The UI posts to `/chat`, the worker
adds the Gemini key and forwards the request to Gemini's OpenAI-compatible
endpoint, streaming the answer back.

What it enforces:

- `Origin` must be in `ALLOWED_ORIGINS` (wrangler.toml), otherwise 403.
- 10 requests per minute per IP, otherwise 429.
- Body up to 400k characters, otherwise 413.
- Only `messages` and `stream` are forwarded. The model is fixed by `MODEL`.

## Deploy

Once, from this directory:

```bash
npm install -g wrangler
wrangler login
wrangler secret put GEMINI_API_KEY   # key from aistudio.google.com, no card attached
wrangler deploy
```

`wrangler deploy` prints the worker URL, e.g. `https://portolan-chat.<account>.workers.dev`.
Put it into the site build as `VITE_CHAT_PROXY_URL` (see `.github/workflows/pages.yml`).

## Check

```bash
curl -N https://portolan-chat.<account>.workers.dev/chat \
  -H 'Origin: https://shortlink-org.github.io' \
  -H 'Content-Type: application/json' \
  -d '{"stream":true,"messages":[{"role":"user","content":"Say hello"}]}'
```

Expect an SSE stream of `data: {...}` lines. The same request without `Origin` returns 403.

## Rotate the key

```bash
wrangler secret put GEMINI_API_KEY
```

No redeploy needed. Delete the old key in AI Studio.

## Self-hosted

The proxy is optional. A self-hosted Portolan without `VITE_CHAT_PROXY_URL`
asks the user for their own key in the chat settings and calls the provider
directly from the browser.
