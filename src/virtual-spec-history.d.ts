declare module "virtual:portolan-spec-history" {
  export interface SpecHistoryCommit {
    commit: string;
    author: string;
    date: string;
  }

  export interface SpecHistoryEntry {
    source: string;
    status: "available" | "unavailable";
    reason?: "not-a-git-repository" | "uncommitted-only" | "shallow-history";
    first?: SpecHistoryCommit;
    latest?: SpecHistoryCommit;
    uncommitted?: boolean;
    repository?: string;
  }

  const histories: Record<string, SpecHistoryEntry[]>;
  export default histories;
}
