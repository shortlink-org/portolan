// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "../testing/render";
import type { Rendered } from "../testing/render";
import { SidebarHeader } from "./Sidebar";

let rendered: Rendered | undefined;

afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
});

describe("SidebarHeader", () => {
  it("offers a labelled collapse action in the desktop sidebar", async () => {
    const collapse = vi.fn();
    rendered = await render(<SidebarHeader onCollapse={collapse} />);

    const button = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse the catalog"]',
    );
    expect(button?.getAttribute("aria-keyshortcuts")).toBe("[");

    await rendered.click(button);
    expect(collapse).toHaveBeenCalledOnce();
  });

  it("does not show the desktop action in the narrow drawer", async () => {
    rendered = await render(<SidebarHeader />);
    expect(rendered.container.querySelector("button")).toBeNull();
  });
});
