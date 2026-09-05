import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { apiID, callID, documentApiID, findOperation, interfaceID, readSpec, tagTitle } from "./openapi.ts";

// The same cases plugins/openapi/ids_test.go holds the Go side to.
describe("openapi ids", () => {
  it("names the api by title and major version", () => {
    expect(apiID("Auth", "1.2.3")).toBe("auth.v1");
    expect(apiID("", "")).toBe("api");
  });
  it("lets a vendored copy say what the estate calls it", () => {
    expect(documentApiID(" stripe.v1 ", "Stripe API", "2026-08-26.dahlia")).toBe("stripe.v1");
    expect(documentApiID("", "Stripe API", "2026-08-26.dahlia")).toBe("stripe-api.v2026-08-26");
  });
  it("titles tags and builds interface ids", () => {
    expect(tagTitle("price_list")).toBe("PriceList");
    expect(interfaceID("auth.v1", "sessions")).toBe("auth.v1.Sessions");
    expect(interfaceID("auth.v1", "")).toBe("auth.v1");
  });
});

const doc = `openapi: 3.0.3
info:
  title: auth
  version: 1.0.0
paths:
  /v1/sessions:
    post:
      operationId: login
      tags: [sessions]
  /v1/users/{userId}:
    get:
      operationId: getUser
      tags: [users]
  /v1/health:
    get: {}
`;

describe("readSpec and findOperation", () => {
  const dir = mkdtempSync(join(tmpdir(), "extract-ts-"));
  const path = join(dir, "openapi.yaml");
  writeFileSync(path, doc);
  const spec = readSpec(path);

  it("reads the api and its operations", () => {
    expect(spec.api).toBe("auth.v1");
    expect(spec.operations).toHaveLength(3);
  });
  it("takes the api id from x-portolan-api when the copy carries one", () => {
    const named = join(dir, "named.yaml");
    writeFileSync(named, doc.replace("  version: 1.0.0\n", "  version: 1.0.0\n  x-portolan-api: sessions.v9\n"));
    expect(readSpec(named).api).toBe("sessions.v9");
  });
  it("finds a route however the parameter is spelled", () => {
    const login = findOperation(spec, "post", "/v1/sessions")!;
    expect(callID(spec, login)).toBe("auth.v1.Sessions/login");
    expect(callID(spec, findOperation(spec, "GET", "/v1/users/{userId}")!)).toBe("auth.v1.Users/getUser");
    expect(callID(spec, findOperation(spec, "GET", "/v1/users/${id}")!)).toBe("auth.v1.Users/getUser");
    expect(callID(spec, findOperation(spec, "GET", "/v1/health")!)).toBe("auth.v1/GET /v1/health");
    expect(findOperation(spec, "DELETE", "/v1/sessions")).toBeUndefined();
  });
});
