// Copies a collector recording into the file the catalog reads, dropping what
// a committed trace must not carry: query parameters, which for this service
// are emails, password hashes and session tokens. Everything the verifier
// looks at - names, kinds, routes, operations, topics, event names - stays.
//
//   node telemetry/scrub.mjs telemetry/out/traces.jsonl telemetry/traces.jsonl
import { readFileSync, writeFileSync } from "node:fs";

const [, , from, to] = process.argv;
if (!from || !to) {
  console.error("usage: node telemetry/scrub.mjs <recording> <destination>");
  process.exit(2);
}

const DROP =
  /^(db\.query\.parameter\.|pgx\.query\.parameters$|db\.query\.text$|db\.statement$|http\.request\.header\.|http\.response\.header\.|url\.full$|url\.query$|user_agent\.original$|client\.address$|pyroscope\.)/;

// The SDK's resource describes the machine the recording was made on - host,
// process, OS, container - and a committed trace must not change with the
// machine. What names the service and the SDK stays; the verifier reads
// service.name and nothing else here.
const KEEP_RESOURCE = /^(service\.|telemetry\.sdk\.)/;

const out = [];
for (const line of readFileSync(from, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const batch = JSON.parse(line);
  for (const resource of batch.resourceSpans ?? []) {
    if (resource.resource?.attributes) {
      resource.resource.attributes = resource.resource.attributes.filter((a) => KEEP_RESOURCE.test(a.key));
    }
    for (const scope of resource.scopeSpans ?? []) {
      for (const span of scope.spans ?? []) {
        span.attributes = (span.attributes ?? []).filter((a) => !DROP.test(a.key));
        // The SQL is the span's name too, and a name is not an attribute.
        // Keep the verb the span already reports and drop the statement.
        if (span.attributes.some((a) => a.key === "db.operation.name")) {
          const op = span.attributes.find((a) => a.key === "db.operation.name").value.stringValue;
          const table = /\b(?:INTO|FROM|UPDATE|JOIN)\s+([a-z_]+)/i.exec(span.name)?.[1];
          span.name = table ? `${op} ${table}` : op;
        }
      }
    }
  }
  out.push(JSON.stringify(batch));
}
writeFileSync(to, `${out.join("\n")}\n`);
console.log(`${to}: ${out.length} batch(es)`);
