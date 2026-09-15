// A use case nobody calls in to, run by a clock.
//
// The fixture beside this has one aggregate, one use case, and under
// transport/job a job that runs it, one that fires on nothing the syntax can
// say, and the scheduler that starts them. What is worth pinning is that the
// job opens the flow an endpoint would, with the scheduler for the caller,
// and that its event is therefore reached.
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Flow, Step } from "../../src/catalog.ts";
import { extract } from "./extract.ts";
import { every } from "./transport.ts";

const ROOT = "plugins/extract-ts/testdata/jobs";
const options = { context: "shop", service: "cart", store: "pg" };

function run() {
  return extract({ root: ROOT }, options);
}

function flows(): Flow[] {
  return (JSON.parse(run().files[0]!.contents) as { flows: Flow[] }).flows;
}

describe("a job under transport/job", () => {
  it("reads to the golden fragment", () => {
    const actual = JSON.parse(run().files[0]!.contents);
    if (process.env.UPDATE_GOLDEN) {
      writeFileSync(`${ROOT}/expected.json`, `${JSON.stringify(actual, null, 2)}\n`);
      return;
    }
    expect(actual).toEqual(JSON.parse(readFileSync(`${ROOT}/expected.json`, "utf8")));
  });

  it("opens a flow named by the job, fired by the scheduler on its interval", () => {
    const [flow, ...rest] = flows();
    expect(rest).toEqual([]);
    expect(flow!.slug).toBe("cart-expire-idle-baskets");
    expect(flow!.trigger).toEqual({ kind: "scheduled", label: "every hour", confidence: "high" });
    expect(flow!.participants[0]).toEqual({ id: "scheduler", kind: "actor", context: null, label: "Scheduler" });
    const steps = flow!.steps as Step[];
    expect(steps.map((s) => `${s.from}>${s.to}:${s.kind}:${s.label}`)).toEqual([
      "scheduler>shop.cart:call:expire-idle-baskets",
      "shop.cart>cart-pg:call:idleSince",
      "shop.cart>cart-pg:call:save",
      "shop.cart>bus:event:BasketAbandoned",
    ]);
    expect(steps[3]!.ref).toBe("shop.cart.basket.BasketAbandoned");
  });

  it("reports the job it cannot schedule, and does not report the event as unreached", () => {
    const { warnings } = run();
    expect(warnings.map((w) => w.ref)).toEqual(["reindex"]);
    expect(warnings[0]!.message).toContain("no `everyMs`");
  });

  it("says the interval in the largest unit that divides it", () => {
    expect(every(60_000)).toBe("every minute");
    expect(every(2 * 3_600_000)).toBe("every 2 hours");
    expect(every(86_400_000)).toBe("every day");
    expect(every(90_000)).toBe("every 90 seconds");
    expect(every(1_500)).toBe("every 1500 ms");
  });
});
