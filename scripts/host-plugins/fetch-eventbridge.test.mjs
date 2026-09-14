import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validateCatalog } from "../../src/catalog.ts";
import { runPlugin } from "../plugin-host.mjs";
import {
  DEFAULT_OUT,
  LOCK_NAME,
  OFFLINE_ENV,
  fragment,
  run,
  targetIdentities,
} from "./fetch-eventbridge.mjs";

const BUS = {
  Name: "orders",
  Arn: "arn:aws:events:eu-west-1:123456789012:event-bus/orders",
  Description: "Business events.",
};

const ORDER_RULE = {
  Name: "orders-to-consumers",
  Arn: "arn:aws:events:eu-west-1:123456789012:rule/orders/orders-to-consumers",
  State: "ENABLED",
  EventPattern: JSON.stringify({
    source: ["com.acme.orders"],
    "detail-type": ["OrderPlaced", "OrderCancelled"],
    detail: { tenant: ["customer-that-must-not-be-kept"], status: [{ "anything-but": "secret-status" }] },
  }),
};

const TARGETS = [
  {
    Id: "billing",
    Arn: "arn:aws:lambda:eu-west-1:123456789012:function:billing-handler:live",
    Input: '{"token":"must-not-leak"}',
    DeadLetterConfig: { Arn: "arn:aws:sqs:eu-west-1:123456789012:billing-dlq" },
    RetryPolicy: { MaximumEventAgeInSeconds: 3600, MaximumRetryAttempts: 8 },
  },
  {
    Id: "audit-target",
    Arn: "arn:aws:sqs:eu-west-1:123456789012:audit-events",
    InputTransformer: { InputPathsMap: { tenant: "$.detail.tenant" }, InputTemplate: '"<tenant>-must-not-leak"' },
  },
];

