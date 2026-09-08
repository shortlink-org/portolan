// The fetcher, against a recorded registry. NEVER against a live one.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runPlugin } from "../plugin-host.mjs";
import { KEY_ENV, OFFLINE_ENV, SECRET_ENV, TOKEN_ENV, authorization, body, indentJson, run, slugOf } from "./fetch-csr.mjs";

const VALUE = "shop.oms.order-value";
const PARTY = "shop.oms.Party";
// The value schema references the party one, which is how a registry says a
// record is shared between subjects.
const ORDER = '{"type":"record","namespace":"shop.oms","name":"OrderPlaced","fields":[{"name":"order_id","type":"string"},{"name":"buyer","type":"shop.oms.Party"}]}';
const PARTY_SCHEMA = '{"type":"record","namespace":"shop.oms","name":"Party","fields":[{"name":"id","type":"string"}]}';

const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function registry(answers = recorded()) {
  const seen = [];
  const server = createServer((request, response) => {
    seen.push(request.headers.authorization ?? "");
    response.setHeader("Content-Type", "application/json");
    const answer = answers[decodeURIComponent(request.url)];
    if (!answer) {
      response.statusCode = 404;
      response.end(JSON.stringify({ error_code: 40401, message: `Subject '${request.url}' not found.` }));
      return;
    }
    if (typeof answer === "function") return answer(response);
    response.end(JSON.stringify(answer));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}`, seen };
}

function recorded() {
  const order = { subject: VALUE, version: 3, id: 100021, guid: "8f0d", schemaType: "AVRO", schema: ORDER, references: [{ name: "shop.oms.Party", subject: PARTY, version: 1 }] };
  return {
    "/subjects/shop.oms.order-value/versions/3": order,
    "/subjects/shop.oms.order-value/versions/latest": order,
    "/subjects/shop.oms.Party/versions/1": { subject: PARTY, version: 1, id: 100014, schemaType: "AVRO", schema: PARTY_SCHEMA },
  };
}

function cache() {
  const dir = mkdtempSync(join(tmpdir(), "portolan-fetch-csr-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const isolated = { [OFFLINE_ENV]: "", CI: "", [TOKEN_ENV]: "", [KEY_ENV]: "", [SECRET_ENV]: "", CSR_API_KEY: "", CSR_API_SECRET: "" };
const options = (base, cacheDir, ...subjects) => ({ registry: base, cache: cacheDir, subjects });
const fetch = (opts, env = {}) => run({ options: opts }, { env: { ...isolated, ...env } });
const names = (response) => response.files.map((file) => file.name).sort();
const contentsOf = (response, name) => response.files.find((file) => file.name === name)?.contents ?? "";
const write = (dir, response) => {
  for (const file of response.files) {
    mkdirSync(dirname(join(dir, file.name)), { recursive: true });
    writeFileSync(join(dir, file.name), file.contents);
  }
};

describe("fetch-csr", () => {
  it("writes the schema, its lock, and follows a reference the schema pinned", async () => {
    const server = await registry();
    const response = await fetch(options(server.url, cache(), { subject: VALUE, version: 3 }));
    expect(names(response)).toEqual(["shop.oms.Party/csr.lock.json", "shop.oms.Party/v1.avsc", "shop.oms.order-value/csr.lock.json", "shop.oms.order-value/v3.avsc"]);
    expect(contentsOf(response, "shop.oms.Party/v1.avsc")).toContain('"name": "Party"');

    // Indented rather than the one line the registry answers with, without
    // reordering a key.
    const schema = contentsOf(response, "shop.oms.order-value/v3.avsc");
    expect(schema).toContain('\n  "type": "record"');
    expect(schema.endsWith("\n")).toBe(true);
    expect(schema.indexOf('"namespace"')).toBeLessThan(schema.indexOf('"name"'));
    expect(JSON.parse(schema)).toEqual(JSON.parse(ORDER));

    const lock = JSON.parse(contentsOf(response, "shop.oms.order-value/csr.lock.json"));
    expect(lock).toEqual({
      registry: server.url,
      subjects: [{
        subject: VALUE, version: 3, id: 100021, guid: "8f0d", schemaType: "AVRO",
        references: [{ name: "shop.oms.Party", subject: PARTY, version: 1 }],
        files: [{ path: "v3.avsc", sha256: createHash("sha256").update(schema).digest("hex"), size: schema.length }],
      }],
    });
    expect(JSON.parse(contentsOf(response, "shop.oms.Party/csr.lock.json")).subjects[0]).not.toHaveProperty("guid");
    expect(response.warnings).toEqual([]);
  });

  it("reads an absent schema type as AVRO and resolves latest with a warning", async () => {
    const answers = recorded();
    delete answers["/subjects/shop.oms.Party/versions/1"].schemaType;
    const server = await registry(answers);
    const response = await fetch(options(server.url, cache(), { subject: VALUE }));
    expect(JSON.parse(contentsOf(response, "shop.oms.Party/csr.lock.json")).subjects[0].schemaType).toBe("AVRO");
    expect(response.warnings).toHaveLength(1);
    expect(response.warnings[0].message).toContain('"latest" resolved to version 3');

    await expect(fetch(options("http://127.0.0.1:1", cache(), { subject: VALUE }), { [OFFLINE_ENV]: "1" })).rejects.toThrow(/not pinned/);
  });

  it("replays the committed copies offline, references included, byte for byte", async () => {
    const server = await registry();
    const cacheDir = cache();
    const online = await fetch(options(server.url, cacheDir, { subject: VALUE, version: 3 }));
    write(cacheDir, online);
    const replayed = await fetch(options(server.url, cacheDir, { subject: VALUE, version: 3 }), { [OFFLINE_ENV]: "1" });
    expect(names(replayed)).toEqual(names(online));
    for (const file of online.files) expect(contentsOf(replayed, file.name)).toBe(file.contents);
    expect(replayed.warnings.map((warning) => warning.ref)).toEqual([VALUE, PARTY]);
  });

  it("falls back to the tree when the registry fails, and is an error without one", async () => {
    const server = await registry();
    const cacheDir = cache();
    write(cacheDir, await fetch(options(server.url, cacheDir, { subject: VALUE, version: 3 })));
    const broken = await registry({ "/subjects/shop.oms.order-value/versions/3": (response) => { response.statusCode = 502; response.end(); } });
    // The lock names the registry it came from; a copy from another one is
    // not this one's to replay.
    await expect(fetch(options(broken.url, cacheDir, { subject: VALUE, version: 3 }))).rejects.toThrow(/was fetched from .* but the manifest names/);

    await expect(fetch(options("http://127.0.0.1:1", cache(), { subject: VALUE, version: 3 }))).rejects.toThrow(/no usable copy/);
    const missing = await registry({});
    await expect(fetch(options(missing.url, cache(), { subject: VALUE, version: 3 }))).rejects.toThrow(/Subject .* not found\. \(error_code 40401\)/);
  });

  it("reports an edited copy, a moved pin, and one subject at two versions", async () => {
    const server = await registry();
    const cacheDir = cache();
    write(cacheDir, await fetch(options(server.url, cacheDir, { subject: VALUE, version: 3 })));
    await expect(fetch(options(server.url, cacheDir, { subject: VALUE, version: 2 }), { [OFFLINE_ENV]: "1" })).rejects.toThrow(/holds version 3 but the manifest pins 2/);
    writeFileSync(join(cacheDir, "shop.oms.order-value/v3.avsc"), "{}\n");
    await expect(fetch(options(server.url, cacheDir, { subject: VALUE, version: 3 }), { [OFFLINE_ENV]: "1" })).rejects.toThrow(/v3\.avsc does not match its digest/);
    await expect(fetch(options(server.url, cache(), { subject: VALUE, version: 3 }, { subject: VALUE, version: 2 }))).rejects.toThrow(/one version per subject/);
  });

  it("sends the credential from the environment and gives a bare token a scheme", async () => {
    const server = await registry();
    await fetch(options(server.url, cache(), { subject: PARTY, version: 1 }));
    await fetch(options(server.url, cache(), { subject: PARTY, version: 1 }), { [KEY_ENV]: "key", [SECRET_ENV]: "secret" });
    expect(server.seen).toEqual(["", `Basic ${Buffer.from("key:secret").toString("base64")}`]);
    expect(authorization({ [TOKEN_ENV]: "abc" })).toBe("Bearer abc");
    expect(authorization({ [TOKEN_ENV]: "Token abc" })).toBe("Token abc");
    expect(authorization({ CSR_API_KEY: "k", CSR_API_SECRET: "s" })).toBe(`Basic ${Buffer.from("k:s").toString("base64")}`);
    expect(authorization({ CSR_API_KEY: "k" })).toBe("");
  });

  it("runs through the host like any plugin", async () => {
    const server = await registry();
    const result = await runPlugin({ name: "csr", host: "fetch-csr" }, { portolanVersion: "0.1.0", options: options(server.url, cache(), { subject: PARTY, version: 1 }) });
    expect(result.files.map((file) => file.name)).toEqual(["shop.oms.Party/v1.avsc", "shop.oms.Party/csr.lock.json"]);
    const described = await runPlugin({ name: "csr", host: "fetch-csr" }, { portolanVersion: "0.1.0", kind: "describe" });
    expect(described.describe).toMatchObject({ name: "fetch-csr", phases: ["extract"] });
  });
});

describe("shapes", () => {
  it("keeps a subject readable as a directory", () => {
    expect(slugOf("shop.oms.order-value")).toBe("shop.oms.order-value");
    expect(slugOf("shop.oms.OrderPlaced")).toBe("shop.oms.OrderPlaced");
    expect(slugOf("a/b c")).toBe("a_b_c");
    expect(slugOf("...")).toBe("_");
  });

  it("indents JSON without touching a token, and leaves protobuf alone", () => {
    expect(indentJson('{"a":[1,2.50,"x\\"y",{"b":null}],"c":{},"d":[],"e":true}')).toBe('{\n  "a": [\n    1,\n    2.50,\n    "x\\"y",\n    {\n      "b": null\n    }\n  ],\n  "c": {},\n  "d": [],\n  "e": true\n}');
    expect(body("PROTOBUF", 'syntax = "proto3";')).toBe('syntax = "proto3";\n');
    expect(body("JSON", "not json")).toBe("not json\n");
  });
});
