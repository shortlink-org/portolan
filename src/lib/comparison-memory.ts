const KEY = "portolan:last-comparison";

export type RememberedComparison = {
  base: string;
  head: string;
};

export function rememberedComparison(): RememberedComparison | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "null") as unknown;
    if (!value || typeof value !== "object") return null;
    const { base, head } = value as Partial<RememberedComparison>;
    return typeof base === "string" && base && typeof head === "string" && head
      ? { base, head }
      : null;
  } catch {
    return null;
  }
}

export function rememberComparison(base: string, head: string): void {
  try {
    if (base && head && base !== head) {
      localStorage.setItem(KEY, JSON.stringify({ base, head }));
    } else {
      localStorage.removeItem(KEY);
    }
  } catch {
    // The URL remains the source of truth where storage is unavailable.
  }
}

export function forgetComparison(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget where storage is unavailable.
  }
}
