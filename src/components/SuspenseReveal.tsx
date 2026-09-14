import { Suspense, ViewTransition } from "react";
import type { ReactNode } from "react";

/**
 * Keep the loading state immediate, then cross-fade only when Suspense reveals
 * the heavy lazy child. Cached children and unrelated updates stay instant.
 */
export function SuspenseReveal({
  fallback,
  children,
}: {
  fallback: ReactNode;
  children: ReactNode;
}) {
  return (
    <ViewTransition update="auto" default="none">
      <Suspense fallback={fallback}>{children}</Suspense>
    </ViewTransition>
  );
}
