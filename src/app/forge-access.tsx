import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { clearForgeCatalogCache } from "../lib/github-catalog";

interface ForgeAccessState {
  token: string;
  connected: boolean;
  connect: (token: string) => void;
  disconnect: () => void;
}

const Context = createContext<ForgeAccessState | null>(null);

/**
 * Repository credentials deliberately live only in React memory. They never
 * enter a URL, Web Storage, Cache Storage, build output, or the comparison
 * memory that remembers branch names.
 */
export function ForgeAccessProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState("");
  const replace = useCallback((next: string) => {
    clearForgeCatalogCache();
    setToken(next.trim());
  }, []);
  const value = useMemo<ForgeAccessState>(
    () => ({
      token,
      connected: token !== "",
      connect: replace,
      disconnect: () => replace(""),
    }),
    [replace, token],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useForgeAccess(): ForgeAccessState {
  const value = useContext(Context);
  if (!value) throw new Error("useForgeAccess must be used inside ForgeAccessProvider");
  return value;
}
