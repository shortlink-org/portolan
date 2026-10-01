// Decision records and requests for comments: frozen history, never redrawn
// from the current model.

import type { Catalog } from "./catalog.ts";

// ---------------------------------------------------------------------------
// Decision records. An ADR is frozen history: it says what was decided and
// when, not what the model looks like now. Nothing here is regenerated from
// the current catalog, and nothing on an ADR page redraws from it.
// ---------------------------------------------------------------------------

export type AdrStatus =
  "proposed" | "accepted" | "superseded" | "deprecated" | "rejected";

export type AdrScope =
  | { kind: "org" }
  | { kind: "context"; context: string }
  | { kind: "service"; service: string };

export interface AdrRelates {
  services?: string[];
  events?: string[];
  flows?: string[];
}

export interface Adr {
  id: string; // "shop.oms.0007" - scope prefix plus zero-padded number
  slug: string;
  number: number; // 7
  title: string;
  status: AdrStatus;
  date: string; // decision date, ISO
  scope: AdrScope;
  body: string; // markdown, MADR structure
  // Prose about the record that no other field holds - most often that part of
  // it was decided again elsewhere without the whole of it being superseded.
  // It sits in the header, above the frozen body, because it is the thing to
  // read before the decision rather than after it.
  note?: string;
  supersededBy?: string; // Adr.id
  supersedes?: string[];
  relates: AdrRelates;
  source: string; // path to the .md in its repo
  // What git says about the file: the commit that first added it, and the one
  // that last touched it when that is a different commit. Absent when the
  // tree had no history to read.
  created?: AdrCommit;
  revised?: AdrCommit;
}

export interface AdrCommit {
  commit: string; // full sha
  author: string; // author name as git records it
  date: string; // committer date, ISO
}

// ---------------------------------------------------------------------------
// Requests for comments. Unlike an ADR, an RFC is the proposal and its review
// lifecycle. The source vocabulary is retained in `status`; `lifecycle` is a
// deliberately small cross-company projection used only for lists and filters.
// ---------------------------------------------------------------------------

export type RfcLifecycle =
  | "draft"
  | "discussion"
  | "accepted"
  | "implemented"
  | "rejected"
  | "postponed"
  | "withdrawn"
  | "abandoned"
  | "superseded"
  | "unknown";

export type RfcSourceKind = "file" | "github-issue" | "github-pr";

export type RfcRecordRelation =
  | "formalized-by"
  | "informed-by"
  | "supersedes"
  | "related";

export interface RfcRecordLink {
  kind: "adr" | "rfc";
  id: string;
  relation: RfcRecordRelation;
}

export interface Rfc {
  /** Stable catalog identity; it is not required to have ADR's padded-number shape. */
  id: string;
  slug: string;
  /** The identifier people use in discussion: RFC-2556, RFD-0042, KEP-1234. */
  displayId: string;
  /** Optional source number, retained as text because not every process uses integers. */
  number?: string;
  title: string;
  /** Exact source vocabulary: `needs-discussion`, `published`, `committed`, etc. */
  status: string;
  /** Cross-source projection for navigation; never replaces `status` in the audit path. */
  lifecycle: RfcLifecycle;
  scope: AdrScope;
  body: string;
  authors?: string[];
  shepherds?: string[];
  createdAt?: string;
  updatedAt?: string;
  resolvedAt?: string;
  discussionUrl?: string;
  sourceKind: RfcSourceKind;
  /** Repository that owns a file source, spelled like `Service.repo`. */
  repository?: string;
  source: string;
  relates: AdrRelates;
  links?: RfcRecordLink[];
  created?: AdrCommit;
  revised?: AdrCommit;
}

/** RFCs in a catalog written before the field existed are simply absent. */
export function allRfcs(catalog: Catalog): Rfc[] {
  return catalog.rfcs ?? [];
}
