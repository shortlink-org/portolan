import { describe, expect, it } from "vitest";
import { readmeAssetHref } from "./readme-assets";

describe("readmeAssetHref", () => {
  it("mounts README-relative files below the configured site base", () => {
    expect(readmeAssetHref("vendor/repos/acme/shop", "./docs/example.png", "/catalog/")).toBe(
      "/catalog/portolan-assets/vendor/repos/acme/shop/docs/example.png",
    );
    expect(readmeAssetHref("services/api", "docs/file.json#example", "/")).toBe(
      "/portolan-assets/services/api/docs/file.json#example",
    );
  });

  it("leaves remote, root-relative and escaping references alone", () => {
    expect(readmeAssetHref("services/api", "https://example.com/image.png")).toBeNull();
    expect(readmeAssetHref("services/api", "/logo.svg")).toBeNull();
    expect(readmeAssetHref("services/api", "../secret.png")).toBeNull();
  });
});
