import type { GitAccessResult } from "./local-api";

export type RememberedGitAccess = GitAccessResult & { checkedAt: string };
type Memory = { transport?: "https" | "ssh"; results: Record<string, RememberedGitAccess> };
const key = (workspace: string, repository: string) => `portolan:git-access:v1:${JSON.stringify([workspace, repository])}`;

/** Browser-local observations, isolated by workspace and exact transport URL. */
export function readGitAccess(workspace: string, repository: string): Memory {
  try {
    const saved = JSON.parse(localStorage.getItem(key(workspace, repository)) ?? "null");
    const results: Memory["results"] = {};
    for (const [url, value] of Object.entries(saved?.results ?? {}).slice(-6)) {
      const result = value as Partial<RememberedGitAccess> | null;
      if (result && ["accessible", "unavailable"].includes(result.status ?? "") && typeof result.message === "string" && result.message.length <= 1000 && typeof result.checkedAt === "string" && Number.isFinite(Date.parse(result.checkedAt))) {
        results[url] = { status: result.status as GitAccessResult["status"], message: result.message, checkedAt: result.checkedAt };
      }
    }
    return { transport: ["https", "ssh"].includes(saved?.transport) ? saved.transport : undefined, results };
  } catch { return { results: {} }; }
}

export function rememberGitAccess(workspace: string, repository: string, transport: "https" | "ssh", observation?: { url: string; result: RememberedGitAccess }): void {
  try {
    const memory = readGitAccess(workspace, repository);
    if (observation) memory.results[observation.url] = observation.result;
    localStorage.setItem(key(workspace, repository), JSON.stringify({ ...memory, transport }));
  } catch { /* Storage can be disabled or full; checking access must still work. */ }
}
