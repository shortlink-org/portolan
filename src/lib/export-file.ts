import { buildInfo } from "./build-info";
import type { BuildInfo } from "./build-info";

function safePart(value: string, fallback: string): string {
  const safe = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || fallback;
}

/** A reproducible export name that identifies both the artifact and its catalog revision. */
export function artifactFilename(
  name: string,
  extension: string,
  info: BuildInfo = buildInfo,
): string {
  const revision = info.shortCommit || info.branch || "catalog";
  return `${safePart(name, "artifact")}-${safePart(revision, "catalog")}.${safePart(extension.replace(/^\./, ""), "bin")}`;
}
