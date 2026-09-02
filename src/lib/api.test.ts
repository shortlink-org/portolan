import { describe, expect, it } from "vitest";
import { catalog } from "../data";
import type { Service } from "../catalog";
import {
  declaredMethods,
  interfaceDeclaring,
  methodCount,
  methodId,
  methodNamed,
  operationsExposedBy,
  streamingKind,
  unexposed,
} from "./api";

function auth(): Service {
  const service = catalog.contexts
    .find((c) => c.id === "auth")
    ?.services.find((s) => s.slug === "auth");
  if (!service) throw new Error("the auth service is not in the catalog");

  return service;
}

describe("interfaceDeclaring", () => {
  it("finds the interface a method belongs to", () => {
    expect(interfaceDeclaring(auth(), "registerUser")?.id).toBe(
      "auth.v1.Users",
    );
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
    expect(
      run.map((r) => `${r.aggregate.slug}/${r.operation.id}`).sort(),
    ).toEqual(["session/Validate", "user/ChangePassword"]);
  });
});

describe("unexposed", () => {
  // Both of these are deliberate. The service documents why there is no
  // endpoint that checks a password without issuing a session, and the other
  // is run by a policy reacting to an event rather than by any caller.
  it("finds the operations nothing outside the service can reach", () => {
    expect(
      unexposed(auth())
        .map((r) => r.operation.id)
        .sort(),
    ).toEqual(["Authenticate", "EndAfterCredentialChange"]);
  });
});

// The boundary between the two halves of an interface is BY NAME, and stayed
// that way when a method stopped being a string: `Operation.exposedBy` names a
// method, and so does a flow step's ref. That every assertion above passes
// unmodified is the proof the boundary did not move.
describe("methods, now that a method is more than a name", () => {
  it("finds one method of one interface by name", () => {
    const users = interfaceDeclaring(auth(), "registerUser");
    if (!users) throw new Error("no interface");

    expect(methodNamed(users, "registerUser")?.name).toBe("registerUser");
    expect(methodNamed(users, "nothing")).toBeUndefined();
  });

  it("lists every method the service answers on, in catalog order", () => {
    const declared = declaredMethods(auth());

    expect(declared.length).toBe(methodCount(auth()));
    expect(declared[0]?.provided.id).toBe("auth.v1.Users");
    expect(declared.map((d) => d.method.name)).toContain("login");
  });

  it("counts across every interface, not just the first", () => {
    const service = auth();

    expect(methodCount(service)).toBe(
      service.provides.reduce((n, p) => n + p.methods.length, 0),
    );
  });

  // The catalog leaves unary out because it is the case not worth writing
  // down; a reader deciding what to draw wants all four cases named.
  it("names all four streaming shapes, unary included", () => {
    expect(streamingKind({ name: "a" })).toBe("unary");
    expect(streamingKind({ name: "a", streaming: "client" })).toBe("client");
    expect(streamingKind({ name: "a", streaming: "server" })).toBe("server");
    expect(streamingKind({ name: "a", streaming: "bidi" })).toBe("bidi");
  });

  it("counts nothing for a service that only listens", () => {
    const silent: Service = { ...auth(), provides: [] };

    expect(methodCount(silent)).toBe(0);
    expect(declaredMethods(silent)).toEqual([]);
  });
});
