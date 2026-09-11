// What every reader-side integration shares: a web address the reader typed
// in, kept in this browser and nowhere else.
//
// The value belongs to the reader, not to the catalog: two readers can point
// the same generated estate at different installations. It therefore lives in
// localStorage, like the editor and display preferences, and never reaches
// portolan.json or a page that is committed.

import { create } from "zustand";

/**
 * A trimmed http(s) URL without its fragment and trailing slash, "" for an
 * empty value, and null for anything that cannot be opened safely - a
 * javascript: address, or words that are not a URL at all.
 */
export function normalizeIntegrationUrl(value: string): string | null {
  const clean = value.trim();
  if (!clean) return "";
  try {
    const url = new URL(clean);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export interface IntegrationState {
  url: string;
  setUrl: (url: string) => void;
}

/** One store per integration, read from localStorage under its own key. */
export function createIntegrationStore(key: string) {
  const read = (): string => {
    try {
      const value = localStorage.getItem(key) ?? "";
      return normalizeIntegrationUrl(value) ?? "";
    } catch {
      return "";
    }
  };

  const write = (value: string): void => {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {
      /* private mode: keep the value for this session */
    }
  };

  return create<IntegrationState>()((set) => ({
    url: read(),
    setUrl: (url) => {
      const normalized = normalizeIntegrationUrl(url);
      if (normalized === null) return;
      write(normalized);
      set({ url: normalized });
    },
  }));
}
