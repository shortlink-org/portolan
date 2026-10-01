// The catalog root: the one value everything else hangs off, and the
// workspace-authored metadata (annotations, work items) that sits beside the
// extracted families without upgrading them.

import type { TypeDef } from "./shared.ts";
import type { BoundedContext, External } from "./contexts.ts";
import type { ProtoModule } from "./interfaces.ts";
import type { Deployment, RepoPin } from "./deployments.ts";
import type { Store } from "./stores.ts";
import type { Flow } from "./flows.ts";
import type { Term } from "./terms.ts";
import type { Adr, Rfc } from "./decisions.ts";

export interface Catalog {
  generatedAt: string; // ISO 8601
  commit: string; // short sha
  contexts: BoundedContext[];
  defs: Record<string, TypeDef>; // shared type definitions by id
  flows: Flow[];
  adrs: Adr[];
  /**
   * Proposals and discussion records. RFCs are deliberately not ADRs: an RFC
   * may still be changing, may be accepted before it is implemented, and may
   * keep its review conversation outside the document. Optional for fragments
   * written before RFC extraction existed; readers treat absence as none.
   */
  rfcs?: Rfc[];
  /**
   * Where the estate keeps its state. Optional in the file and never optional
   * downstream: a catalog written before the extractor learned to read
   * migrations still loads, and every reader sees an empty list rather than an
   * undefined one.
   */
  stores?: Store[];
  /**
   * The schema modules the estate publishes and vendors. Optional in the file
   * and never optional downstream, exactly like `stores`: a catalog written
   * before anything read a proto still loads.
   */
  modules?: ProtoModule[];
  /**
   * The vocabulary each context speaks, read out of its `GLOSSARY.md`.
   * Optional in the file and never optional downstream, exactly like `stores`
   * and `modules`: an estate that has written no glossary renders as it did
   * before there was one to read.
   */
  terms?: Term[];
  /**
   * Where the estate's code was read, for the repositories that are not this
   * one. Optional in the file and never optional downstream, exactly like
   * `stores` and `modules`: an estate whose services all live here has nothing
   * to pin and renders as it did before there was anything to pin.
   */
  repos?: RepoPin[];
  /**
   * Where the estate's services run, read from what deploys them. Optional
   * in the file and never optional downstream, exactly like `repos`: an
   * estate nobody has pointed at a deployer renders as it did before there
   * was anything to place.
   */
  deployments?: Deployment[];
  /**
   * The systems outside the estate that a service calls on a contract: a
   * payment provider, a tax API, a carrier. Nobody here builds one, so it has
   * no context, no aggregates and no repository - only the interfaces it
   * answers on, read from the copy of its document vendored beside the adapter
   * that calls it. Optional in the file and never optional downstream, like
   * `stores`: an estate that calls nobody outside renders as it did before.
   */
  externals?: External[];
  /** Task identity and optional tracker metadata; independent of code history. */
  workItems?: WorkItem[];
  /** Why a task is associated with a catalog entity. */
  workItemLinks?: WorkItemLink[];
  /** Workspace-authored metadata; it never upgrades extracted evidence. */
  annotations?: CatalogAnnotation[];
}

export type AnnotationTarget = { kind: "service" | "context"; id: string };
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type CustomProperty = { label: string; group?: string } & (
  | { type: "link"; value: { url: string; label: string; purpose: "runbook" | "dashboard" | "documentation" | "repository" | "generic" } }
  | { type: "text"; value: string }
  | { type: "number"; value: number; unit?: string }
  | { type: "boolean"; value: boolean }
  | { type: "tags"; value: string[] }
  | { type: "json"; value: JsonValue[] | { [key: string]: JsonValue } }
);
export interface AnnotationDocument {
  version: 1;
  catalog: string;
  target: AnnotationTarget;
  properties: Record<string, CustomProperty>;
  order: string[];
}
export interface CatalogAnnotation extends AnnotationDocument {
  source: string;
  basis: "declared";
  /** Missing in the complete source set, not merely excluded by a profile. */
  unresolved?: boolean;
}

export interface WorkItem {
  /** `<tracker instance>:<issue key>`, not just a provider and key. */
  id: string;
  tracker: string;
  provider: string;
  key: string;
  url: string;
  title?: string;
  status?: string;
  assignee?: string;
  updatedAt?: string;
}

export type WorkItemTarget =
  | { kind: "flow" | "service" | "adr" | "rfc"; id: string }
  | { kind: "step"; id: string; flow: string };

export interface WorkItemCommit {
  repository: string;
  sha: string;
  subject: string;
  author: string;
  date: string;
  /** Matching changed paths, relative to this commit's repository. */
  paths: string[];
}

export interface WorkItemLink {
  workItem: string;
  target: WorkItemTarget;
  /** File/directory matches are deliberately weaker than explicit associations. */
  basis: "declared" | "source-file" | "service-directory";
  commits: WorkItemCommit[];
}
