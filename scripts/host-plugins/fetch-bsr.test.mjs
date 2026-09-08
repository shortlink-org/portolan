// The fetcher, against a recorded registry. NEVER against a live one: a test
// that reaches buf.build would fail on a train, and the whole point of this
// plugin's design is that the build does not depend on a registry being up.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runPlugin } from "../plugin-host.mjs";
import { COMMITS_METHOD, DOWNLOAD_METHOD, OFFLINE_ENV, TOKEN_ENV, displayDigest, encodeLock, netrcPassword, run, splitModule, token } from "./fetch-bsr.mjs";

const MODULE = "buf.build/acme/shop";
const PINNED = "c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6";
const PROTO = 'syntax = "proto3";\n\npackage shop.v1;\n\nservice Orders {\n  rpc PlaceOrder(PlaceOrderRequest) returns (PlaceOrderResponse);\n}\n\nmessage PlaceOrderRequest { string customer_id = 1; }\nmessage PlaceOrderResponse { string order_id = 1; }\n';
const DIGEST = { type: "DIGEST_TYPE_B5", value: Buffer.from([0xde, 0xad, 0xbe, 0xef]).toString("base64") };

const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** Serves the two calls the plugin makes, from recorded shapes. */
async function registry(handle = null) {
  const seen = [];
  const requests = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      seen.push(request.headers.authorization ?? "");
      if (handle) return handle(request, response, body);
      response.setHeader("Content-Type", "application/json");
      if (request.url === DOWNLOAD_METHOD) {
        requests.push(JSON.parse(body));
        response.end(JSON.stringify({ contents: [{ commit: { id: PINNED, digest: DIGEST }, files: [{ path: "shop/v1/orders.proto", content: Buffer.from(PROTO).toString("base64") }] }] }));
      } else if (request.url === COMMITS_METHOD) {
        response.end(JSON.stringify({ commits: [{ id: PINNED, digest: DIGEST }] }));
      } else {
        response.statusCode = 404;
        response.end(JSON.stringify({ code: "not_found", message: "no such method" }));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, requests };
}

