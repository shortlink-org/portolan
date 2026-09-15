// Renders a component into jsdom for a test that needs the component to read
// a store the test set, or to be clicked. A string render cannot do either: it
// reads a store's initial snapshot and runs no effect and no handler.
//
// The test file opts into jsdom with `// @vitest-environment jsdom`.

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Rendered {
  container: HTMLElement;
  /** The visible text, whitespace collapsed, as a reader would read it. */
  text: () => string;
  click: (element: Element | null | undefined) => Promise<void>;
  unmount: () => void;
}

export async function render(ui: ReactNode): Promise<Rendered> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(ui));
  return {
    container,
    text: () => (container.textContent ?? "").replace(/\s+/g, " ").trim(),
    click: async (element) => {
      if (!element) throw new Error("nothing to click");
      await act(async () => (element as HTMLElement).click());
    },
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** The first button whose text contains the words, for a test to click. */
export function button(container: HTMLElement, words: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(words));
}
