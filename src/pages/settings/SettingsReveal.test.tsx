import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("../../lib/motion", async (importOriginal) => ({ ...await importOriginal<typeof import("../../lib/motion")>(), useReducedMotion: () => true }));
import { SettingsReveal } from "./SettingsReveal";

describe("settings reveal", () => {
  it("keeps a collapsed draft mounted but inert and hidden from assistive technology", () => {
    const html = renderToStaticMarkup(<SettingsReveal open={false} label="Draft"><input defaultValue="saved draft" /></SettingsReveal>);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('inert=""');
    expect(html).toContain('height:0');
    expect(html).toContain('value="saved draft"');
  });
  it("exposes the expanded draft without initial travel, including with reduced motion", () => {
    const html = renderToStaticMarkup(<SettingsReveal open label="Draft"><input defaultValue="saved draft" /></SettingsReveal>);
    expect(html).toContain('aria-hidden="false"');
    expect(html).not.toContain('inert=""');
    expect(html).toContain('height:auto');
    expect(html).toContain('opacity:1');
  });
});
