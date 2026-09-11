// A technology's mark, looked up by whatever the catalog calls it.
//
// Two vocabularies name a technology in the catalog and both land here. A
// store says what it is with a StoreKind - `postgres`, `redis` - and a service
// carries the names an extractor read off its manifests - `Go`, `Kafka`,
// `PostgreSQL`. Tomorrow's extractor will spell the same brand a third way,
// so the table is not keyed by a spelling: every mark lists the names it is
// known by, and a lookup folds case and punctuation before it compares, so
// `Postgres`, `postgresql`, `PostgreSQL` and `pg` are one entry.
//
// The glyphs come from simple-icons: one filled path per brand, drawn on a
// 24x24 box. They are painted from currentColor like every other icon in the
// app, never in the brand's own colour - a red Redis mark beside a grey
// database glyph would say Redis is the loudest thing on the row, and the row's
// loudest thing is the event. See ../components/TechIcon for how one is drawn.
//
// The table is deliberately wider than what any extractor writes today. A new
// stack lands as a new marker name in an extractor, and the mark for it should
// already be here rather than be one more thing that PR has to remember. What
// is NOT here is anything simple-icons does not carry - S3, gRPC, Protobuf,
// River, Watermill - because a made-up glyph is a lie about what the brand
// looks like. Those stay a word, which is what they were before.

import {
  siAngular,
  siAnsible,
  siApachecassandra,
  siApachecouchdb,
  siApachekafka,
  siApachepulsar,
  siArgo,
  siAuth0,
  siBackstage,
  siBun,
  siC,
  siCelery,
  siCilium,
  siClickhouse,
  siClojure,
  siCloudflare,
  siConfluence,
  siCockroachlabs,
  siConsul,
  siCouchbase,
  siCplusplus,
  siCypress,
  siDart,
  siDatadog,
  siDeno,
  siDjango,
  siDocker,
  siDotnet,
  siDrizzle,
  siDuckdb,
  siElasticsearch,
  siElectron,
  siElixir,
  siEnvoyproxy,
  siErlang,
  siEtcd,
  siExpress,
  siFastapi,
  siFastify,
  siFirebase,
  siFlask,
  siFlutter,
  siGin,
  siGit,
  siGithubactions,
  siGitlab,
  siGo,
  siGooglebigquery,
  siGooglecloud,
  siGooglecloudspanner,
  siGradle,
  siGrafana,
  siGraphql,
  siHaskell,
  siHelm,
  siHibernate,
  siHono,
  siHuggingface,
  siInfluxdb,
  siIstio,
  siJaeger,
  siJavascript,
  siJenkins,
  siJest,
  siKeycloak,
  siKotlin,
  siKtor,
  siKubernetes,
  siLangchain,
  siLaravel,
  siLinkerd,
  siLua,
  siMariadb,
  siMarkdown,
  siMeilisearch,
  siMermaid,
  siMinio,
  siMongodb,
  siMqtt,
  siMysql,
  siNatsdotio,
  siNeo4j,
  siNeon,
  siNestjs,
  siNetlify,
  siNextdotjs,
  siNginx,
  siNodedotjs,
  siNomad,
  siNotion,
  siNpm,
  siOllama,
  siOpenapiinitiative,
  siOpenjdk,
  siOpensearch,
  siOpentelemetry,
  siPhoenixframework,
  siPhp,
  siPlanetscale,
  siPnpm,
  siPoetry,
  siPostgresql,
  siPrisma,
  siPrometheus,
  siPulumi,
  siPytest,
  siPython,
  siPytorch,
  siQuarkus,
  siRabbitmq,
  siReact,
  siRedis,
  siRuby,
  siRubyonrails,
  siRust,
  siScala,
  siScylladb,
  siSentry,
  siSequelize,
  siSnowflake,
  siSpring,
  siSpringboot,
  siSqlalchemy,
  siSqlite,
  siStripe,
  siSupabase,
  siSvelte,
  siSwift,
  siSymfony,
  siTailwindcss,
  siTauri,
  siTemporal,
  siTensorflow,
  siTerraform,
  siTidb,
  siTimescale,
  siTraefikproxy,
  siTurso,
  siTypeorm,
  siTypescript,
  siUv,
  siVault,
  siVercel,
  siVictoriametrics,
  siVite,
  siVitess,
  siVitest,
  siVuedotjs,
  siWebassembly,
  siWebpack,
  siYarn,
  siZig,
} from "simple-icons";
import type { StoreKind } from "../catalog";

