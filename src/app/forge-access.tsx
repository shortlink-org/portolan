import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ForgeRepo } from "../lib/github-catalog";
import { forgeKeys, sourceKeys } from "../lib/queries";

interface ForgeAccessState {
  tokenFor: (repo: ForgeRepo | string) => string;
  connectedTo: (repo: ForgeRepo | string) => boolean;
  connect: (repo: ForgeRepo | string, token: string) => void;
  disconnect: (repo: ForgeRepo | string) => void;
}

const Context = createContext<ForgeAccessState | null>(null);

/**
 * Repository credentials deliberately live only in React memory. They never
 * enter a URL, Web Storage, Cache Storage, build output, or the comparison
 * memory that remembers branch names.
 */
export function ForgeAccessProvider({ children }: { children: ReactNode }) {
  const [tokens, setTokens] = useState<Readonly<Record<string, string>>>({});
  const queryClient = useQueryClient();
  // A token change makes every forge answer somebody else's. Dropping the
  // queries, not just marking them stale, also drops the old token's keys.
  const clearRuntimeCaches = useCallback(() => {
    queryClient.removeQueries({ queryKey: forgeKeys.all });
    queryClient.removeQueries({ queryKey: sourceKeys.all });
  }, [queryClient]);
  const connect = useCallback((repo: ForgeRepo | string, token: string) => {
    const scope = forgeCredentialScope(repo);
    const next = token.trim();
    if (!scope || !next) return;
    clearRuntimeCaches();
    setTokens((current) => ({ ...current, [scope]: next }));
  }, [clearRuntimeCaches]);
  const disconnect = useCallback((repo: ForgeRepo | string) => {
    const scope = forgeCredentialScope(repo);
    clearRuntimeCaches();
    setTokens((current) => {
      if (!scope || !(scope in current)) return current;
      const next = { ...current };
      delete next[scope];
      return next;
    });
  }, [clearRuntimeCaches]);
  const value = useMemo<ForgeAccessState>(
    () => ({
      tokenFor: (repo) => tokens[forgeCredentialScope(repo)] ?? "",
      connectedTo: (repo) => Boolean(tokens[forgeCredentialScope(repo)]),
      connect,
      disconnect,
    }),
    [connect, disconnect, tokens],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useForgeAccess(): ForgeAccessState {
  const value = useContext(Context);
  if (!value) throw new Error("useForgeAccess must be used inside ForgeAccessProvider");
  return value;
}

/** Tokens are shared by repositories on one forge host, but never across hosts. */
export function forgeCredentialScope(repo: ForgeRepo | string): string {
  const value = typeof repo === "string" ? repo : repo.webUrl;
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return value.trim().replace(/\/$/, "").toLowerCase();
  }
}
