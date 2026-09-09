import { vi } from "vitest";

// Browser navigation selects a catalog through `?catalog=`. Node has no URL,
// so tests that exercise the shipped example estate make that same choice by
// setting the fixture manifest's default profile explicitly.
vi.mock("../../portolan.json", async (importOriginal) => {
  const module = await importOriginal<{ default: Record<string, unknown> }>();
  return {
    default: {
      ...module.default,
      defaultCatalog: "example",
    },
  };
});