export interface TechGlyph {
  /** The brand's own name, for a title attribute. */
  title: string;
  /** SVG path data on a 24x24 box, filled. */
  path: string;
}

/** One brand: its glyph and every name it answers to. */
export interface TechMark extends TechGlyph {
  /** The brand's title plus its aliases, as written; folded by `techKey`. */
  names: readonly string[];
}

/**
 * How a name is compared: case dropped, everything that is not a letter, a
 * digit, `+` or `#` dropped. "Node.js" and "nodejs" and "NodeJS" are one key;
 * "C++" and "C#" keep the characters that make them a different language
 * from "C".
 */
export function techKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9+#]/g, "");
}

function mark(
  icon: { title: string; path: string },
  ...aliases: string[]
): TechMark {
  return { title: icon.title, path: icon.path, names: [icon.title, ...aliases] };
}

/**
 * Every mark the app can draw, grouped the way a reader would list a stack.
 * Aliases are the spellings an extractor, a manifest or a person is likely to
 * use; the brand's own title is always one of them.
 */
export const TECH_MARKS: readonly TechMark[] = [
  // Languages and runtimes.
  mark(siGo, "golang"),
  mark(siTypescript, "ts"),
  mark(siJavascript, "js"),
  mark(siNodedotjs, "node"),
  mark(siDeno),
  mark(siBun),
  mark(siRust),
  // simple-icons dropped Oracle's Java cup; OpenJDK's is the mark the language
  // is known by everywhere the trademark is not.
  mark(siOpenjdk, "Java", "JDK", "JVM"),
  mark(siKotlin),
  mark(siScala),
  mark(siPython),
  mark(siRuby),
  mark(siPhp),
  mark(siC),
  mark(siCplusplus, "cpp"),
  mark(siDotnet, "dotnet", "C#", "csharp", "ASP.NET"),
  mark(siSwift),
  mark(siDart),
  mark(siElixir),
  mark(siErlang),
  mark(siHaskell),
  mark(siClojure),
  mark(siLua),
  mark(siZig),
  mark(siWebassembly, "wasm"),

  // Frameworks and libraries.
  mark(siGin, "gin-gonic"),
  mark(siDjango),
  mark(siFastapi),
  mark(siFlask),
  mark(siCelery),
  mark(siSpring),
  mark(siSpringboot),
  mark(siQuarkus),
  mark(siKtor),
  mark(siRubyonrails, "Rails"),
  mark(siLaravel),
  mark(siSymfony),
  mark(siPhoenixframework, "Phoenix"),
  mark(siNestjs),
  mark(siExpress, "expressjs"),
  mark(siFastify),
  mark(siHono),
  mark(siNextdotjs, "nextjs"),
  mark(siReact),
  mark(siVuedotjs, "vue"),
  mark(siAngular),
  mark(siSvelte, "SvelteKit"),
  mark(siFlutter),
  mark(siElectron),
  mark(siTauri),
  mark(siGraphql),
  mark(siOpenapiinitiative, "OpenAPI", "Swagger"),
  mark(siTemporal),
  mark(siLangchain),
  mark(siPytorch),
  mark(siTensorflow),
  mark(siOllama),
  mark(siHuggingface),

  // ORMs and data access.
  mark(siPrisma),
  mark(siSqlalchemy),
  mark(siHibernate),
  mark(siDrizzle, "Drizzle ORM"),
  mark(siTypeorm),
  mark(siSequelize),

  // Stores.
  mark(siPostgresql, "Postgres", "pg", "psql"),
  mark(siMysql),
  mark(siMariadb),
  mark(siSqlite),
  mark(siRedis),
  mark(siMongodb, "Mongo"),
  mark(siClickhouse),
  mark(siApachecassandra, "Cassandra"),
  mark(siScylladb, "Scylla"),
  mark(siElasticsearch, "Elastic"),
  mark(siOpensearch),
  mark(siCockroachlabs, "CockroachDB", "Cockroach"),
  mark(siTidb),
  mark(siVitess),
  mark(siNeo4j),
  mark(siInfluxdb),
  mark(siTimescale, "TimescaleDB"),
  mark(siCouchbase),
  mark(siApachecouchdb, "CouchDB"),
  mark(siEtcd),
  mark(siMinio),
  mark(siSupabase),
  mark(siFirebase, "Firestore"),
  mark(siDuckdb),
  mark(siSnowflake),
  mark(siGooglebigquery, "BigQuery"),
  mark(siGooglecloudspanner, "Spanner"),
  mark(siMeilisearch),
  mark(siPlanetscale),
  mark(siNeon),
  mark(siTurso),

  // Messaging.
  mark(siApachekafka, "Kafka"),
  mark(siNatsdotio, "NATS", "JetStream"),
  mark(siRabbitmq, "AMQP"),
  mark(siApachepulsar, "Pulsar"),
  mark(siMqtt),

  // Infrastructure and delivery.
  mark(siDocker, "Docker Compose"),
  mark(siKubernetes, "k8s"),
  mark(siHelm),
  mark(siTerraform),
  mark(siPulumi),
  mark(siAnsible),
  mark(siNomad),
  mark(siConsul),
  mark(siVault),
  mark(siNginx),
  mark(siEnvoyproxy, "Envoy"),
  mark(siIstio),
  mark(siLinkerd),
  mark(siCilium),
  mark(siTraefikproxy, "Traefik"),
  mark(siCloudflare),
  mark(siGooglecloud, "GCP"),
  mark(siVercel),
  mark(siNetlify),
  mark(siGit),
  mark(siGithubactions),
  mark(siGitlab, "GitLab CI"),
  mark(siJenkins),
  mark(siArgo, "Argo CD", "ArgoCD"),

  // Where a team writes. Not read off a manifest; the marks are for the
  // reader-side integrations that open the wiki from a page.
  mark(siConfluence),
  mark(siNotion),

  // Observability.
  mark(siOpentelemetry, "otel"),
  mark(siPrometheus),
  mark(siGrafana),
  mark(siJaeger),
  mark(siVictoriametrics),
  mark(siSentry),
  mark(siDatadog),

  // Identity and payments.
  mark(siKeycloak),
  mark(siAuth0),
  mark(siStripe),

  // Build and test tooling.
  mark(siVite),
  mark(siWebpack),
  mark(siTailwindcss, "Tailwind"),
  mark(siNpm),
  mark(siPnpm),
  mark(siYarn),
  mark(siGradle),
  mark(siPoetry),
  mark(siUv),
  mark(siPytest),
  mark(siJest),
  mark(siVitest),
  mark(siCypress),

  // What the generators write to.
  mark(siMarkdown),
  mark(siMermaid),
  mark(siBackstage),
];

