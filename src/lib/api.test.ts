import { describe, expect, it } from "vitest";
import { catalog } from "../data";
import type { Service } from "../catalog";
import { interfaceDeclaring, methodId, operationsExposedBy, unexposed } from "./api";

function auth(): Service {
  const service = catalog.contexts
    .find((c) => c.id === "auth")
    ?.services.find((s) => s.slug === "auth");
  if (!service) throw new Error("the auth service is not in the catalog");

  return service;
}

describe("interfaceDeclaring", () => {
  it("finds the interface a method belongs to", () => {
    expect(interfaceDeclaring(auth(), "registerUser")?.id).toBe("auth.v1.Users");
    expect(interfaceDeclaring(auth(), "login")?.id).toBe("auth.v1.Sessions");
    expect(interfaceDeclaring(auth(), "nothing")).toBeUndefined();
  });

  it("writes a method the way the rest of the app writes one", () => {
    expect(methodId(auth(), "registerUser")).toBe("auth.v1.Users/registerUser");
  });
});

describe("operationsExposedBy", () => {
  it("finds the operation an endpoint runs", () => {
    const run = operationsExposedBy(auth(), "registerUser");
    expect(run.map((r) => r.operation.id)).toEqual(["Register"]);
    expect(run[0]?.aggregate.id).toBe("auth.auth.user");
  });

  // The change-password endpoint resolves the bearer token itself before it
  // changes anything, so it has run two use cases - and they belong to two
  // different aggregates.
  it("finds every operation an endpoint runs, across aggregates", () => {
    const run = operationsExposedBy(auth(), "changePassword");
    expect(run.map((r) => `${r.aggregate.slug}/${r.operation.id}`).sort()).toEqual([
      "session/Validate",
      "user/ChangePassword",
    ]);
  });
});

describe("unexposed", () => {
  // Both of these are deliberate. The service documents why there is no
  // endpoint that checks a password without issuing a session, and the other
  // is run by a policy reacting to an event rather than by any caller.
  it("finds the operations nothing outside the service can reach", () => {
    expect(unexposed(auth()).map((r) => r.operation.id).sort()).toEqual([
      "Authenticate",
      "EndAfterCredentialChange",
    ]);
  });
});
