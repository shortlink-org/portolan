import { describe, expect, it } from "vitest";
import { viewLevel } from "./levels";

describe("viewLevel", () => {
  it("reads the level off every kind of view the generator writes", () => {
    expect(viewLevel("landscape")).toBe(1);
    expect(viewLevel("landscape_example")).toBe(1);
    expect(viewLevel("containers")).toBe(2);
    expect(viewLevel("containers_example")).toBe(2);
    expect(viewLevel("ctx_shop")).toBe(2);
    expect(viewLevel("svc_shop_cart")).toBe(2);
    expect(viewLevel("svc_shop_cart_inside")).toBe(3);
    expect(viewLevel("deploy_prod")).toBe("deployment");
    expect(viewLevel("deploy_svc_shop_cart")).toBe("deployment");
  });
});
