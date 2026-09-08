import type { RemoteSourceLocation, SourceLocation } from "./source-link";

const MAX_SOURCE_BYTES = 1024 * 1024;
const LOCAL_SOURCE_URL = `${import.meta.env.BASE_URL}__portolan/source`;

export type SourceFile = {
  content: string;
  path: string;
  ref: string;
};

export type SourceLine = {
  number: number;
  text: string;
  focused: boolean;
};

export class SourceLoadError extends Error {
  readonly status: number;
  readonly authRequired: boolean;

  constructor(message: string, status = 0, authRequired = false) {
    super(message);
    this.name = "SourceLoadError";
    this.status = status;
    this.authRequired = authRequired;
  }
}

function encodedPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function remoteRequest(
  location: RemoteSourceLocation,
  token: string,
): { url: string; headers: HeadersInit } {
  const repoUrl = new URL(location.repositoryUrl);
  const parts = repoUrl.pathname.split("/").filter(Boolean);
  if (parts.length < 2)
    throw new SourceLoadError("The repository URL is incomplete.");

  if (location.provider === "github") {
    const owner = parts[0]!;
    const repo = parts
      .slice(1)
      .join("/")
      .replace(/\.git$/, "");
    const api =
      repoUrl.hostname === "github.com"
        ? "https://api.github.com"
        : `${repoUrl.origin}/api/v3`;
    return {
      url: `${api}/repos/${encodeURIComponent(owner)}/${repo.split("/").map(encodeURIComponent).join("/")}/contents/${encodedPath(location.path)}?ref=${encodeURIComponent(location.ref)}`,
      headers: {
        Accept: "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": "2026-03-10",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };
  }

  const project = parts.join("/").replace(/\.git$/, "");
  return {
    url: `${repoUrl.origin}/api/v4/projects/${encodeURIComponent(project)}/repository/files/${encodeURIComponent(location.path)}/raw?ref=${encodeURIComponent(location.ref)}`,
    headers: token ? { "PRIVATE-TOKEN": token } : {},
  };
}

function loadError(
  location: RemoteSourceLocation,
  response: Response,
  token: string,
): SourceLoadError {
  const forge = location.provider === "github" ? "GitHub" : "GitLab";
  const authRequired =
    response.status === 401 ||
    response.status === 403 ||
    (!token && response.status === 404);
  if (authRequired) {
    return new SourceLoadError(
      token
        ? `${forge} rejected the token or it cannot read this repository.`
        : `${forge} could not read this file. The repository may be private.`,
      response.status,
      true,
    );
  }
  if (response.status === 404) {
    return new SourceLoadError(
      "The source file does not exist at this commit.",
      404,
    );
  }
  if (response.status === 429) {
    return new SourceLoadError(`${forge} API rate limit reached.`, 429);
  }
  return new SourceLoadError(
    `${forge} could not load the source file (${response.status}).`,
    response.status,
  );
}

async function responseText(
  response: Response,
  label: string,
): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES) {
    throw new SourceLoadError(
      `${label} is larger than the 1 MB preview limit.`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_SOURCE_BYTES) {
    throw new SourceLoadError(
      `${label} is larger than the 1 MB preview limit.`,
    );
  }
  if (bytes.includes(0))
    throw new SourceLoadError(`${label} is a binary file.`);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SourceLoadError(`${label} is not UTF-8 text.`);
  }
}

async function loadRemote(
  location: RemoteSourceLocation,
  token: string,
): Promise<SourceFile> {
  const request = remoteRequest(location, token);
  const response = await fetch(request.url, {
    headers: request.headers,
    cache: token ? "no-store" : "default",
  });
  if (!response.ok) throw loadError(location, response, token);
  return {
    content: await responseText(response, location.path),
    path: location.path,
    ref: location.ref,
  };
}

async function loadLocal(
  location: Extract<SourceLocation, { kind: "local" }>,
): Promise<SourceFile> {
  const response = await fetch(LOCAL_SOURCE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Portolan-Local": "1" },
    body: JSON.stringify({ path: location.path }),
    cache: "no-store",
  });
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new SourceLoadError(
      "Local source preview is available only in Portolan local mode.",
      response.status,
    );
  }
  if (!response.ok) {
    const message =
      typeof value === "object" &&
      value &&
      "error" in value &&
      typeof value.error === "string"
        ? value.error
        : `Local source could not be loaded (${response.status}).`;
    throw new SourceLoadError(message, response.status);
  }
  if (
    typeof value !== "object" ||
    !value ||
    !("content" in value) ||
    typeof value.content !== "string"
  ) {
    throw new SourceLoadError("Local source returned an invalid response.");
  }
  return { content: value.content, path: location.path, ref: "working tree" };
}

