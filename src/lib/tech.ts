// A technology's mark, looked up by the name the catalog spells it with.
//
// Two vocabularies name a technology in the catalog and both land here. A
// store says what it is with a StoreKind - `postgres`, `redis` - and a service
// carries the names extract-project read off its manifests - `Go`, `Kafka`,
// `PostgreSQL`. The same brand is spelled twice, so the table is keyed by both
// spellings and points at one glyph.
//
// The glyphs come from simple-icons: one filled path per brand, drawn on a
// 24x24 box. They are painted from currentColor like every other icon in the
// app, never in the brand's own colour - a red Redis mark beside a grey
// database glyph would say Redis is the loudest thing on the row, and the row's
// loudest thing is the event. See ../components/TechIcon for how one is drawn.
//
// Not everything has a mark. simple-icons carries no S3 (a trademark it was
// asked to drop) and nothing for River, Watermill or Gin's smaller cousins, and
// a made-up glyph would be a lie about what the brand looks like. Those stay a
// word, which is what they were before.

import {
  siApachekafka,
  siClickhouse,
  siDocker,
  siGin,
  siGo,
  siHelm,
  siMongodb,
  siMysql,
  siNodedotjs,
  siOpenjdk,
  siOpentelemetry,
  siPostgresql,
  siPython,
  siRedis,
  siRust,
  siSqlite,
} from "simple-icons";
import type { StoreKind } from "../catalog";

export interface TechGlyph {
  /** The brand's own name, for a title attribute. */
  title: string;
  /** SVG path data on a 24x24 box, filled. */
  path: string;
}

function glyph(icon: { title: string; path: string }): TechGlyph {
  return { title: icon.title, path: icon.path };
}

const POSTGRES = glyph(siPostgresql);
const REDIS = glyph(siRedis);

/**
 * By store kind. `null` is a kind that has no mark, and is listed rather than
 * left out so that adding a kind to the catalog fails the test until someone
 * has decided what it looks like.
 */
export const STORE_KIND_GLYPH: Record<StoreKind, TechGlyph | null> = {
  postgres: POSTGRES,
  mysql: glyph(siMysql),
  sqlite: glyph(siSqlite),
  redis: REDIS,
  mongodb: glyph(siMongodb),
  clickhouse: glyph(siClickhouse),
  s3: null,
  other: null,
};

/**
 * By the name extract-project writes into `technologies`, spelled exactly as
 * plugins/extract-project/extract.go spells it. A name with no entry here has
 * no mark; the test holds this table and the Go marker list to the same set
 * of names, so a marker added there is either given a glyph or written into
 * TECH_WITHOUT_GLYPH on purpose.
 */
export const TECH_GLYPH: Record<string, TechGlyph> = {
  Go: glyph(siGo),
  "Node.js": glyph(siNodedotjs),
  Rust: glyph(siRust),
  // simple-icons dropped Oracle's Java cup; OpenJDK's is the mark the language
  // is known by everywhere the trademark is not.
  Java: glyph(siOpenjdk),
  Python: glyph(siPython),
  Gin: glyph(siGin),
  Kafka: glyph(siApachekafka),
  PostgreSQL: POSTGRES,
  Redis: REDIS,
  OpenTelemetry: glyph(siOpentelemetry),
  Docker: glyph(siDocker),
  Helm: glyph(siHelm),
};

/** Marker names extract-project can write that deliberately have no mark. */
export const TECH_WITHOUT_GLYPH: readonly string[] = ["River", "Watermill"];

/** The mark for a technology name, or null when it is a word only. */
export function techGlyph(name: string): TechGlyph | null {
  return TECH_GLYPH[name] ?? null;
}
