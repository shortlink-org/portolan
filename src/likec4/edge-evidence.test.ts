import { describe, expect, it } from "vitest";
import { evidenceForEdge } from "./edge-evidence";

describe("diagram edge evidence", () => {
  it("keeps every generated relation behind a folded edge", () => {
    const model = {
      findView: () => ({
        $layouted: {
          edges: [{
            id: "edge-1",
            label: "calls 2 methods",
            source: "shop",
            target: "payments",
            relations: ["r1", "r2"],
          }],
        },
      }),
      $data: {
        relations: {
          r1: {
            id: "r1",
            title: "calls Authorize",
            source: { model: "shop" },
            target: { model: "payments" },
            technology: "gRPC",
            color: "verified",
            description: { txt: "payments.v1/Authorize · trace abc" },
          },
          r2: {
            id: "r2",
            title: "calls Capture",
            source: { model: "shop" },
            target: { model: "payments" },
            color: "declared",
          },
        },
      },
    };

    expect(evidenceForEdge(model, "estate", "edge-1")).toEqual({
      id: "edge-1",
      label: "calls 2 methods",
      source: "shop",
      target: "payments",
      relations: [
        {
          id: "r1",
          title: "calls Authorize",
          source: "shop",
          target: "payments",
          technology: "gRPC",
          status: "verified",
          detail: "payments.v1/Authorize · trace abc",
        },
        {
          id: "r2",
          title: "calls Capture",
          source: "shop",
          target: "payments",
          status: "declared",
        },
      ],
    });
  });

  it("exposes generated call ids and source paths for navigation", () => {
    const model = {
      findView: () => ({
        $layouted: {
          edges: [{
            id: "edge-1",
            source: "shop",
            target: "payments",
            relations: ["r1"],
          }],
        },
      }),
      $data: {
        relations: {
          r1: {
            id: "r1",
            title: "calls CreateCharge",
            source: { model: "shop" },
            target: { model: "payments" },
            color: "declared",
            description: {
              txt: "payments.v1.Charges/CreateCharge · declared · src/checkout/contracts/payments.proto",
            },
          },
        },
      },
    };

    expect(evidenceForEdge(model, "estate", "edge-1")?.relations[0]?.call).toEqual({
      id: "payments.v1.Charges/CreateCharge",
      source: "src/checkout/contracts/payments.proto",
    });
  });
});
