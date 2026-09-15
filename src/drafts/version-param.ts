// Which version of an entity page is on screen lives in
// the address, `?v=<branch>`, so a reload, the history and a link sent to
// someone else all keep it. No parameter is main.

import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";

export const VERSION_PARAM = "v";

export function versionFrom(search: string): string {
  return new URLSearchParams(search).get(VERSION_PARAM) ?? "main";
}

/** The version on screen, and a way to change it that keeps the page's selection. */
export function useVersion(): [string, (version: string) => void] {
  const location = useLocation();
  const navigate = useNavigate();
  const version = versionFrom(location.search);
  const setVersion = useCallback(
    (next: string) => {
      const params = new URLSearchParams(location.search);
      if (next === "main") params.delete(VERSION_PARAM);
      else params.set(VERSION_PARAM, next);
      const search = params.toString();
      // The hash is carried over: it holds the selection, and a version switch
      // is not a reason to lose the step being read.
      navigate({ pathname: location.pathname, search: search ? `?${search}` : "", hash: location.hash }, { replace: true });
    },
    [location.hash, location.pathname, location.search, navigate],
  );
  return [version, setVersion];
}

/** A page link that opens on a branch's version, keeping the catalog the reader is in. */
export function versionHref(href: string, branch: string): string {
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  const catalog = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("catalog");
  if (catalog && !params.has("catalog")) params.set("catalog", catalog);
  params.set(VERSION_PARAM, branch);
  return `${path}?${params.toString()}`;
}

/** A link inside the drafts that keeps the catalog the reader is in. */
export function catalogHref(href: string): string {
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  const catalog = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("catalog");
  if (catalog && !params.has("catalog")) params.set("catalog", catalog);
  const search = params.toString();
  return search ? `${path}?${search}` : path!;
}
