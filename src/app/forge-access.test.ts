import { describe, expect, it } from "vitest";
import { forgeCredentialScope } from "./forge-access";

describe("forgeCredentialScope", () => {
  it("shares a token across repositories on one forge origin", () => {
    expect(
      forgeCredentialScope({
        provider: "github",
        owner: "acme",
        repo: "shop",
        webUrl: "https://github.com/acme/shop",
      }),
    ).toBe("https://github.com");
    expect(forgeCredentialScope("https://github.com/acme/payments")).toBe(
      "https://github.com",
    );
  });

  it("keeps self-hosted forges in separate credential scopes", () => {
    expect(forgeCredentialScope("https://gitlab.one.test/acme/shop")).toBe(
      "https://gitlab.one.test",
    );
    expect(forgeCredentialScope("https://gitlab.two.test/acme/shop")).toBe(
      "https://gitlab.two.test",
    );
  });
});
