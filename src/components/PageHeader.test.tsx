import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CapabilityEmpty } from "./PageHeader";

describe("CapabilityEmpty", () => {
  it("keeps the explanation, action and evidence signal together", () => {
    const markup = renderToStaticMarkup(
      <CapabilityEmpty
        title="No dependency graph yet"
        actions={<button type="button">Review extraction</button>}
        signal="Signals: domain events and consumers."
      >
        The catalog has components, but no events to connect.
      </CapabilityEmpty>,
    );

    expect(markup).toContain("next useful step");
    expect(markup).toContain("No dependency graph yet");
    expect(markup).toContain("Review extraction");
    expect(markup).toContain("Signals: domain events and consumers.");
  });
});
