import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TaskTrackerIcon } from "./TaskTrackerIcon";
import { TRACKER_PROVIDERS } from "../lib/task-tracker-config.mjs";

describe("task tracker brand icons", () => {
  it.each(Object.keys(TRACKER_PROVIDERS))("renders a bundled decorative SVG for %s", (provider) => {
    const markup = renderToStaticMarkup(<TaskTrackerIcon provider={provider} size={20} />);
    expect(markup).toContain("<svg");
    expect(markup).toContain('width="20"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("<path");
    expect(markup).not.toContain("lucide-ticket");
    expect(markup).not.toContain("<img");
  });
  it("keeps unknown catalog providers visible with a neutral fallback", () => {
    expect(renderToStaticMarkup(<TaskTrackerIcon provider="custom" />)).toContain("lucide-ticket");
  });
});