/**
 * Load one source file. Nothing is remembered here: the query layer keeps
 * the answer for the tab, in memory only, so an authenticated file never
 * reaches Cache Storage.
 */
export function loadSourceCode(
  location: SourceLocation,
  token = "",
): Promise<SourceFile> {
  return location.kind === "remote"
    ? loadRemote(location, token)
    : loadLocal(location);
}

/** The bounded window rendered by the popover, with the catalog line marked. */
export function sourceWindow(
  content: string,
  line: number | null,
  radius = 15,
): SourceLine[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const focus = Math.max(1, Math.min(line ?? 1, lines.length));
  const start = line ? Math.max(1, focus - radius) : 1;
  const end = line
    ? Math.min(lines.length, focus + radius)
    : Math.min(lines.length, radius * 2 + 1);
  return lines.slice(start - 1, end).map((text, index) => ({
    number: start + index,
    text,
    focused: line !== null && start + index === focus,
  }));
}

type SourceLanguageDefinition = { label: string; grammar: string | null };

const SOURCE_LANGUAGES: Record<string, SourceLanguageDefinition> = {
  go: { label: "Go", grammar: "go" },
  rs: { label: "Rust", grammar: "rust" },
  ts: { label: "TypeScript", grammar: "typescript" },
  tsx: { label: "TSX", grammar: "typescript" },
  mts: { label: "TypeScript", grammar: "typescript" },
  cts: { label: "TypeScript", grammar: "typescript" },
  js: { label: "JavaScript", grammar: "javascript" },
  jsx: { label: "JSX", grammar: "javascript" },
  mjs: { label: "JavaScript", grammar: "javascript" },
  cjs: { label: "JavaScript", grammar: "javascript" },
  java: { label: "Java", grammar: "java" },
  py: { label: "Python", grammar: "python" },
  rb: { label: "Ruby", grammar: "ruby" },
  php: { label: "PHP", grammar: "php" },
  cs: { label: "C#", grammar: "csharp" },
  kt: { label: "Kotlin", grammar: "kotlin" },
  kts: { label: "Kotlin", grammar: "kotlin" },
  scala: { label: "Scala", grammar: null },
  c: { label: "C", grammar: "c" },
  h: { label: "C", grammar: "c" },
  cc: { label: "C++", grammar: "cpp" },
  cpp: { label: "C++", grammar: "cpp" },
  hpp: { label: "C++", grammar: "cpp" },
  sql: { label: "SQL", grammar: "sql" },
  proto: { label: "Protocol Buffers", grammar: null },
  graphql: { label: "GraphQL", grammar: "graphql" },
  graphqls: { label: "GraphQL", grammar: "graphql" },
  yaml: { label: "YAML", grammar: "yaml" },
  yml: { label: "YAML", grammar: "yaml" },
  json: { label: "JSON", grammar: "json" },
  xml: { label: "XML", grammar: "xml" },
  wsdl: { label: "WSDL", grammar: "xml" },
  html: { label: "HTML", grammar: "xml" },
  htm: { label: "HTML", grammar: "xml" },
  css: { label: "CSS", grammar: "css" },
  scss: { label: "SCSS", grammar: "scss" },
  less: { label: "Less", grammar: "less" },
  md: { label: "Markdown", grammar: "markdown" },
  markdown: { label: "Markdown", grammar: "markdown" },
  sh: { label: "Shell", grammar: "bash" },
  bash: { label: "Shell", grammar: "bash" },
  zsh: { label: "Shell", grammar: "bash" },
  lua: { label: "Lua", grammar: "lua" },
  swift: { label: "Swift", grammar: "swift" },
  r: { label: "R", grammar: "r" },
  ini: { label: "INI", grammar: "ini" },
  toml: { label: "TOML", grammar: "ini" },
};

function languageDefinition(path: string): SourceLanguageDefinition | null {
  const filename = path.split("/").at(-1)?.toLowerCase() ?? "";
  if (filename === "makefile") return { label: "Makefile", grammar: "makefile" };
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  return SOURCE_LANGUAGES[extension] ?? null;
}

export function sourceLanguage(path: string): string {
  const definition = languageDefinition(path);
  if (definition) return definition.label;
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  return extension ? extension.toUpperCase() : "text";
}

/** Lowlight grammar name, or null when the file should remain plain text. */
export function sourceGrammar(path: string): string | null {
  return languageDefinition(path)?.grammar ?? null;
}
