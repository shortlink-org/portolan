import { describe, expect, it } from "vitest";
import type { Term } from "../catalog";
import { abbreviationsIn, explain } from "./abbreviations";

const term = (name: string, definition: string): Term => ({ id: `x.${name}`, slug: name.toLowerCase(), context: "x", name, definition, source: "GLOSSARY.md:1" });

describe("abbreviations", () => {
  it("finds capitals and a lowercase-led protocol, not names or versions", () => {
    expect(abbreviationsIn("Storefront BFF · Node.js · gRPC · HTTP · v1 · V1 · Kafka")).toEqual(["BFF", "gRPC", "HTTP"]);
  });

  it("explains by the glossary first, then the common list, and says when neither does", () => {
    const terms = [term("Order Management System (OMS)", "The service that owns orders. It is the only writer."), term("BFF", "Our storefront's API.")];
    expect(explain("OMS", terms)).toEqual({ abbreviation: "OMS", meaning: "Order Management System: The service that owns orders.", from: "glossary" });
    expect(explain("BFF", terms)).toEqual({ abbreviation: "BFF", meaning: "Our storefront's API.", from: "glossary" });
    expect(explain("SQS", terms).from).toBe("common");
    expect(explain("ZQX", terms)).toEqual({ abbreviation: "ZQX", meaning: "", from: "none" });
  });
});
