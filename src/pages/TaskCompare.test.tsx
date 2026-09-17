// @vitest-environment jsdom
//
// One ticket worked on in two repositories, read as one thing.

import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { draftKey } from "../drafts/model";
import type { Draft } from "../drafts/model";
import { useDrafts } from "../drafts/store";
import { LOGIN, relabelStep, savedDraft, shownDraft } from "../testing/drafts";
import { render } from "../testing/render";
import type { Rendered } from "../testing/render";
import { TaskCompare } from "./TaskCompare";

const initial = useDrafts.getState();
let rendered: Rendered | undefined;
afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  useDrafts.setState(initial, true);
});

const core = shownDraft(savedDraft("ASUP-976-refund-void-bridge", [relabelStep(LOGIN, "s4", "PublishVoidDone")], { project: "aviacore" }), { projectName: "Aviacore" });
const bridge = shownDraft(savedDraft("ASUP-976-refund-void-bridge", [relabelStep(LOGIN, "s2", "ForwardVoidDone")], { project: "avia-api-bridge" }), { projectName: "Avia API Bridge" });
const empty: Draft = { ...core, project: "aviasupp", projectName: "Aviasupp", entities: [], touched: { files: 11, dirs: ["internal/", "pkg/"] } };

async function page(drafts: Draft[]): Promise<Rendered> {
  useDrafts.setState({ mode: "dev", drafts, enabled: [], refresh: async () => undefined, loadBranches: async () => undefined });
  rendered = await render(
    <MemoryRouter initialEntries={["/drafts/task/ASUP-976"]}>
      <Routes>
        <Route path="/drafts/task/:task" element={<TaskCompare />} />
      </Routes>
    </MemoryRouter>,
  );
  return rendered;
}

describe("a task's compare page", () => {
  it("puts every project of the ticket on one page, counted together", async () => {
    const { text } = await page([core, bridge]);
    expect(text()).toContain("ASUP-976");
    expect(text()).toContain("2 projects · ASUP-976-refund-void-bridge");
    expect(text()).toContain("Aviacore");
    expect(text()).toContain("Avia API Bridge");
    expect(text()).toContain("~ step s4 Check → PublishVoidDone");
    expect(text()).toContain("~ step s2 Authenticate → ForwardVoidDone");
    expect(text()).toContain("2 of 2 entities");
  });

  it("shows the whole task in the catalog with one tick", async () => {
    const { container, click } = await page([core, bridge]);
    await click(container.querySelector("input[type=checkbox]") as HTMLInputElement);
    expect(useDrafts.getState().enabled).toEqual([core, bridge].map(draftKey));
  });

  it("says what a project of the task changed that the catalog does not read", async () => {
    const { text } = await page([core, empty]);
    expect(text()).toContain("Nothing the catalog reads changed in Aviasupp.");
    expect(text()).toContain("The branch changed 11 files in internal/, pkg/");
  });

  it("says so when no draft of the task is saved", async () => {
    const { text } = await page([]);
    expect(text()).toContain("No saved draft of ASUP-976");
  });
});
