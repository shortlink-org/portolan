// portolan-extract-ts: a TypeScript service in, a catalog fragment out. The
// TypeScript twin of extract-go, on the same protocol: one JSON request on
// stdin, one JSON response on stdout, and a `describe` that answers with what
// the plugin is and what it can be told.

import { readFileSync } from "node:fs";
import { extract, type Input, type Options } from "./extract.ts";

const schema = JSON.parse(readFileSync(new URL("./options.schema.json", import.meta.url), "utf8")) as unknown;

export const descriptor = {
  name: "extract-ts",
  summary: "Reads a TypeScript service by its layout - aggregates, events, use cases, endpoints, policies, clients - into a catalog fragment.",
  phases: ["extract"],
  options: schema,
};

interface Request {
  portolanVersion?: string;
  kind?: string;
  input?: Input;
  options?: Options;
}

export function serve(raw: string): string {
  const req = JSON.parse(raw) as Request;
  if (req.kind === "describe") return JSON.stringify({ files: [], describe: descriptor });
  if (!req.input?.root) throw new Error("no input root: an extractor has nothing to read");
  return JSON.stringify(extract(req.input, req.options ?? {}), null, 2);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const chunks: Buffer[] = [];
  process.stdin.on("data", (c: Buffer) => chunks.push(c));
  process.stdin.on("end", () => {
    try {
      process.stdout.write(serve(Buffer.concat(chunks).toString("utf8")));
    } catch (err) {
      process.stderr.write(`portolan-extract-ts: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });
}
