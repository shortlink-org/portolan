// Changed paths are related to architecture by repository identity and exact
// path ownership. This is deliberately weaker than implementation evidence:
// it only says which catalog component changed with a specification.

import type { Catalog, Service } from "../catalog.ts";
import { bare } from "./repo-name.mjs";

export type PathImpact =
  | {
      path: string;
      repository: string;
      level: "service";
      service: string;
      servicePath: string;
    }
  | {
      path: string;
      repository: string;
      level: "repository";
      reason: "unmatched";
    }
  | {
      path: string;
      repository: string;
      level: "repository";
      reason: "ambiguous";
      candidates: string[];
      servicePath: string;
    };

const cleanPath = (path: string): string => path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");

function owns(service: Service, path: string): boolean {
  const root = cleanPath(service.path);
  return !root || root === "." || path === root || path.startsWith(`${root}/`);
}

function servicesOf(catalog: Catalog): Service[] {
  return catalog.contexts.flatMap((context) => context.services);
}

/**
 * Resolve repository-relative changed paths to their longest unique service
 * owner. Equal longest matches and paths with no owner deliberately remain at
 * repository level.
 */
export function resolvePathImpact(catalog: Catalog, repository: string, paths: readonly string[]): PathImpact[] {
  const repo = bare(repository);
  const services = servicesOf(catalog).filter((service) => repo && bare(service.repo) === repo);

  return [...new Set(paths.map(cleanPath).filter(Boolean))].sort().map((path): PathImpact => {
    const matches = services.filter((service) => owns(service, path));
    if (matches.length === 0) return { path, repository, level: "repository", reason: "unmatched" };

    const longest = Math.max(...matches.map((service) => cleanPath(service.path).length));
    const owners = matches
      .filter((service) => cleanPath(service.path).length === longest)
      .sort((left, right) => left.id.localeCompare(right.id));
    const servicePath = cleanPath(owners[0]!.path);
    if (owners.length > 1) {
      return {
        path,
        repository,
        level: "repository",
        reason: "ambiguous",
        candidates: owners.map((service) => service.id),
        servicePath,
      };
    }
    return { path, repository, level: "service", service: owners[0]!.id, servicePath };
  });
}
