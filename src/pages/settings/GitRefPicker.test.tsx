import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("../../lib/local-api", () => ({ gitRepositoryRefs: vi.fn() }));
import { gitRepositoryRefs } from "../../lib/local-api";
import { GitRefPicker } from "./GitRefPicker";

describe("Git ref picker", () => {
  it("renders an accessible editable combobox without requesting refs on mount", () => {
    const html = renderToStaticMarkup(<GitRefPicker repository="github.com/acme/shop" value="" onChange={() => {}} disabled={false} />);
    expect(html).toContain('role="combobox"');
    expect(html).toContain("Branch or tag");
    expect(html).toContain("Remote HEAD (default)");
    expect(html).toContain('aria-label="Refresh branches and tags"');
    expect(gitRepositoryRefs).not.toHaveBeenCalled();
  });
  it("disables interaction while settings are saving", () => {
    const html = renderToStaticMarkup(<GitRefPicker repository="github.com/acme/shop" value="main" onChange={() => {}} disabled />);
    expect(html.match(/ disabled=""/g)).toHaveLength(3);
  });
});
