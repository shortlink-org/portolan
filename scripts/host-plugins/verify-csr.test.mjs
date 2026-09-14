import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runPlugin } from "../plugin-host.mjs";
import { KEY_ENV, SECRET_ENV } from "./fetch-csr.mjs";
import { run } from "./verify-csr.mjs";

const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function input() {
  const root = mkdtempSync(join(tmpdir(), "portolan-verify-csr-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "schemas"));
  writeFileSync(
    join(root, "schemas/order.avsc"),
    '{"type":"record","name":"Order","fields":[]}\n',
  );
  return root;
}

async function registry(answer) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: JSON.parse(body),
    });
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(answer));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
}

describe("verify-csr", () => {
  it("checks the candidate against the subject policy without registering it", async () => {
    const server = await registry({ is_compatible: true });
    const root = input();
    const result = await run(
      {
        input: { root },
        options: {
          registry: server.url,
          normalize: true,
          candidates: [
            { subject: "shop.orders-value", path: "schemas/order.avsc" },
          ],
        },
      },
      { env: { [KEY_ENV]: "key", [SECRET_ENV]: "secret" } },
    );

    expect(result.files).toEqual([]);
    expect(server.requests[0]).toMatchObject({
      method: "POST",
      url: "/compatibility/subjects/shop.orders-value/versions?verbose=true&normalize=true",
      body: { schemaType: "AVRO" },
    });
    expect(server.requests[0].body.schema).toContain('"name":"Order"');
    expect(server.requests[0].headers.authorization).toBe(
      `Basic ${Buffer.from("key:secret").toString("base64")}`,
    );
  });

  it("fails the verify phase with every explanation returned by the registry", async () => {
    const server = await registry({
      is_compatible: false,
      messages: ["reader field missing", "type changed"],
    });
    await expect(
      run({
        input: { root: input() },
        options: {
          registry: server.url,
          candidates: [
            { subject: "shop.orders-value", path: "schemas/order.avsc" },
          ],
        },
      }),
    ).rejects.toThrow(
      /incompatible schema.*reader field missing; type changed/,
    );
  });

  it("refuses a candidate outside the verify input", async () => {
    const server = await registry({ is_compatible: true });
    const root = input();
    await expect(
      run({
        input: { root },
        options: {
          registry: server.url,
          candidates: [
            { subject: "shop.orders-value", path: "../outside.avsc" },
          ],
        },
      }),
    ).rejects.toThrow();
    expect(server.requests).toEqual([]);
  });

  it("is available through the host plugin registry", async () => {
    const described = await runPlugin(
      { name: "csr-compatibility", host: "verify-csr" },
      { kind: "describe" },
    );
    expect(described.describe).toMatchObject({
      name: "verify-csr",
      phases: ["verify"],
    });
  });
});
