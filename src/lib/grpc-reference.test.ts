import { describe, expect, it } from "vitest";
import type { RpcMethod, RpcService } from "../catalog";
import { grpcRequestJson, grpcurlCommand } from "./grpc-reference";

const method: RpcMethod = {
  name: "Create",
  request: "CreateRequest",
  response: "CreateResponse",
};

const provided: RpcService = {
  id: "shop.v1.Orders",
  source: "proto/shop/v1/orders.proto:10",
  methods: [method],
  enums: [
    {
      name: "Priority",
      values: [
        { name: "PRIORITY_UNSPECIFIED", number: 0 },
        { name: "PRIORITY_HIGH", number: 1 },
      ],
    },
  ],
  messages: [
    {
      name: "CreateRequest",
      fields: [
        { name: "name", type: "string", doc: "" },
        { name: "quantity", type: "int64", doc: "" },
        { name: "expedited", type: "bool", doc: "" },
        { name: "priority", type: "Priority", doc: "" },
        { name: "lines", type: "[]Line", doc: "" },
        { name: "when", type: "Timestamp", doc: "" },
        { name: "money", type: "Money", ref: "Money", doc: "" },
      ],
    },
    { name: "CreateResponse", fields: [] },
  ],
};

describe("gRPC reference examples", () => {
  it("builds a ProtoJSON request from scalars, enums, lists and shared defs", () => {
    expect(JSON.parse(grpcRequestJson(provided, method, {
      Money: {
        fields: [
          { name: "currency", type: "string", doc: "" },
          { name: "minor", type: "int64", doc: "" },
        ],
      },
    }))).toEqual({
      name: "",
      quantity: "0",
      expedited: false,
      priority: "PRIORITY_UNSPECIFIED",
      lines: [],
      when: "1970-01-01T00:00:00Z",
      money: { currency: "", minor: "0" },
    });
  });

  it("emits a ready-to-edit grpcurl command", () => {
    const command = grpcurlCommand(provided, method, {});
    expect(command).toContain("grpcurl -plaintext");
    expect(command).toContain("localhost:50051");
    expect(command).toContain("shop.v1.Orders/Create");
    expect(command).toContain(`"quantity": "0"`);
  });

  it("falls back to an empty body when no request shape was extracted", () => {
    expect(grpcRequestJson(provided, { name: "Ping" }, {})).toBe("{}");
  });
});