function cache() {
  const dir = mkdtempSync(join(tmpdir(), "portolan-fetch-bsr-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A test must never inherit a real credential or a real offline setting.
const isolated = { [TOKEN_ENV]: "", [OFFLINE_ENV]: "", CI: "", HOME: "/nonexistent" };
const options = (base, cacheDir, extra = {}) => ({ registry: base, cache: cacheDir, modules: [{ module: MODULE, commit: PINNED, ...extra }] });
const fetch = (opts, env = {}) => run({ options: opts }, { env: { ...isolated, ...env } });
const names = (response) => response.files.map((file) => file.name).sort();
const contentsOf = (response, name) => response.files.find((file) => file.name === name)?.contents ?? "";
const write = (dir, response) => {
  for (const file of response.files) {
    mkdirSync(dirname(join(dir, file.name)), { recursive: true });
    writeFileSync(join(dir, file.name), file.contents);
  }
};

describe("fetch-bsr", () => {
  it("writes the protos and a lock beside them", async () => {
    const server = await registry();
    const response = await fetch(options(server.url, cache()));
    // Each module in its own directory with its own lock, so extract-proto
    // finds the lock beside the files it is already reading.
    expect(names(response)).toEqual(["acme/shop/bsr.lock.json", "acme/shop/shop/v1/orders.proto"]);
    expect(contentsOf(response, "acme/shop/shop/v1/orders.proto")).toBe(PROTO);
    const lock = JSON.parse(contentsOf(response, "acme/shop/bsr.lock.json"));
    expect(lock.modules).toHaveLength(1);
    expect(lock.modules[0]).toEqual({
      module: MODULE,
      commit: PINNED,
      digest: "b5:deadbeef",
      files: [{ path: "shop/v1/orders.proto", sha256: createHash("sha256").update(PROTO).digest("hex"), size: PROTO.length }],
    });
    expect(response.warnings).toEqual([]);
    // The wire shape, asserted rather than assumed.
    expect(server.requests[0].values[0]).toEqual({ resourceRef: { name: { owner: "acme", module: "shop", ref: PINNED } }, fileTypes: ["FILE_TYPE_PROTO"] });
  });

  it("replays the committed copy offline, byte for byte, and in CI", async () => {
    const server = await registry();
    const cacheDir = cache();
    const online = await fetch(options(server.url, cacheDir));
    write(cacheDir, online);

    const replayed = await fetch(options(server.url, cacheDir), { [OFFLINE_ENV]: "1" });
    expect(names(replayed)).toEqual(names(online));
    for (const file of online.files) expect(contentsOf(replayed, file.name)).toBe(file.contents);
    expect(replayed.warnings).toHaveLength(1);
    expect(replayed.warnings[0].message).toContain("not fetched");

    const inCi = await fetch(options(server.url, cacheDir), { CI: "true" });
    expect(names(inCi)).toEqual(names(online));
  });

  it("names an edited vendored file, and refuses a copy at another commit", async () => {
    const server = await registry();
    const cacheDir = cache();
    write(cacheDir, await fetch(options(server.url, cacheDir)));

    await expect(fetch(options(server.url, cacheDir, { commit: "0000000000000000000000000000000f" }), { [OFFLINE_ENV]: "1" })).rejects.toThrow(/holds commit .* but the manifest pins/);

    writeFileSync(join(cacheDir, "acme/shop/shop/v1/orders.proto"), "// edited by hand\n");
    await expect(fetch(options(server.url, cacheDir), { [OFFLINE_ENV]: "1" })).rejects.toThrow(/shop\/v1\/orders\.proto.*edited by hand/);
  });

  it("fails rather than emitting nothing when there is no copy to fall back to", async () => {
    await expect(fetch(options("http://127.0.0.1:1", cache()), { [OFFLINE_ENV]: "1" })).rejects.toThrow(/no bsr\.lock\.json/);

    const broken = await registry((request, response) => {
      response.statusCode = 500;
      response.end(JSON.stringify({ code: "internal", message: "the registry is having a day" }));
    });
    await expect(fetch(options(broken.url, cache()))).rejects.toThrow(/the registry is having a day.*no usable copy/);
  });

  it("falls back to the committed copy when the registry fails", async () => {
    const server = await registry();
    const cacheDir = cache();
    const online = await fetch(options(server.url, cacheDir));
    write(cacheDir, online);

    const broken = await registry((request, response) => {
      response.statusCode = 502;
      response.end();
    });
    const fallback = await fetch(options(broken.url, cacheDir));
    expect(names(fallback)).toEqual(names(online));
    expect(fallback.warnings[0].message).toMatch(/not fetched \(.*http 502\)/);
  });

  it("resolves an unpinned module online with a warning, and refuses it offline", async () => {
    const server = await registry();
    const response = await fetch(options(server.url, cache(), { commit: "" }));
    expect(response.warnings).toHaveLength(1);
    expect(response.warnings[0].message).toContain("not pinned");
    expect(response.warnings[0].message).toContain(PINNED);

    await expect(fetch(options("http://127.0.0.1:1", cache(), { commit: "" }), { [OFFLINE_ENV]: "1" })).rejects.toThrow(MODULE);
  });

  it("sends the token and never lets it reach the output", async () => {
    const server = await registry();
    const anonymous = await fetch(options(server.url, cache()));
    const authorised = await fetch(options(server.url, cache()), { [TOKEN_ENV]: "a-real-looking-secret" });
    for (const file of anonymous.files) {
      expect(contentsOf(authorised, file.name)).toBe(file.contents);
      expect(contentsOf(authorised, file.name)).not.toContain("a-real-looking-secret");
    }
    expect(server.seen[0]).toBe("");
    expect(server.seen.at(-1)).toBe("Bearer a-real-looking-secret");
  });

  it("refuses a missing cache and a module name without three parts", async () => {
    await expect(fetch(options("http://127.0.0.1:1", ""))).rejects.toThrow(/cache/);
    await expect(fetch(options("http://127.0.0.1:1", cache(), { module: "acme/shop" }))).rejects.toThrow(/module name/);
    expect(splitModule(MODULE)).toEqual({ registry: "buf.build", owner: "acme", module: "shop" });
  });

  it("runs through the host like any plugin", async () => {
    const server = await registry();
    const cacheDir = cache();
    write(cacheDir, await fetch(options(server.url, cacheDir)));
    const saved = { CI: process.env.CI, [OFFLINE_ENV]: process.env[OFFLINE_ENV] };
    process.env.CI = "";
    process.env[OFFLINE_ENV] = "1";
    try {
      const result = await runPlugin({ name: "bsr", host: "fetch-bsr" }, { portolanVersion: "0.1.0", options: options(server.url, cacheDir) });
      expect(result.files).toHaveLength(2);
      expect(result.warnings).toEqual([`${MODULE}: not fetched (offline); the copy committed in this repository is used unchanged`]);
      const described = await runPlugin({ name: "bsr", host: "fetch-bsr" }, { portolanVersion: "0.1.0", kind: "describe" });
      expect(described.describe).toMatchObject({ name: "fetch-bsr", phases: ["extract"] });
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe("credentials and locks", () => {
  it("takes the environment over the netrc, and the netrc over nothing", () => {
    const home = cache();
    writeFileSync(join(home, ".netrc"), "machine buf.build login someone password from-netrc\nmachine other.example login x password other\n");
    expect(token("buf.build", { HOME: home })).toBe("from-netrc");
    expect(token("elsewhere.example", { HOME: home })).toBe("");
    expect(token("buf.build", { HOME: home, [TOKEN_ENV]: "from-env" })).toBe("from-env");
    expect(netrcPassword("default login a password d\n", "any.host")).toBe("d");
    expect(netrcPassword("machine buf.build login", "buf.build")).toBe("");
  });

  it("writes a digest the way buf does and a lock the way every generated file is written", () => {
    expect(displayDigest(DIGEST)).toBe("b5:deadbeef");
    expect(displayDigest({ type: "DIGEST_TYPE_UNSPECIFIED", value: DIGEST.value })).toBe("b5:deadbeef");
    expect(displayDigest({})).toBe("");
    const lock = encodeLock({ module: MODULE, commit: PINNED, digest: "", deps: ["b", "a"], files: [{ path: "z", sha256: "2", size: 2 }, { path: "a", sha256: "1", size: 1 }] });
    expect(JSON.parse(lock)).toEqual({ modules: [{ module: MODULE, commit: PINNED, deps: ["a", "b"], files: [{ path: "a", sha256: "1", size: 1 }, { path: "z", sha256: "2", size: 2 }] }] });
    expect(lock.endsWith("\n")).toBe(true);
  });
});
