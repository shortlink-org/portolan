// Whether there is a chat, and who answers it.
//
// Three switches, from the outside in:
//
//   VITE_CHAT=off          the build has no chat: no button, no settings
//                          section, and the panel's code is not in the bundle
//   VITE_CHAT_PROXY_URL    the worker that answers with the demo's key; a
//                          self-hosted build usually has none
//   the reader             a switch in Settings, and a model of their own with
//                          its key, both kept in this browser
//
// The pure decision is here so it can be tested without a window. The store
// that reads localStorage is in prefs.ts.

export interface ChatBuild {
  built: boolean;
  proxyUrl: string;
}

/** A provider the reader brings: any OpenAI-compatible chat endpoint. */
export interface OwnModel {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ChatPrefs {
  /** null until the reader has touched the switch. */
  enabled: boolean | null;
  own: OwnModel | null;
}

export type ChatRoute =
  | { kind: "off" }
  | { kind: "proxy"; url: string }
  | { kind: "own"; model: OwnModel }
  /** Switched on by hand, but nothing to answer with yet. */
  | { kind: "unconfigured" };

export const BUILD: ChatBuild = {
  built: import.meta.env.VITE_CHAT !== "off",
  // The public build receives the worker URL from CI. In development Vite
  // exposes the same worker through a same-origin proxy, so the real demo chat
  // works on any local port without weakening the worker's CORS allowlist.
  proxyUrl: (
    import.meta.env.VITE_CHAT_PROXY_URL ??
    (import.meta.env.DEV ? "/api/portolan-chat" : "")
  ).trim(),
};

const OFF: ChatRoute = { kind: "off" };

/** A model of the reader's own that can be called: an endpoint and a name. A key is optional - Ollama has none. */
export function ownReady(own: OwnModel | null): own is OwnModel {
  return own !== null && own.baseUrl.trim() !== "" && own.model.trim() !== "";
}

/**
 * Who answers. The reader's own model wins over the proxy: it is the one
 * thing they set by hand. With neither, the chat is off until they switch it
 * on - and then it opens to a hint rather than to nothing.
 */
export function chatRoute(build: ChatBuild, prefs: ChatPrefs): ChatRoute {
  if (!build.built) return OFF;
  if (prefs.enabled === false) return OFF;
  if (ownReady(prefs.own)) return { kind: "own", model: prefs.own };
  if (build.proxyUrl !== "") return { kind: "proxy", url: build.proxyUrl };
  return prefs.enabled === true ? { kind: "unconfigured" } : OFF;
}

/** What the panel's header says about who is answering. */
export function routeLabel(route: ChatRoute): string {
  switch (route.kind) {
    case "proxy":
      return "default model · demo proxy";
    case "own": {
      let host = route.model.baseUrl;
      try {
        host = new URL(route.model.baseUrl).host;
      } catch {
        /* not a URL yet: show it as typed */
      }
      return `${route.model.model} · ${host}`;
    }
    default:
      return "";
  }
}

/** The stored preferences, from the two raw strings localStorage holds. */
export function parsePrefs(
  enabledRaw: string | null,
  ownRaw: string | null,
): ChatPrefs {
  const enabled =
    enabledRaw === "on" ? true : enabledRaw === "off" ? false : null;
  let own: OwnModel | null = null;
  if (ownRaw) {
    try {
      const parsed = JSON.parse(ownRaw) as Partial<OwnModel>;
      own = {
        baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
        apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
        model: typeof parsed.model === "string" ? parsed.model : "",
      };
    } catch {
      own = null;
    }
  }
  return { enabled, own };
}

export interface Preset {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  /** Whether the endpoint wants a key at all. */
  key: boolean;
  /** Where to get one. */
  keysUrl?: string;
}

/**
 * The endpoints a reader is likely to reach for. Each speaks the OpenAI chat
 * protocol; the model names are the ones current when this was written, and
 * every field stays editable.
 */
export const PRESETS: Preset[] = [
  {
    id: "gemini",
    name: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.6-flash",
    key: true,
    keysUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    key: true,
    keysUrl: "https://console.groq.com/keys",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "",
    key: true,
    keysUrl: "https://openrouter.ai/keys",
  },
  {
    id: "ollama",
    name: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.2",
    key: false,
  },
];
