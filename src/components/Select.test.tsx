// @vitest-environment jsdom

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { render } from "../testing/render";
import type { Rendered } from "../testing/render";
import { Select } from "./Select";

let rendered: Rendered | undefined;

vi.stubGlobal("ResizeObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

afterAll(() => vi.unstubAllGlobals());

afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
});

describe("Select", () => {
  it("renders grouped options and does not choose a disabled option", async () => {
    const onChange = vi.fn();
    rendered = await render(
      <Select
        label="Repository"
        value="main"
        onChange={onChange}
        options={[
          { value: "main", label: "main", group: "branches" },
          { value: "release", label: "release", group: "branches", disabled: true },
          { value: "v1", label: "v1", group: "tags" },
        ]}
      />,
    );

    await rendered.click(rendered.container.querySelector("button"));
    expect(document.body.textContent).toContain("branches");
    expect(document.body.textContent).toContain("tags");

    const options = [...document.querySelectorAll<HTMLElement>("[role=option]")];
    const disabled = options.find((option) => option.textContent?.includes("release"));
    expect(disabled?.getAttribute("aria-disabled")).toBe("true");
    await rendered.click(disabled);
    expect(onChange).not.toHaveBeenCalled();

    const tag = options.find((option) => option.textContent?.includes("v1"));
    await rendered.click(tag);
    expect(onChange).toHaveBeenCalledWith("v1");
  });
});