const cleanups = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function cache() {
  const dir = mkdtempSync(join(tmpdir(), "portolan-fetch-eventbridge-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(dir, response) {
  for (const file of response.files) {
    mkdirSync(dirname(join(dir, file.name)), { recursive: true });
    writeFileSync(join(dir, file.name), file.contents);
  }
}

function contentsOf(response, name) {
  return response.files.find((file) => file.name === name)?.contents ?? "";
}

function mockAws(extraRules = []) {
  const calls = [];
  let destroyed = 0;
  const clientFactory = (region) => ({
    async send(command) {
      const name = command.constructor.name;
      calls.push({ region, name, input: command.input });
      if (name === "ListEventBusesCommand") {
        if (!command.input.NextToken) return { EventBuses: [BUS], NextToken: "more-buses" };
        return { EventBuses: [{ Name: "ignored", Arn: "arn:aws:events:eu-west-1:123456789012:event-bus/ignored" }] };
      }
      if (name === "ListRulesCommand") {
        if (command.input.EventBusName === "ignored") return { Rules: [] };
        return { Rules: [ORDER_RULE, ...extraRules] };
      }
      if (name === "ListTargetsByRuleCommand") {
        return { Targets: command.input.Rule === ORDER_RULE.Name ? TARGETS : [] };
      }
      if (name === "ListTagsForResourceCommand") {
        return { Tags: [{ Key: "portolan.context", Value: "shop" }, { Key: "portolan.service", Value: "audit" }] };
      }
      throw new Error(`unexpected ${name}`);
    },
    destroy() {
      destroyed++;
    },
  });
  return { clientFactory, calls, destroyed: () => destroyed };
}

const isolated = { [OFFLINE_ENV]: "", CI: "", AWS_ACCESS_KEY_ID: "", AWS_SECRET_ACCESS_KEY: "", AWS_SESSION_TOKEN: "" };
const options = (cacheDir, extra = {}) => ({
  regions: ["eu-west-1"],
  buses: ["orders"],
  cache: cacheDir,
  sources: { "com.acme.orders": "shop.orders" },
  targets: { "lambda:billing-handler": "shop.billing" },
  ruleTags: { context: "portolan.context", service: "portolan.service" },
  ...extra,
});

describe("fetch-eventbridge", () => {
  it("reads paginated buses, rules, tags and targets into publisher and consumer channels", async () => {
    const aws = mockAws();
    const response = await run({ options: options(cache()) }, { env: isolated, clientFactory: aws.clientFactory });

    expect(response.files.map((file) => file.name).sort()).toEqual([DEFAULT_OUT, LOCK_NAME]);
    const catalog = JSON.parse(contentsOf(response, DEFAULT_OUT));
    expect(catalog).toMatchObject({ defs: {}, flows: [], adrs: [] });
    expect(() => validateCatalog({ ...catalog, generatedAt: "2026-09-14T00:00:00Z", commit: "fixture" })).not.toThrow();
    expect(catalog.contexts).toHaveLength(1);
    const services = Object.fromEntries(catalog.contexts[0].services.map((service) => [service.id, service]));
    expect(Object.keys(services).sort()).toEqual(["shop.audit", "shop.billing", "shop.orders"]);

    const sent = services["shop.orders"].channels[0];
    expect(sent).toMatchObject({
      address: BUS.Arn,
      kind: "event",
      title: "Amazon EventBridge · orders",
    });
    expect(sent.messages.map((message) => [message.direction, message.name])).toEqual([
      ["send", "OrderCancelled"],
      ["send", "OrderPlaced"],
    ]);

    const billed = services["shop.billing"].channels[0].messages[0];
    expect(billed.direction).toBe("receive");
    expect(billed.doc).toContain("orders-to-consumers");
    expect(billed.doc).toContain("maximum retries 8");
    const audited = services["shop.audit"].channels[0].messages[0];
    expect(audited.doc).toContain("transforms the input");

    const text = contentsOf(response, DEFAULT_OUT);
    expect(text).toContain("detail.status");
    expect(text).toContain("detail.tenant");
    for (const secret of ["customer-that-must-not-be-kept", "secret-status", "must-not-leak"]) expect(text).not.toContain(secret);

    const lock = JSON.parse(contentsOf(response, LOCK_NAME));
    expect(lock).toEqual({
      regions: ["eu-west-1"],
      buses: [BUS.Arn],
      sha256: createHash("sha256").update(text).digest("hex"),
    });
    expect(response.warnings).toEqual([]);
    expect(aws.calls.slice(0, 2).map((call) => [call.name, call.input.NextToken])).toEqual([
      ["ListEventBusesCommand", undefined],
      ["ListEventBusesCommand", "more-buses"],
    ]);
    expect(aws.calls.some((call) => call.name === "ListTagsForResourceCommand")).toBe(true);
    expect(aws.destroyed()).toBe(1);
  });

  it("does not invent routes for disabled, scheduled, malformed or untyped rules", async () => {
    const rules = [
      { Name: "off", Arn: `${ORDER_RULE.Arn}/off`, State: "DISABLED", EventPattern: ORDER_RULE.EventPattern },
      { Name: "nightly", Arn: `${ORDER_RULE.Arn}/nightly`, State: "ENABLED", ScheduleExpression: "rate(1 day)" },
      { Name: "bad", Arn: `${ORDER_RULE.Arn}/bad`, State: "ENABLED", EventPattern: "{" },
      { Name: "wide", Arn: `${ORDER_RULE.Arn}/wide`, State: "ENABLED", EventPattern: JSON.stringify({ source: ["com.acme.orders"], "detail-type": [{ prefix: "Order" }] }) },
      { Name: "anonymous", Arn: `${ORDER_RULE.Arn}/anonymous`, State: "ENABLED", EventPattern: JSON.stringify({ "detail-type": ["AnonymousEvent"] }) },
    ];
    const aws = mockAws(rules);
    const response = await run({ options: options(cache()) }, { env: isolated, clientFactory: aws.clientFactory });
    const messages = JSON.parse(contentsOf(response, DEFAULT_OUT)).contexts.flatMap((context) => context.services).flatMap((service) => service.channels).flatMap((channel) => channel.messages);
    expect(messages).toHaveLength(6);
    const warnings = response.warnings.map((warning) => warning.message).join("\n");
    for (const text of ["disabled rule", "scheduled rule", "not readable JSON", "no literal detail-type", "no literal source"]) expect(warnings).toContain(text);
  });

  it("warns about unmapped publishers and consumers without creating synthetic services", async () => {
    const aws = mockAws();
    const response = await run(
      { options: options(cache(), { sources: {}, targets: {}, ruleTags: undefined }) },
      { env: isolated, clientFactory: aws.clientFactory },
    );
    expect(JSON.parse(contentsOf(response, DEFAULT_OUT)).contexts).toEqual([]);
    expect(response.warnings.map((warning) => warning.message)).toEqual([
      'event source "com.acme.orders" is not mapped to a service and was not claimed as a publisher',
      `target ${JSON.stringify(TARGETS[0].Arn)} is not mapped to a service and was not claimed as a consumer`,
      `target ${JSON.stringify(TARGETS[1].Arn)} is not mapped to a service and was not claimed as a consumer`,
    ]);
    expect(aws.calls.some((call) => call.name === "ListTagsForResourceCommand")).toBe(false);
  });

  it("falls back to a checked snapshot after an API failure and replays it offline", async () => {
    const cacheDir = cache();
    const onlineAws = mockAws();
    const online = await run({ options: options(cacheDir) }, { env: isolated, clientFactory: onlineAws.clientFactory });
    write(cacheDir, online);

    const failed = await run(
      { options: options(cacheDir) },
      { env: isolated, clientFactory: () => ({ send: async () => { throw new Error("network down"); } }) },
    );
    expect(contentsOf(failed, DEFAULT_OUT)).toBe(contentsOf(online, DEFAULT_OUT));
    expect(failed.warnings[0].message).toContain("network down");

    const offline = await run({ options: options(cacheDir) }, { env: { ...isolated, [OFFLINE_ENV]: "1" }, clientFactory: () => { throw new Error("must not connect"); } });
    expect(contentsOf(offline, DEFAULT_OUT)).toBe(contentsOf(online, DEFAULT_OUT));
    expect(offline.warnings[0].message).toContain("not fetched (offline)");

    writeFileSync(join(cacheDir, DEFAULT_OUT), '{"contexts":[]}\n');
    await expect(run({ options: options(cacheDir) }, { env: { ...isolated, [OFFLINE_ENV]: "1" } })).rejects.toThrow(/edited by hand/);
  });

  it("fails clearly without required options or an initial reachable API", async () => {
    await expect(run({ options: { cache: cache() } }, { env: isolated })).rejects.toThrow(/regions/);
    await expect(run({ options: { regions: ["eu-west-1"] } }, { env: isolated })).rejects.toThrow(/cache/);
    await expect(run(
      { options: options(cache()) },
      { env: isolated, clientFactory: () => ({ send: async () => { throw new Error("denied"); } }) },
    )).rejects.toThrow(/EventBridge could not be read.*denied.*no usable snapshot/s);
  });

  it("runs through the host and describes itself like the other built-ins", async () => {
    const cacheDir = cache();
    const aws = mockAws();
    write(cacheDir, await run({ options: options(cacheDir) }, { env: isolated, clientFactory: aws.clientFactory }));
    const saved = { CI: process.env.CI, [OFFLINE_ENV]: process.env[OFFLINE_ENV] };
    process.env.CI = "";
    process.env[OFFLINE_ENV] = "1";
    try {
      const result = await runPlugin({ name: "eventbridge", host: "fetch-eventbridge" }, { portolanVersion: "0.1.0", options: options(cacheDir) });
      expect(result.files).toHaveLength(2);
      const described = await runPlugin({ name: "eventbridge", host: "fetch-eventbridge" }, { portolanVersion: "0.1.0", kind: "describe" });
      expect(described.describe).toMatchObject({ name: "fetch-eventbridge", category: "infrastructure", phases: ["extract"] });
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe("EventBridge mapping", () => {
  it("matches a Lambda target by ARN, qualified kind, resource name or target id", () => {
    expect(targetIdentities({ id: "billing", arn: TARGETS[0].Arn })).toEqual([
      TARGETS[0].Arn,
      "lambda:billing-handler",
      "billing-handler",
      "billing",
    ]);
  });

  it("rejects a mapped value that is not a full service id", () => {
    const warnings = [];
    const buses = [{ name: "orders", arn: BUS.Arn, region: "eu-west-1", description: "", rules: [{ name: "x", arn: "x", state: "ENABLED", managedBy: "", schedule: "", pattern: JSON.stringify({ source: ["a"], "detail-type": ["X"] }), tags: {}, targets: [] }] }];
    expect(() => fragment(buses, { sources: { a: "orders" } }, { warn: (...args) => warnings.push(args) })).toThrow(/full id/);
  });
});
