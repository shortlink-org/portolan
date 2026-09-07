import { QueryClient } from "@tanstack/react-query";

/**
 * One client for everything the app reads over the network at runtime: forge
 * branches and catalogs, source previews, the local API's status.
 *
 * The defaults are deliberately quiet. A forge answers 401, 404 or a rate
 * limit, and repeating those only hides the message and spends the limit, so
 * nothing retries. Nothing refetches on focus or reconnect either: a reader
 * flipping between tabs must not spend GitHub requests. Data stays fresh for
 * the session, which is what the hand-written promise caches did before; the
 * comparison page's "Try again" resets the forge queries explicitly.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: Infinity,
      gcTime: 30 * 60 * 1000,
    },
  },
});
