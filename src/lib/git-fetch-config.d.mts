export interface GitFetchRepo { repo: string; commit?: string; ref?: string }
export function normalizeGitRepos(value: unknown): GitFetchRepo[];
export function gitSourcePath(value: string): string;
export function gitRepoDirectory(repo: string): string;
export interface KnownGitRepository { identity: string; transport: "https" | "ssh"; urls: { https?: string; ssh?: string }; sources: string[] }
export function gitRepositoryAddress(value: string): Omit<KnownGitRepository, "sources">;
export function mergeGitRepositories(candidates: Array<{ repo: string; source: string }>): KnownGitRepository[];
