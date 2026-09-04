import { describe, expect, it } from "vitest";
import { camel, slug, title } from "./ids.ts";

describe("ids", () => {
  it("slugs the way extract-go does", () => {
    expect(slug("PriceList")).toBe("price-list");
    expect(slug("Address")).toBe("address");
    expect(slug("ID")).toBe("id");
    expect(slug("email.Address")).toBe("email-address");
    expect(slug("HTTPServer")).toBe("http-server");
    expect(slug("orderLine")).toBe("order-line");
  });
  it("camels a directory name into an operation id", () => {
    expect(camel("change_password")).toBe("ChangePassword");
    expect(camel("add-item")).toBe("AddItem");
  });
  it("titles a directory name for a page", () => {
    expect(title("price_list")).toBe("Price List");
    expect(title("basket")).toBe("Basket");
  });
});
