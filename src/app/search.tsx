import { createContext, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

interface SearchCtx {
  query: string;
  setQuery: (q: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

const Ctx = createContext<SearchCtx | null>(null);

export function SearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const value = useMemo(() => ({ query, setQuery, inputRef }), [query]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSearch(): SearchCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSearch must be used inside SearchProvider");
  return ctx;
}