const BY_KEY: ReadonlyMap<string, TechGlyph> = (() => {
  const map = new Map<string, TechGlyph>();
  for (const { names, title, path } of TECH_MARKS) {
    const glyph = { title, path };
    for (const name of names) {
      map.set(techKey(name), glyph);
    }
  }
  return map;
})();

/**
 * The mark for a technology, or null when it is a word only. The name is
 * folded by `techKey` first, so a caller passes whatever it has.
 */
export function techGlyph(name: string): TechGlyph | null {
  return BY_KEY.get(techKey(name)) ?? null;
}

/**
 * Marker names extract-project can write that deliberately have no mark:
 * simple-icons carries none for them. The test holds every marker in the Go
 * source to either a glyph or a place here, so a new stack in the extractor
 * is decided, not forgotten.
 */
export const TECH_WITHOUT_GLYPH: readonly string[] = ["River", "Watermill"];

/**
 * By store kind. `null` is a kind that has no mark, and is listed rather than
 * left out so that adding a kind to the catalog fails the test until someone
 * has decided what it looks like.
 */
export const STORE_KIND_GLYPH: Record<StoreKind, TechGlyph | null> = {
  postgres: techGlyph("postgres"),
  mysql: techGlyph("mysql"),
  sqlite: techGlyph("sqlite"),
  redis: techGlyph("redis"),
  mongodb: techGlyph("mongodb"),
  clickhouse: techGlyph("clickhouse"),
  // simple-icons was asked to drop Amazon's marks, S3's among them.
  s3: null,
  dynamodb: null,
  other: null,
};
