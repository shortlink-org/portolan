import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const generator = fileURLToPath(new URL("./gen-likec4.mjs", import.meta.url));
const likec4 = join(dirname(dirname(generator)), "node_modules", ".bin", "likec4");

describe("the LikeC4 generator", () => {
  it("treats dots in a root participant id as data, not containment", () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-likec4-"));
    mkdirSync(join(root, "data"));
    writeFileSync(
      join(root, "portolan.json"),
      JSON.stringify({ sources: ["data/*.json"] }),
    );
    writeFileSync(
      join(root, "data", "catalog.json"),
      JSON.stringify({
        generatedAt: "2026-09-06T00:00:00Z",
        commit: "0000000000000000000000000000000000000000",
        contexts: [
          {
            id: "demo",
            slug: "demo",
            name: "Demo",
            summary: "",
            services: [
              {
                id: "demo.app",
                slug: "app",
                name: "App",
                repo: "example/app",
                path: "",
                readme: "",
                provides: [],
                consumes: [],
                aggregates: [],
              },
            ],
          },
        ],
        defs: {},
        flows: [
          {
            id: "flow.jobs",
            slug: "jobs",
            name: "Jobs",
            summary: "A queued job.",
            source: "jobs.go:1",
            owner: "demo",
            participants: [
              { id: "demo.app", kind: "service", context: "demo" },
              {
                id: "river.order-jobs",
                kind: "broker",
                context: null,
                label: "River orders",
              },
            ],
            steps: [
              {
                type: "step",
                id: "enqueue",
                from: "demo.app",
                to: "river.order-jobs",
                kind: "call",
                label: "enqueue",
                status: "declared",
              },
            ],
          },
        ],
        adrs: [],
      }),
    );

    execFileSync(process.execPath, [generator], { cwd: root });
    execFileSync(likec4, ["validate", "likec4"], { cwd: root });

    const model = readFileSync(join(root, "likec4", "model.c4"), "utf8");
    const views = readFileSync(join(root, "likec4", "views.c4"), "utf8");
    expect(model).toContain("river_order_jobs = broker 'River orders'");
    expect(views).toContain("demo.app -> river_order_jobs 'enqueue'");
    expect(views).not.toContain("river.order_jobs");
  });
});
